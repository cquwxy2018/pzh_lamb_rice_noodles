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

  const LS_INDEX_KEY = 'lamb-noodle-stores-v1';
  const LS_LEGACY_KEY = 'lamb-noodle-data-v1';
  const lsDataKey = (id) => `lamb-noodle-store-data-${id}`;

  function browserNewId() {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function browserReadIndex() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_INDEX_KEY) || 'null');
      if (parsed && Array.isArray(parsed.stores) && parsed.stores.length) {
        const stores = parsed.stores.filter((store) => store && typeof store.id === 'string' && typeof store.name === 'string');
        if (stores.length) {
          const activeId = stores.some((store) => store.id === parsed.activeId) ? parsed.activeId : stores[0].id;
          return { version: 1, activeId, stores };
        }
      }
    } catch (err) { /* 索引损坏时重建 */ }
    return null;
  }

  function browserWriteIndex(index) {
    localStorage.setItem(LS_INDEX_KEY, JSON.stringify(index));
  }

  function browserInitIndex() {
    let index = browserReadIndex();
    if (index) return index;
    const id = browserNewId();
    let name = defaultData().settings.shopName;
    let openDate = '';
    const legacyRaw = localStorage.getItem(LS_LEGACY_KEY);
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        name = String((legacy.settings && legacy.settings.shopName) || name).slice(0, 30);
        openDate = U.dateFromISO(legacy.settings && legacy.settings.openDate) ? legacy.settings.openDate : '';
      } catch (err) { /* 旧数据损坏时按空账本迁移 */ }
      localStorage.setItem(lsDataKey(id), legacyRaw);
      localStorage.removeItem(LS_LEGACY_KEY);
    } else {
      localStorage.setItem(lsDataKey(id), JSON.stringify(defaultData()));
    }
    index = { version: 1, activeId: id, stores: [{ id, name, openDate, createdAt: Date.now() }] };
    browserWriteIndex(index);
    return index;
  }

  function browserListStores(index) {
    return index.stores.map((store) => {
      let records = 0;
      let investors = 0;
      try {
        const data = normalize(JSON.parse(localStorage.getItem(lsDataKey(store.id)) || 'null'));
        records = data.incomes.length + data.expenses.length + data.capitals.length;
        investors = data.investors.length;
      } catch (err) { /* 单店损坏不影响列表 */ }
      return Object.assign({}, store, {
        openDate: store.openDate || '',
        createdAt: store.createdAt || 0,
        active: store.id === index.activeId,
        records,
        investors
      });
    });
  }

  function browserLoadResult(index) {
    let raw = null;
    let recoveredMessage = '';
    try {
      raw = JSON.parse(localStorage.getItem(lsDataKey(index.activeId)) || 'null');
    } catch (err) {
      recoveredMessage = '浏览器本地数据损坏，已创建空账本。';
    }
    return {
      data: normalize(raw),
      recoveredMessage,
      store: index.stores.find((store) => store.id === index.activeId),
      stores: browserListStores(index)
    };
  }

  const Store = {
    isElectron: typeof window.shopAPI !== 'undefined',
    paths: { dataDir: '浏览器本地存储', dataFile: 'localStorage', rootDir: 'localStorage' },
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
          recoveredMessage: result.recoveredMessage || '',
          store: result.store || null,
          stores: result.stores || []
        };
      }
      const index = browserInitIndex();
      const result = browserLoadResult(index);
      result.version = await this.getVersion();
      return result;
    },

    async save(data) {
      const payload = normalize(data);
      if (this.isElectron) {
        await window.shopAPI.save(payload);
      } else {
        const index = browserInitIndex();
        localStorage.setItem(lsDataKey(index.activeId), JSON.stringify(payload));
        const store = index.stores.find((item) => item.id === index.activeId);
        if (store && (store.name !== payload.settings.shopName || (store.openDate || '') !== payload.settings.openDate)) {
          store.name = payload.settings.shopName;
          store.openDate = payload.settings.openDate;
          browserWriteIndex(index);
        }
      }
      return true;
    },

    async listStores() {
      if (this.isElectron) return window.shopAPI.listStores();
      const index = browserInitIndex();
      return { stores: browserListStores(index), rootDir: 'localStorage' };
    },

    async createStore(payload) {
      const name = String(payload?.name || '').trim().slice(0, 30);
      const openDate = String(payload?.openDate || '');
      if (!name) return { ok: false, error: '门店名称不能为空' };
      if (!U.dateFromISO(openDate)) return { ok: false, error: '请填写有效的开业日期' };
      if (this.isElectron) return window.shopAPI.createStore({ name, openDate });
      const index = browserInitIndex();
      if (index.stores.some((store) => store.name === name)) {
        return { ok: false, error: '已存在同名门店，请换一个名称' };
      }
      const id = browserNewId();
      const data = defaultData();
      data.settings.shopName = name;
      data.settings.openDate = openDate;
      localStorage.setItem(lsDataKey(id), JSON.stringify(data));
      index.stores.push({ id, name, openDate, createdAt: Date.now() });
      index.activeId = id;
      browserWriteIndex(index);
      return Object.assign({ ok: true }, browserLoadResult(index));
    },

    async switchStore(id) {
      if (this.isElectron) return window.shopAPI.switchStore(id);
      const index = browserInitIndex();
      if (!index.stores.some((store) => store.id === id)) return { ok: false, error: '门店不存在' };
      index.activeId = id;
      browserWriteIndex(index);
      return Object.assign({ ok: true }, browserLoadResult(index));
    },

    async deleteStore(id, options) {
      if (this.isElectron) return window.shopAPI.deleteStore({ id, backup: !!(options && options.backup) });
      const index = browserInitIndex();
      const store = index.stores.find((item) => item.id === id);
      if (!store) return { ok: false, error: '门店不存在' };
      if (index.stores.length <= 1) return { ok: false, error: '至少需要保留一个门店' };
      if (options && options.backup) {
        let data = defaultData();
        try {
          data = normalize(JSON.parse(localStorage.getItem(lsDataKey(id)) || 'null'));
        } catch (err) { /* 损坏数据也允许继续删除 */ }
        await this.exportBackup(data);
      }
      const wasActive = index.activeId === id;
      localStorage.removeItem(lsDataKey(id));
      index.stores = index.stores.filter((item) => item.id !== id);
      if (wasActive) {
        index.activeId = index.stores[0].id;
        browserWriteIndex(index);
        return Object.assign({ ok: true, switched: true }, browserLoadResult(index));
      }
      browserWriteIndex(index);
      return { ok: true, switched: false, stores: browserListStores(index) };
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
      const shopName = String((data && data.settings && data.settings.shopName) || '羊肉米线记账').replace(/[\\/:*?"<>|]/g, '_');
      const filename = `${shopName}-备份-${U.todayISO()}.json`;
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
    },

    async openRootFolder() {
      if (this.isElectron) return window.shopAPI.openRootFolder();
      return { ok: false, error: '浏览器预览模式无法打开文件夹' };
    }
  };

  Store.defaultData = defaultData;
  Store.normalize = normalize;
  window.Store = Store;
})();
