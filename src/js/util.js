(function () {
  const U = {};

  U.esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  };

  U.num = function (value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  U.round2 = function (value) {
    return Math.round((U.num(value) + Number.EPSILON) * 100) / 100;
  };

  U.sum = function (list, pick) {
    return (list || []).reduce((total, item) => total + U.num(pick ? pick(item) : item), 0);
  };

  U.clamp = function (value, min, max) {
    return Math.min(max, Math.max(min, U.num(value)));
  };

  U.money = function (value) {
    const n = U.round2(value);
    const sign = n < 0 ? '-' : '';
    return `${sign}¥${Math.abs(n).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  U.money0 = function (value) {
    const n = Math.round(U.num(value));
    return `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('zh-CN')}`;
  };

  U.signedMoney = function (value) {
    return `${U.num(value) > 0 ? '+' : ''}${U.money(value)}`;
  };

  U.plain = function (value) {
    return U.num(value).toFixed(2);
  };

  U.pct = function (value, digits) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return `${U.num(value).toFixed(digits == null ? 2 : digits)}%`;
  };

  U.shortMoney = function (value) {
    const n = U.num(value);
    const abs = Math.abs(n);
    if (abs >= 10000) {
      const text = (n / 10000).toFixed(abs >= 100000 ? 0 : 1).replace(/\.0$/, '');
      return `${text}万`;
    }
    return String(Math.round(n));
  };

  U.dateFromISO = function (iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const parts = iso.split('-').map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) {
      return null;
    }
    return date;
  };

  U.toISO = function (date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  U.todayISO = function () {
    return U.toISO(new Date());
  };

  U.addDays = function (iso, days) {
    const date = U.dateFromISO(iso);
    if (!date) return iso;
    return U.toISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
  };

  U.daysInclusive = function (start, end) {
    const a = U.dateFromISO(start);
    const b = U.dateFromISO(end);
    if (!a || !b || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  };

  U.startOfWeek = function (iso) {
    const date = U.dateFromISO(iso) || new Date();
    const offset = (date.getDay() + 6) % 7;
    return U.toISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset));
  };

  U.endOfWeek = function (iso) {
    return U.addDays(U.startOfWeek(iso), 6);
  };

  U.startOfMonth = function (iso) {
    const date = U.dateFromISO(iso) || new Date();
    return U.toISO(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  U.endOfMonth = function (iso) {
    const date = U.dateFromISO(iso) || new Date();
    return U.toISO(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  };

  U.startOfYear = function (iso) {
    const date = U.dateFromISO(iso) || new Date();
    return U.toISO(new Date(date.getFullYear(), 0, 1));
  };

  U.endOfYear = function (iso) {
    const date = U.dateFromISO(iso) || new Date();
    return U.toISO(new Date(date.getFullYear(), 11, 31));
  };

  U.isoWeek = function (iso) {
    const date = U.dateFromISO(iso);
    if (!date) return { year: new Date().getFullYear(), week: 1 };
    const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const year = utc.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return { year, week };
  };

  U.monthKey = function (iso) {
    return String(iso || '').slice(0, 7);
  };

  U.fmtDateCN = function (iso) {
    const date = U.dateFromISO(iso);
    if (!date) return iso || '—';
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  U.fmtDateShort = function (iso) {
    const date = U.dateFromISO(iso);
    if (!date) return '';
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  };

  U.weekdayCN = function (iso) {
    const date = U.dateFromISO(iso);
    if (!date) return '';
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  };

  U.fmtTime = function (timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  };

  U.uid = function () {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  };

  U.debounce = function (fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  U.clone = function (value) {
    return JSON.parse(JSON.stringify(value));
  };

  U.csvCell = function (value) {
    const text = String(value == null ? '' : value);
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  U.buildCSV = function (rows) {
    return `\uFEFF${rows.map((row) => row.map(U.csvCell).join(',')).join('\r\n')}`;
  };

  U.downloadText = function (filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  U.sortRecords = function (records) {
    return records.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  };

  U.periodText = function (start, end) {
    if (start === end) return `${start} ${U.weekdayCN(start)}`;
    return `${start} 至 ${end}`;
  };

  window.U = U;
})();
