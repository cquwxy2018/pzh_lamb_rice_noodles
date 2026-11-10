const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DATA_DIR_NAME = '羊肉米线记账数据';
const DATA_FILE_NAME = 'data.json';
const BACKUP_KEEP = 30;

const smokeArg = process.argv.find((arg) => arg.startsWith('--smoke-test='));
const smokeTarget = smokeArg ? smokeArg.slice('--smoke-test='.length) : '';
const smokePdfArg = process.argv.find((arg) => arg.startsWith('--smoke-pdf='));
const smokePdfTarget = smokePdfArg ? smokePdfArg.slice('--smoke-pdf='.length) : '';
const smokeTypeArg = process.argv.find((arg) => arg.startsWith('--smoke-type='));
const smokeType = smokeTypeArg ? smokeTypeArg.slice('--smoke-type='.length) : 'year';
const smokePeriodArg = process.argv.find((arg) => arg.startsWith('--smoke-period='));
const smokePeriod = smokePeriodArg ? smokePeriodArg.slice('--smoke-period='.length) : '';

app.setName('LambNoodleBooks');

let mainWindow = null;
let dataDir = '';
let dataFile = '';
let dataMode = 'desktop';
let recoveredMessage = '';

function resolveDataDir() {
  if (smokeTarget || smokePdfTarget) {
    dataMode = 'smoke';
    const smokeDataArg = process.argv.find((arg) => arg.startsWith('--smoke-data='));
    if (smokeDataArg) return path.resolve(smokeDataArg.slice('--smoke-data='.length));
    return path.join(os.tmpdir(), `lamb-noodle-smoke-${process.pid}`);
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    dataMode = 'portable';
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, DATA_DIR_NAME);
  }
  if (app.isPackaged) {
    dataMode = 'desktop';
    return path.join(app.getPath('userData'), 'data');
  }
  dataMode = 'dev';
  return path.join(__dirname, 'data-dev');
}

function defaultData() {
  return {
    version: 1,
    settings: {
      shopName: '攀枝花羊肉米线（和悦广场店）',
      openDate: '',
      reservePct: 0,
      depreciationMonthly: 0
    },
    investors: [],
    incomes: [],
    expenses: [],
    capitals: []
  };
}

function isValidData(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data) &&
    Array.isArray(data.investors) && Array.isArray(data.incomes) &&
    Array.isArray(data.expenses) && Array.isArray(data.capitals);
}

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
  const backups = path.join(dataDir, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  const readme = path.join(dataDir, '数据说明.txt');
  if (!fs.existsSync(readme)) {
    const content = [
      '羊肉米线记账 - 数据文件夹',
      '',
      '1. data.json 保存了全部账目，请勿用记事本随意修改。',
      '2. backups 文件夹每天自动保留一份备份，最多保留 30 份。',
      '3. 换电脑或重装前，请在软件「设置」里导出备份；在新电脑导入即可。',
      '4. 建议定期把整个「羊肉米线记账数据」文件夹复制到 U 盘或网盘。',
      ''
    ].join('\r\n');
    fs.writeFileSync(readme, content, 'utf8');
  }
}

function backupIfNeeded() {
  if (!fs.existsSync(dataFile)) return;
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const backupFile = path.join(dataDir, 'backups', `data-${stamp}.json`);
  if (!fs.existsSync(backupFile)) {
    try {
      fs.copyFileSync(dataFile, backupFile);
    } catch (err) {
      console.error('backup failed', err);
    }
  }
  try {
    const files = fs.readdirSync(path.join(dataDir, 'backups'))
      .filter((name) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort();
    while (files.length > BACKUP_KEEP) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(dataDir, 'backups', oldest));
    }
  } catch (err) {
    console.error('trim backups failed', err);
  }
}

function latestBackup() {
  try {
    const dir = path.join(dataDir, 'backups');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter((name) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort();
    if (!files.length) return null;
    return path.join(dir, files[files.length - 1]);
  } catch (err) {
    return null;
  }
}

function readDataFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  if (!isValidData(parsed)) throw new Error('数据结构不完整');
  return parsed;
}

