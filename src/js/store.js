(function () {
  const U = window.U;

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

  function normalizeRecord(record, type) {
    if (!record || typeof record !== 'object') return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') ? record.date : '';
    const amount = U.round2(record.amount);
    if (!date || !U.dateFromISO(date) || amount <= 0) return null;
    const base = {
      id: record.id || U.uid(),
      date,
      amount,
      note: String(record.note || '').slice(0, 200),
      createdAt: Number(record.createdAt) || Date.now()
    };
    if (type === 'income') {
      return Object.assign(base, {
        channel: String(record.channel || '堂食')
      });
    }
    if (type === 'expense') {
      return Object.assign(base, {
        category: String(record.category || '其他支出'),
        sub: String(record.sub || '其他'),
        method: String(record.method || '微信')
      });
    }
    return Object.assign(base, {
      category: String(record.category || '其他')
    });
  }

  function normalize(raw) {
    const def = defaultData();
    const source = raw && typeof raw === 'object' ? raw : {};
    const settings = Object.assign({}, def.settings, source.settings && typeof source.settings === 'object' ? source.settings : {});
    settings.shopName = String(settings.shopName || def.settings.shopName).slice(0, 30);
    settings.openDate = U.dateFromISO(settings.openDate) ? settings.openDate : '';
    settings.reservePct = U.clamp(settings.reservePct, 0, 100);
    settings.depreciationMonthly = Math.max(0, U.round2(settings.depreciationMonthly));

    const investors = (Array.isArray(source.investors) ? source.investors : [])
      .filter((inv) => inv && typeof inv === 'object' && String(inv.name || '').trim())
      .map((inv) => ({
        id: inv.id || U.uid(),
        name: String(inv.name).trim().slice(0, 30),
        amount: Math.max(0, U.round2(inv.amount)),
        ratio: U.clamp(inv.ratio, 0, 100)
      }));

    const incomes = (Array.isArray(source.incomes) ? source.incomes : [])
      .map((record) => normalizeRecord(record, 'income'))
      .filter(Boolean);
    const expenses = (Array.isArray(source.expenses) ? source.expenses : [])
      .map((record) => normalizeRecord(record, 'expense'))
      .filter(Boolean);
    const capitals = (Array.isArray(source.capitals) ? source.capitals : [])
      .map((record) => normalizeRecord(record, 'capital'))
      .filter(Boolean);

    return {
      version: 1,
      settings,
      investors,
      incomes,
      expenses,
      capitals
    };
  }

  const Store = {
    isElectron: typeof window.shopAPI !== 'undefined',
    paths: { dataDir: '浏览器本地存储', dataFile: 'localStorage' },
    mode: 'browser',
    version: '1.0.0-web',

    async load() {
      if (this.isElectron) {
        const result = await window.shopAPI.load();
        this.paths = result.paths || this.paths;
        this.mode = result.paths?.mode || 'desktop';
        this.version = result.version || this.version;
        return {
          data: normalize(result.data),
          recoveredMessage: result.recoveredMessage || ''
        };
      }
      let raw = null;
      let recoveredMessage = '';
      try {
        raw = JSON.parse(localStorage.getItem('lamb-noodle-data-v1') || 'null');
      } catch (err) {
        recoveredMessage = '浏览器本地数据损坏，已创建空账本。';
      }
      const version = await this.getVersion();
      return { data: normalize(raw), recoveredMessage, version };
    },

    async save(data) {
      const payload = normalize(data);
      if (this.isElectron) {
        await window.shopAPI.save(payload);
      } else {
        localStorage.setItem('lamb-noodle-data-v1', JSON.stringify(payload));
      }
      return true;
    },

    async getVersion() {
      if (this.isElectron) {
        try {
          this.version = await window.shopAPI.version();
        } catch (err) {
          this.version = '1.0.0';
        }
      }
      return this.version;
    },

    async exportFile(filename, content, mime) {
      if (this.isElectron) {
        return window.shopAPI.exportCsv({ defaultName: filename, content });
      }
      U.downloadText(filename, content, mime);
      return { ok: true, browser: true };
    },

    async exportPdf(html, filename) {
      if (this.isElectron) {
        return window.shopAPI.exportPdf({ html, defaultName: filename });
      }
      const win = window.open('', '_blank');
      if (!win) {
        U.downloadText(filename.replace(/\.pdf$/i, '.html'), html, 'text/html;charset=utf-8');
        return { ok: true, browser: true, html: true };
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 400);
      return { ok: true, browser: true };
    },

    async exportBackup(data) {
      const filename = `羊肉米线记账-备份-${U.todayISO()}.json`;
      const content = JSON.stringify(normalize(data), null, 2);
      if (this.isElectron) {
        return window.shopAPI.exportBackup({ defaultName: filename, content });
      }
      U.downloadText(filename, content, 'application/json;charset=utf-8');
      return { ok: true, browser: true };
    },

    async importBackup() {
      if (this.isElectron) {
        const result = await window.shopAPI.importBackup();
        if (result.ok) return { ok: true, data: normalize(result.data), filePath: result.filePath };
        return result;
      }
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (!file) {
            resolve({ ok: false, canceled: true });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const parsed = JSON.parse(String(reader.result || '').replace(/^\uFEFF/, ''));
              if (!parsed || !Array.isArray(parsed.investors) || !Array.isArray(parsed.incomes) ||
                !Array.isArray(parsed.expenses) || !Array.isArray(parsed.capitals)) {
                throw new Error('数据结构不完整');
              }
              resolve({ ok: true, data: normalize(parsed), filePath: file.name });
            } catch (err) {
              resolve({ ok: false, error: `备份文件无法读取：${err.message}` });
            }
          };
          reader.readAsText(file, 'utf-8');
        };
        input.click();
      });
    },

    async openDataFolder() {
      if (this.isElectron) return window.shopAPI.openDataFolder();
      return { ok: false, error: '浏览器预览模式无法打开文件夹' };
    }
  };

  Store.defaultData = defaultData;
  Store.normalize = normalize;
  window.Store = Store;
})();