function loadData() {
  ensureDataDir();
  if (!fs.existsSync(dataFile)) {
    const data = defaultData();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }
  try {
    return readDataFile(dataFile);
  } catch (err) {
    console.error('load data failed', err);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(dataFile, path.join(dataDir, `data-error-${stamp}.json`));
    } catch (copyErr) {
      console.error('copy broken data failed', copyErr);
    }
    const backup = latestBackup();
    if (backup) {
      try {
        const data = readDataFile(backup);
        recoveredMessage = `数据文件损坏，已自动恢复到最近备份（${path.basename(backup)}）。损坏文件已另存，可在数据文件夹中查找。`;
        return data;
      } catch (backupErr) {
        console.error('recover backup failed', backupErr);
      }
    }
    recoveredMessage = '数据文件损坏且没有可用备份，已创建空账本。损坏文件已另存到数据文件夹。';
    const data = defaultData();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(1024, Math.min(1360, workArea.width - 80));
  const height = Math.max(680, Math.min(900, workArea.height - 80));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1024,
    minHeight: 660,
    title: '羊肉米线记账',
    backgroundColor: '#f6f1e9',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!smokeTarget) mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (smokeTarget || smokePdfTarget) {
    const smokeTabArg = process.argv.find((arg) => arg.startsWith('--smoke-tab='));
    const smokeTab = smokeTabArg ? smokeTabArg.slice('--smoke-tab='.length) : '';
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level ?? ''}] ${event.message ?? ''}`);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('render-process-gone', details);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (smokeTab && /^[a-z]+$/.test(smokeTab)) {
            await mainWindow.webContents.executeJavaScript(`window.App && window.App.switchTab('${smokeTab}')`);
            await new Promise((resolve) => setTimeout(resolve, 900));
          }
          if (smokePdfTarget) {
            const now = new Date();
            const period = smokePeriod || (smokeType === 'month'
              ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
              : String(now.getFullYear()));
            const html = await mainWindow.webContents.executeJavaScript(
              `window.PdfReport.buildHTML(window.App.state.data, ${JSON.stringify(smokeType)}, ${JSON.stringify(period)})`
            );
            const buffer = await renderPdfBuffer(html);
            const outPdf = path.resolve(smokePdfTarget);
            fs.mkdirSync(path.dirname(outPdf), { recursive: true });
            fs.writeFileSync(outPdf, buffer);
            console.log(`SMOKE_PDF_OK ${outPdf}`);
          }
          if (smokeTarget) {
            const image = await mainWindow.webContents.capturePage();
            const out = path.resolve(smokeTarget);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, image.toPNG());
            console.log(`SMOKE_OK ${out}`);
          }
        } catch (err) {
          console.error('SMOKE_FAIL', err);
        }
        app.exit(0);
      }, 2800);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function saveCsvLike(payload, filters, defaultExt) {
  const content = typeof payload?.content === 'string' ? payload.content : '';
  const defaultName = typeof payload?.defaultName === 'string' && payload.defaultName
    ? payload.defaultName
    : `导出-${Date.now()}.${defaultExt}`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存文件',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, content, 'utf8');
  return { ok: true, filePath: result.filePath };
}

async function renderPdfBuffer(html) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamb-pdf-'));
  const htmlFile = path.join(tmpDir, 'report.html');
  fs.writeFileSync(htmlFile, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await win.loadFile(htmlFile);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
  } finally {
    win.destroy();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.error('cleanup pdf temp failed', err);
    }
  }
}

function registerIpc() {
  ipcMain.handle('store:load', () => ({
    data: loadData(),
    paths: { dataDir, dataFile, mode: dataMode },
    version: app.getVersion(),
    recoveredMessage
  }));

  ipcMain.handle('store:save', (_event, data) => {
    if (!isValidData(data)) throw new Error('数据格式不正确，未保存');
    ensureDataDir();
    backupIfNeeded();
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, dataFile);
    return { ok: true, savedAt: Date.now() };
  });

  ipcMain.handle('app:paths', () => ({ dataDir, dataFile, mode: dataMode }));
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('export:csv', (_event, payload) => saveCsvLike(
    payload,
    [
      { name: 'CSV 文件（可用 Excel 打开）', extensions: ['csv'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    'csv'
  ));

  ipcMain.handle('export:pdf', async (_event, payload) => {
    const html = typeof payload?.html === 'string' ? payload.html : '';
    if (!html) return { ok: false, error: '报表内容为空' };
    const defaultName = typeof payload?.defaultName === 'string' && payload.defaultName
      ? payload.defaultName
      : `报表-${Date.now()}.pdf`;
    try {
      const buffer = await renderPdfBuffer(html);
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存 PDF 报表',
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [
          { name: 'PDF 文件', extensions: ['pdf'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(result.filePath, buffer);
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      return { ok: false, error: `PDF 生成失败：${err.message}` };
    }
  });

  ipcMain.handle('export:backup', (_event, payload) => saveCsvLike(
    payload,
    [
      { name: '备份文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    'json'
  ));

  ipcMain.handle('import:backup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      properties: ['openFile'],
      filters: [{ name: '备份文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const data = readDataFile(result.filePaths[0]);
      return { ok: true, data, filePath: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: `备份文件无法读取：${err.message}` };
    }
  });

  ipcMain.handle('open:dataFolder', async () => {
    ensureDataDir();
    const error = await shell.openPath(dataDir);
    return error ? { ok: false, error } : { ok: true };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    dataDir = resolveDataDir();
    dataFile = path.join(dataDir, DATA_FILE_NAME);
    ensureDataDir();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
