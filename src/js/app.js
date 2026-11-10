(function () {
  const U = window.U;
  const C = window.Calc;
  const Charts = window.Charts;
  const Constants = window.Constants;
  const Store = window.Store;

  const TYPE_META = {
    income: { label: '收入', badge: 'badge-income', collection: 'incomes' },
    expense: { label: '支出', badge: 'badge-expense', collection: 'expenses' },
    capital: { label: '开业投入', badge: 'badge-capital', collection: 'capitals' }
  };

  const ANNUALIZE_MIN_DAYS = 7;

  const PAGE_META = {
    dashboard: {
      title: '经营概览',
      sub: '看清每天赚了多少、钱花在哪、股东能分多少',
      showRange: true
    },
    entry: {
      title: '记一笔',
      sub: '收入和支出分开记，几秒钟完成',
      showRange: false
    },
    records: {
      title: '流水明细',
      sub: '按日期、类型查询每一笔账，可修改、删除、导出',
      showRange: false
    },
    reports: {
      title: '分红报表',
      sub: '按日 / 周 / 月 / 年查看利润与每位股东应分，可导出 PDF',
      showRange: true
    },
    investors: {
      title: '股东与分红',
      sub: '设置出资额与分红比例，查看累计收益和回本进度',
      showRange: false
    },
    stores: {
      title: '门店管理',
      sub: '每个门店独立记账、独立分红，数据互不影响',
      showRange: false
    },
    settings: {
      title: '设置与备份',
      sub: '核算口径、数据位置与备份恢复',
      showRange: false
    }
  };

  const RANGE_PRESETS = [
    { key: 'today', label: '今日' },
    { key: 'week', label: '本周' },
    { key: 'month', label: '本月' },
    { key: 'lastMonth', label: '上月' },
    { key: 'last30', label: '近30天' },
    { key: 'all', label: '全部' },
    { key: 'custom', label: '自定义' }
  ];

  const state = {
    data: null,
    tab: 'dashboard',
    rangePreset: 'month',
    range: { start: U.todayISO(), end: U.todayISO(), label: '本月' },
    reportMode: 'day',
    recordFilter: { type: 'all', start: '', end: '', q: '' },
    paths: {},
    mode: '',
    version: '',
    store: null,
    stores: [],
    ready: false
  };

  let saveChain = Promise.resolve();

  function qs(id) {
    return document.getElementById(id);
  }

  function options(list, selected) {
    return list.map((value) => `<option value="${U.esc(value)}"${value === selected ? ' selected' : ''}>${U.esc(value)}</option>`).join('');
  }

  function recordCategory(record) {
    if (record._type === 'income') return record.channel || '其他收入';
    return record.category || '其他';
  }

  function recordSub(record) {
    return record._type === 'expense' ? record.sub || '' : '';
  }

  function recordAmount(record) {
    return `${record._type === 'income' ? '+' : '-'}${U.money(record.amount)}`;
  }

  function allRecords() {
    const records = [];
    state.data.incomes.forEach((r) => records.push(Object.assign({}, r, { _type: 'income' })));
    state.data.expenses.forEach((r) => records.push(Object.assign({}, r, { _type: 'expense' })));
    state.data.capitals.forEach((r) => records.push(Object.assign({}, r, { _type: 'capital' })));
    return U.sortRecords(records);
  }

  function investorColor(index) {
    return Constants.INVESTOR_COLORS[index % Constants.INVESTOR_COLORS.length];
  }

  function avatarHTML(name, index) {
    const initial = String(name || '?').trim().slice(0, 1) || '?';
    return `<span class="avatar" style="background:${investorColor(index)}">${U.esc(initial)}</span>`;
  }

  function netMargin(profit, revenue) {
    return revenue > 0 ? (profit / revenue) * 100 : null;
  }

  function marginText(profit, revenue) {
    const margin = netMargin(profit, revenue);
    return margin === null ? '—' : U.pct(margin, 1);
  }

  function valueClass(value) {
    return value > 0 ? 'pos' : value < 0 ? 'neg' : '';
  }

  function showFormError(form, message) {
    const el = form.querySelector('.form-error');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
  }

  function clearFormError(form) {
    const el = form.querySelector('.form-error');
    if (!el) return;
    el.textContent = '';
    el.classList.remove('is-visible');
  }

  function toast(message, type, duration) {
    const wrap = qs('toastWrap');
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' is-error' : type === 'info' ? ' is-info' : ''}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s ease, transform .2s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 220);
    }, duration || 3200);
  }

  function setSaveState(kind) {
    const dot = qs('saveDot');
    const text = qs('saveText');
    if (!dot || !text) return;
    dot.className = `save-dot${kind === 'saving' ? ' is-saving' : kind === 'error' ? ' is-error' : ''}`;
    if (kind === 'saving') text.textContent = '正在保存…';
    else if (kind === 'error') text.textContent = '保存失败，请检查磁盘';
    else text.textContent = `已保存 ${U.fmtTime(Date.now()).slice(0, 5)}`;
  }

  function persist() {
    setSaveState('saving');
    saveChain = saveChain
      .then(() => Store.save(state.data))
      .then(() => setSaveState('saved'))
      .catch((err) => {
        setSaveState('error');
        toast(`保存失败：${err.message}`, 'error', 6000);
      });
    return saveChain;
  }

  function syncBrand() {
    const name = state.data.settings.shopName || '羊肉米线记账';
    qs('brandName').textContent = name;
    qs('brandSub').textContent = '羊肉米线店 · 记账分红';
    document.title = `${name} · 记账分红 · by @ 猴子_扛过吴彦祖`;
  }

  /* ---------------- Range ---------------- */

  function computeRange(preset) {
    const today = U.todayISO();
    if (preset === 'today') return { start: today, end: today, label: '今日' };
    if (preset === 'week') return { start: U.startOfWeek(today), end: today, label: '本周' };
    if (preset === 'month') return { start: U.startOfMonth(today), end: today, label: '本月' };
    if (preset === 'lastMonth') {
      const lastMonthDay = U.addDays(U.startOfMonth(today), -1);
      return { start: U.startOfMonth(lastMonthDay), end: U.endOfMonth(lastMonthDay), label: '上月' };
    }
    if (preset === 'last30') return { start: U.addDays(today, -29), end: today, label: '近30天' };
    if (preset === 'all') {
      const start = C.effectiveStart(state.data);
      return { start, end: today < start ? start : today, label: '全部' };
    }
    return state.range;
  }

  function setRangePreset(preset) {
    state.rangePreset = preset;
    state.range = computeRange(preset);
    syncRangeInputs();
    render();
  }

  function syncRangeInputs() {
    const startInput = qs('rangeStart');
    const endInput = qs('rangeEnd');
    if (startInput) startInput.value = state.range.start;
    if (endInput) endInput.value = state.range.end;
  }

  function applyCustomRange() {
    const start = qs('rangeStart').value;
    const end = qs('rangeEnd').value;
    if (!start || !end) {
      toast('请选择完整的起止日期', 'error');
      return;
    }
    if (!U.dateFromISO(start) || !U.dateFromISO(end)) {
      toast('日期格式不正确', 'error');
      return;
    }
    if (start > end) {
      toast('开始日期不能晚于结束日期', 'error');
      return;
    }
    state.rangePreset = 'custom';
    state.range = { start, end, label: '自定义' };
    render();
  }

  function renderTopbar() {
    const meta = PAGE_META[state.tab];
    qs('pageTitle').textContent = meta.title;
    qs('pageSub').textContent = meta.sub;

    const rangeWrap = qs('rangeWrap');
    rangeWrap.classList.toggle('is-hidden', !meta.showRange);
    if (meta.showRange) {
      const presets = qs('rangePresets');
      presets.innerHTML = RANGE_PRESETS.map((preset) => (
        `<button type="button" class="range-chip${state.rangePreset === preset.key ? ' is-active' : ''}" data-preset="${preset.key}">${preset.label}</button>`
      )).join('');
      presets.querySelectorAll('[data-preset]').forEach((button) => {
        button.addEventListener('click', () => {
          if (button.dataset.preset === 'custom') {
            state.rangePreset = 'custom';
            state.range = Object.assign({}, state.range, { label: '自定义' });
            renderTopbar();
            qs('rangeStart').focus();
            return;
          }
          setRangePreset(button.dataset.preset);
        });
      });
      syncRangeInputs();
    }

    const actions = qs('topActions');
    if (state.tab === 'dashboard') {
      actions.innerHTML = '<button type="button" class="btn btn-primary btn-sm" id="topQuickEntry">记一笔</button>';
    } else if (state.tab === 'records') {
      actions.innerHTML = [
        '<button type="button" class="btn btn-ghost btn-sm" id="topExportRecords">导出</button>',
        '<button type="button" class="btn btn-ghost btn-sm" id="topAddExpense">记支出</button>',
        '<button type="button" class="btn btn-primary btn-sm" id="topAddIncome">记收入</button>'
      ].join('');
    } else if (state.tab === 'investors') {
      actions.innerHTML = '<button type="button" class="btn btn-primary btn-sm" id="topAddInvestor">新增股东</button>';
    } else {
      actions.innerHTML = '';
    }

    const quick = qs('topQuickEntry');
    if (quick) quick.addEventListener('click', () => switchTab('entry'));
    const topExport = qs('topExportRecords');
    if (topExport) topExport.addEventListener('click', exportFilteredRecords);
    const addIncome = qs('topAddIncome');
    if (addIncome) addIncome.addEventListener('click', () => openRecordModal('income'));
    const addExpense = qs('topAddExpense');
    if (addExpense) addExpense.addEventListener('click', () => openRecordModal('expense'));
    const addInvestor = qs('topAddInvestor');
    if (addInvestor) addInvestor.addEventListener('click', () => openInvestorModal());
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.nav-item').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.tab === tab);
    });
    renderTopbar();
    renderView();
    qs('main').scrollTo({ top: 0, behavior: 'smooth' });
  }

  function render() {
    renderTopbar();
    renderView();
  }

  function renderView() {
    if (state.tab === 'dashboard') renderDashboard();
    else if (state.tab === 'entry') renderEntry();
    else if (state.tab === 'records') renderRecords();
    else if (state.tab === 'reports') renderReports();
    else if (state.tab === 'investors') renderInvestors();
    else if (state.tab === 'stores') renderStores();
    else if (state.tab === 'settings') renderSettings();
  }

  /* ---------------- Modal ---------------- */

  function openModal(opts) {
    const root = qs('modalRoot');
    root.innerHTML = `
      <div class="modal-mask">
        <form class="modal${opts.wide ? ' is-wide' : ''}" id="modalForm" novalidate>
          <div class="modal-head">
            <h3>${U.esc(opts.title)}</h3>
            ${opts.subtitle ? `<p>${U.esc(opts.subtitle)}</p>` : ''}
            <button type="button" class="modal-close" id="modalClose" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            ${opts.bodyHTML || ''}
            <div class="form-error" id="modalError"></div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" id="modalCancel">取消</button>
            <button type="submit" class="btn ${opts.submitClass || 'btn-primary'}">${U.esc(opts.submitText || '保存')}</button>
          </div>
        </form>
      </div>`;

    const mask = root.querySelector('.modal-mask');
    const form = root.querySelector('#modalForm');
    const errorEl = root.querySelector('#modalError');
    let closed = false;

    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };

    function close(result) {
      if (closed) return;
      closed = true;
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose(result);
    }

    function showError(message) {
      errorEl.textContent = message;
      errorEl.classList.add('is-visible');
    }

    root.querySelector('#modalClose').addEventListener('click', () => close(false));
    root.querySelector('#modalCancel').addEventListener('click', () => close(false));
    mask.addEventListener('mousedown', (event) => {
      if (event.target === mask) close(false);
    });
    document.addEventListener('keydown', onKey);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        const message = await opts.onSubmit(new FormData(form), form);
        if (typeof message === 'string' && message) {
          showError(message);
          submitButton.disabled = false;
          return;
        }
        close(true);
      } catch (err) {
        showError(err.message || '操作失败，请重试');
        submitButton.disabled = false;
      }
    });

    if (opts.onMount) opts.onMount(form);
    setTimeout(() => {
      const first = form.querySelector('input:not([type="hidden"]), select, textarea');
      if (first) first.focus();
    }, 40);
  }

  function confirmDialog(title, messageHTML, confirmText) {
    return new Promise((resolve) => {
      let settled = false;
      openModal({
        title,
        bodyHTML: `<div class="modal-text">${messageHTML}</div>`,
        submitText: confirmText || '确定',
        submitClass: 'btn-danger',
        onSubmit: () => {
          settled = true;
          resolve(true);
          return null;
        },
        onClose: () => {
          if (!settled) resolve(false);
        }
      });
    });
  }

  /* ---------------- Dashboard ---------------- */

  function renderDashboard() {
    const { start, end } = state.range;
    const summary = C.summarize(state.data, start, end);
    const shareInfo = C.shares(state.data, summary.distributable);
    const cum = C.cumulative(state.data, end);
    const investors = state.data.investors;
    const totalInvest = cum.totalInvest;
    const avgDaily = summary.revenue / summary.days;
    const annualized = totalInvest > 0 && summary.days >= ANNUALIZE_MIN_DAYS
      ? (summary.profit / totalInvest) * (365 / summary.days) * 100
      : null;
    const annualizedFoot = totalInvest <= 0
      ? '设置股东出资后显示'
      : summary.days < ANNUALIZE_MIN_DAYS
        ? `统计区间满 ${ANNUALIZE_MIN_DAYS} 天后显示`
        : '按本期净利 / 总投资估算';
    const records = allRecords();
    const ratioBad = investors.length > 0 && Math.abs(shareInfo.ratioSum - 100) >= 0.005;
    const chart = C.chartGroups(state.data, start, end);
    const chartModeLabel = chart.mode === 'day' ? '按日' : chart.mode === 'week' ? '按周' : '按月';

    let bannerHTML = '';
    if (!records.length && !investors.length) {
      bannerHTML = `
        <div class="onboarding">
          <h2>把这家羊肉米线店，算得明明白白</h2>
          <p>三步开始：设置股东 → 每天记收支 → 日/周/月看分红。数据只存在这台电脑上，每天自动备份。</p>
          <div class="steps">
            <div class="step"><span class="step-no">1</span><div><strong>设置股东与比例</strong><span>填写每位股东的出资额和分红比例</span></div></div>
            <div class="step"><span class="step-no">2</span><div><strong>记录每天收支</strong><span>营业收入、原材料、人工、房租水电等</span></div></div>
            <div class="step"><span class="step-no">3</span><div><strong>查看分红报表</strong><span>按日 / 周 / 月看利润和每股应分</span></div></div>
          </div>
          <div class="empty-actions" style="justify-content:flex-start">
            <button type="button" class="btn btn-primary" id="onboardInvestors">设置股东</button>
            <button type="button" class="btn btn-ghost" id="onboardEntry">先记一笔</button>
          </div>
        </div>`;
    } else if (investors.length && ratioBad) {
      bannerHTML = `
        <div class="banner warn">
          <span>分红比例合计 <strong>${U.pct(shareInfo.ratioSum)}</strong>，不是 100%。当前仍按现有比例计算，可能出现多分或少分。</span>
          <span class="banner-actions"><button type="button" class="btn btn-sm btn-soft" id="fixRatioBanner">去调整</button></span>
        </div>`;
    } else if (!investors.length && records.length) {
      bannerHTML = `
        <div class="banner info">
          <span>还没有设置股东，分红暂时无法计算。设置出资额与比例后，报表会自动生成每位股东应分。</span>
          <span class="banner-actions"><button type="button" class="btn btn-sm btn-soft" id="goInvestorsBanner">去设置</button></span>
        </div>`;
    } else if (summary.profit < 0) {
      bannerHTML = `
        <div class="banner warn">
          <span>本期净利润为负（<strong>${U.money(summary.profit)}</strong>），亏损会按股东比例分摊，备用金不留存。</span>
        </div>`;
    }

    const shareRows = investors.length ? shareInfo.shares.map((item, index) => {
      const roi = item.amount > 0 ? (item.share / item.amount) * 100 : null;
      return `
        <div class="share-row">
          ${avatarHTML(item.name, index)}
          <div class="share-name">
            <span>${U.esc(item.name)}</span>
            <small>比例 ${U.pct(item.ratio)} · 出资 ${U.money(item.amount)}</small>
          </div>
          <div class="share-amount">
            ${U.money(item.share)}
            <small>${roi === null ? '未填出资额' : `本期回报 ${U.pct(roi)}`}</small>
          </div>
        </div>`;
    }).join('') : `
      <div class="empty">
        <div class="empty-mark">股</div>
        <div class="empty-title">还没有股东</div>
        <div class="empty-sub">先设置出资额与分红比例，才能计算每人应分多少。</div>
        <div class="empty-actions"><button type="button" class="btn btn-soft btn-sm" id="emptyAddInvestor">新增股东</button></div>
      </div>`;

    const recentRows = records.slice(0, 8).map((record) => {
      const typeClass = record._type === 'income' ? 'income' : record._type === 'expense' ? 'expense' : 'capital';
      return `
        <div class="recent-row">
          <div class="recent-date">${U.esc(U.fmtDateShort(record.date))}<br>${U.esc(U.weekdayCN(record.date))}</div>
          <div class="recent-main">
            <div class="recent-title">${U.esc(record._type === 'capital' ? `开业投入 · ${recordCategory(record)}` : recordCategory(record))}</div>
            <div class="recent-note">${U.esc(record.note || recordSub(record) || TYPE_META[record._type].label)}</div>
          </div>
          <div class="recent-amount ${typeClass}">${recordAmount(record)}</div>
        </div>`;
    }).join('');

    const recentHTML = records.length ? recentRows : `
      <div class="empty">
        <div class="empty-mark">账</div>
        <div class="empty-title">还没有流水</div>
        <div class="empty-sub">去「记一笔」录入今天的营业收入或支出。</div>
        <div class="empty-actions"><button type="button" class="btn btn-soft btn-sm" id="emptyGoEntry">记第一笔</button></div>
      </div>`;

    qs('view').innerHTML = `
      ${bannerHTML}
      <div class="grid-kpi">
        <div class="kpi-card accent-brand">
          <div class="kpi-label">营业收入</div>
          <div class="kpi-value">${U.money(summary.revenue)}</div>
          <div class="kpi-foot">${summary.incomeCount} 笔 · 日均 <b>${U.money(avgDaily)}</b></div>
        </div>
        <div class="kpi-card accent-gold">
          <div class="kpi-label">营业支出</div>
          <div class="kpi-value">${U.money(summary.expenseTotal)}</div>
          <div class="kpi-foot">现金 ${U.money(summary.cashExpense)} · 折旧 ${U.money(summary.depreciation)}</div>
        </div>
        <div class="kpi-card accent-${summary.profit >= 0 ? 'green' : 'red'}">
          <div class="kpi-label">净利润</div>
          <div class="kpi-value ${summary.profit >= 0 ? 'is-pos' : 'is-neg'}">${U.money(summary.profit)}</div>
          <div class="kpi-foot">净利率 <b>${marginText(summary.profit, summary.revenue)}</b></div>
        </div>
        <div class="kpi-card accent-purple">
          <div class="kpi-label">可分配利润</div>
          <div class="kpi-value ${summary.distributable >= 0 ? 'is-pos' : 'is-neg'}">${U.money(summary.distributable)}</div>
          <div class="kpi-foot">${summary.reserve > 0 ? `已留备用金 ${U.money(summary.reserve)}` : '未留存备用金'}</div>
        </div>
        <div class="kpi-card accent-brand">
          <div class="kpi-label">股东总投资</div>
          <div class="kpi-value">${U.money(totalInvest)}</div>
          <div class="kpi-foot">${investors.length} 位股东 · 开业投入 ${U.money(cum.startupCost)}</div>
        </div>
        <div class="kpi-card accent-${annualized === null ? 'gold' : annualized >= 0 ? 'green' : 'red'}">
          <div class="kpi-label">年化回报率</div>
          <div class="kpi-value ${annualized === null ? '' : annualized >= 0 ? 'is-pos' : 'is-neg'}">${annualized === null ? '—' : U.pct(annualized)}</div>
          <div class="kpi-foot">${annualizedFoot}</div>
        </div>
      </div>

      <div class="grid-main section-gap">
        <div class="stack">
          <div class="card chart-card">
            <div class="card-head">
              <div>
                <h2>收支趋势</h2>
                <p>${U.esc(state.range.label)} · ${chartModeLabel}聚合 · 支出含折旧摊销</p>
              </div>
              <div class="chart-legend">
                <span class="legend-item"><span class="legend-dot"></span>收入</span>
                <span class="legend-item"><span class="legend-dot expense"></span>支出</span>
                <span class="legend-item"><span class="legend-dot profit"></span>净利润</span>
              </div>
            </div>
            ${Charts.cashflow(chart.groups)}
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <h2>支出构成</h2>
                <p>现金支出按分类汇总，折旧摊销单独列示</p>
              </div>
              <span class="badge badge-muted">合计 ${U.money(summary.expenseTotal)}</span>
            </div>
            ${Charts.categoryBars(summary.byCategory)}
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div>
                <h2>本期股东应分</h2>
                <p>可分配利润 ${U.money(summary.distributable)}</p>
              </div>
              <button type="button" class="link-btn" id="goInvestorsFromShares">股东页</button>
            </div>
            <div class="share-list">${shareRows}</div>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <h2>最近流水</h2>
                <p>最近 8 笔收入、支出与开业投入</p>
              </div>
              <button type="button" class="link-btn" id="goRecords">查看全部</button>
            </div>
            <div class="recent-list">${recentHTML}</div>
          </div>
        </div>
      </div>`;

    const onboardInvestors = qs('onboardInvestors');
    if (onboardInvestors) onboardInvestors.addEventListener('click', () => {
      switchTab('investors');
      openInvestorModal();
    });
    const onboardEntry = qs('onboardEntry');
    if (onboardEntry) onboardEntry.addEventListener('click', () => switchTab('entry'));
    const fixRatio = qs('fixRatioBanner');
    if (fixRatio) fixRatio.addEventListener('click', () => switchTab('investors'));
    const goInvestors = qs('goInvestorsBanner');
    if (goInvestors) goInvestors.addEventListener('click', () => switchTab('investors'));
    const shareLink = qs('goInvestorsFromShares');
    if (shareLink) shareLink.addEventListener('click', () => switchTab('investors'));
    const recordsLink = qs('goRecords');
    if (recordsLink) recordsLink.addEventListener('click', () => switchTab('records'));
    const emptyAddInvestor = qs('emptyAddInvestor');
    if (emptyAddInvestor) emptyAddInvestor.addEventListener('click', () => openInvestorModal());
    const emptyGoEntry = qs('emptyGoEntry');
    if (emptyGoEntry) emptyGoEntry.addEventListener('click', () => switchTab('entry'));
  }

  /* ---------------- Entry ---------------- */

  function renderEntry() {
    const today = U.todayISO();
    const summary = C.summarize(state.data, today, today);
    const todayRecords = allRecords().filter((record) => record.date === today);
    const cum = C.cumulative(state.data, today);
    const capitalCats = C.capitalByCategory(state.data);

    const todayRows = todayRecords.length ? todayRecords.map((record) => {
      const typeClass = record._type === 'income' ? 'income' : record._type === 'expense' ? 'expense' : 'capital';
      return `
        <div class="recent-row">
          <div class="recent-date">${U.esc(TYPE_META[record._type].label)}</div>
          <div class="recent-main">
            <div class="recent-title">${U.esc(recordCategory(record))}</div>
            <div class="recent-note">${U.esc(record.note || recordSub(record) || TYPE_META[record._type].label)}</div>
          </div>
          <div class="recent-amount ${typeClass}">${recordAmount(record)}</div>
        </div>`;
    }).join('') : '<div class="empty-inline">今天还没有记录</div>';

    const capitalRows = capitalCats.slice(0, 5).map((item) => (
      `<div class="stat-row"><span>${U.esc(item.name)}</span><strong>${U.money(item.amount)}</strong></div>`
    )).join('');

    qs('view').innerHTML = `
      <div class="grid-entry">
        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div>
                <h2>记收入</h2>
                <p>堂食、外卖、团购等营业收入</p>
              </div>
              <span class="type-tag income"><span class="dot"></span>收入</span>
            </div>
            <form id="incomeForm" class="form-grid" novalidate>
              <div class="field">
                <label>日期</label>
                <input type="date" name="date" value="${today}" required>
              </div>
              <div class="field">
                <label>收入渠道</label>
                <select name="channel">${options(Constants.INCOME_CHANNELS, '堂食')}</select>
              </div>
              <div class="field full">
                <label>金额</label>
                <div class="amount-input">
                  <span class="symbol">¥</span>
                  <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required>
                </div>
              </div>
              <div class="field full">
                <label>备注（可选）</label>
                <input type="text" name="note" maxlength="200" placeholder="如：午市 + 晚市，或外卖平台到账">
              </div>
              <div class="form-actions full">
                <button type="reset" class="btn btn-ghost">清空</button>
                <button type="submit" class="btn btn-primary">记收入</button>
              </div>
              <div class="form-error full"></div>
            </form>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <h2>记支出</h2>
                <p>原材料、人工、水电燃气、房租物业等</p>
              </div>
              <span class="type-tag"><span class="dot"></span>支出</span>
            </div>
            <form id="expenseForm" class="form-grid" novalidate>
              <div class="field">
                <label>日期</label>
                <input type="date" name="date" value="${today}" required>
              </div>
              <div class="field">
                <label>支出分类</label>
                <select name="category" id="expenseCategory">${options(Constants.EXPENSE_CATEGORY_LIST, '原材料')}</select>
              </div>
              <div class="field">
                <label>细分项目</label>
                <select name="sub" id="expenseSub">${options(Constants.EXPENSE_CATEGORIES['原材料'], '羊肉')}</select>
              </div>
              <div class="field">
                <label>支付方式</label>
                <select name="method">${options(Constants.PAY_METHODS, '微信')}</select>
              </div>
              <div class="field full">
                <label>金额</label>
                <div class="amount-input">
                  <span class="symbol">¥</span>
                  <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required>
                </div>
              </div>
              <div class="field full">
                <label>备注（可选）</label>
                <input type="text" name="note" maxlength="200" placeholder="如：羊腿肉 20 斤，供应商老李">
              </div>
              <div class="form-actions full">
                <button type="reset" class="btn btn-ghost">清空</button>
                <button type="submit" class="btn btn-primary">记支出</button>
              </div>
              <div class="form-error full"></div>
            </form>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div>
                <h2>今日概览</h2>
                <p>${U.esc(U.fmtDateCN(today))} ${U.esc(U.weekdayCN(today))}</p>
              </div>
            </div>
            <div class="today-stats">
              <div class="today-stat"><span>收入</span><strong>${U.money(summary.revenue)}</strong></div>
              <div class="today-stat"><span>支出</span><strong>${U.money(summary.expenseTotal)}</strong></div>
              <div class="today-stat"><span>净利</span><strong class="${summary.profit >= 0 ? 'pos' : 'neg'}">${U.money(summary.profit)}</strong></div>
            </div>
            <div class="recent-list today-list" style="margin-top:10px">${todayRows}</div>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <h2>开业投入</h2>
                <p>装修、设备、押金等，不计入日常支出</p>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="addCapital">记一笔</button>
            </div>
            <div class="stat-row"><span>累计开业投入</span><strong>${U.money(cum.startupCost)}</strong></div>
            <div class="stat-row"><span>累计可分配利润</span><strong>${U.money(cum.summary.distributable)}</strong></div>
            ${cum.paybackPct !== null ? `
              <div class="stat-row"><span>回本进度</span><strong>${U.pct(cum.paybackPct)}</strong></div>
              <div class="meter ${cum.paybackPct >= 100 ? 'is-ok' : ''}" style="margin-top:4px"><span style="width:${Math.min(100, Math.max(0, cum.paybackPct))}%"></span></div>
            ` : '<div class="hint" style="margin-top:10px">填好开业投入后，这里会显示回本进度。</div>'}
            ${capitalCats.length ? `<div style="margin-top:12px">${capitalRows}</div>` : ''}
          </div>
        </div>
      </div>`;

    const incomeForm = qs('incomeForm');
    incomeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFormError(incomeForm);
      const formData = new FormData(incomeForm);
      const date = String(formData.get('date') || '');
      const amount = U.round2(formData.get('amount'));
      if (!date || !U.dateFromISO(date)) {
        showFormError(incomeForm, '请选择正确的日期');
        return;
      }
      if (!(amount > 0)) {
        showFormError(incomeForm, '金额必须大于 0');
        return;
      }
      state.data.incomes.push({
        id: U.uid(),
        date,
        channel: String(formData.get('channel') || '堂食'),
        amount,
        note: String(formData.get('note') || '').trim(),
        createdAt: Date.now()
      });
      persist();
      toast(`已记收入 ${U.money(amount)}`);
      renderEntry();
    });

    const expenseForm = qs('expenseForm');
    const categorySelect = qs('expenseCategory');
    const subSelect = qs('expenseSub');
    categorySelect.addEventListener('change', () => {
      const subs = Constants.EXPENSE_CATEGORIES[categorySelect.value] || ['其他'];
      subSelect.innerHTML = options(subs, subs[0]);
    });
    expenseForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFormError(expenseForm);
      const formData = new FormData(expenseForm);
      const date = String(formData.get('date') || '');
      const amount = U.round2(formData.get('amount'));
      if (!date || !U.dateFromISO(date)) {
        showFormError(expenseForm, '请选择正确的日期');
        return;
      }
      if (!(amount > 0)) {
        showFormError(expenseForm, '金额必须大于 0');
        return;
      }
      state.data.expenses.push({
        id: U.uid(),
        date,
        category: String(formData.get('category') || '其他支出'),
        sub: String(formData.get('sub') || '其他'),
        method: String(formData.get('method') || '微信'),
        amount,
        note: String(formData.get('note') || '').trim(),
        createdAt: Date.now()
      });
      persist();
      toast(`已记支出 ${U.money(amount)}`);
      renderEntry();
    });

    const addCapital = qs('addCapital');
    if (addCapital) addCapital.addEventListener('click', () => openRecordModal('capital'));
  }

  /* ---------------- Records ---------------- */

  function filteredRecords() {
    const filter = state.recordFilter;
    const query = filter.q.trim().toLowerCase();
    return allRecords().filter((record) => {
      if (filter.type !== 'all' && record._type !== filter.type) return false;
      if (filter.start && record.date < filter.start) return false;
      if (filter.end && record.date > filter.end) return false;
      if (query) {
        const haystack = [record.note, record.category, record.sub, record.channel, record.method]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function renderRecords() {
    const all = allRecords();
    qs('view').innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h2>筛选流水</h2>
            <p>留空日期表示不限；搜索分类、备注或支付方式</p>
          </div>
          <span class="badge badge-muted">共 ${all.length} 笔</span>
        </div>
        <div class="filters">
          <div class="field">
            <label>开始日期</label>
            <input type="date" id="filterStart" value="${U.esc(state.recordFilter.start)}">
          </div>
          <div class="field">
            <label>结束日期</label>
            <input type="date" id="filterEnd" value="${U.esc(state.recordFilter.end)}">
          </div>
          <div class="field">
            <label>类型</label>
            <select id="filterType">
              <option value="all"${state.recordFilter.type === 'all' ? ' selected' : ''}>全部</option>
              <option value="income"${state.recordFilter.type === 'income' ? ' selected' : ''}>收入</option>
              <option value="expense"${state.recordFilter.type === 'expense' ? ' selected' : ''}>支出</option>
              <option value="capital"${state.recordFilter.type === 'capital' ? ' selected' : ''}>开业投入</option>
            </select>
          </div>
          <div class="field">
            <label>搜索</label>
            <input type="text" id="filterQuery" value="${U.esc(state.recordFilter.q)}" placeholder="输入关键词">
          </div>
          <div class="filter-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="resetFilter">重置</button>
            <button type="button" class="btn btn-primary btn-sm" id="applyFilter">筛选</button>
          </div>
        </div>
      </div>

      <div class="card section-gap">
        <div class="card-head">
          <div>
            <h2>流水明细</h2>
            <p id="recordSummaryText">—</p>
          </div>
          <span class="info-note no-print">修改或删除后会立即重算报表</span>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>分类</th>
                <th class="num">金额</th>
                <th>支付方式</th>
                <th>备注</th>
                <th class="num no-print">操作</th>
              </tr>
            </thead>
            <tbody id="recordTableBody"></tbody>
          </table>
        </div>
        <div id="recordEmpty"></div>
      </div>`;

    const applyFilter = () => {
      state.recordFilter = {
        type: qs('filterType').value,
        start: qs('filterStart').value,
        end: qs('filterEnd').value,
        q: qs('filterQuery').value
      };
      if (state.recordFilter.start && state.recordFilter.end && state.recordFilter.start > state.recordFilter.end) {
        toast('开始日期不能晚于结束日期', 'error');
        return;
      }
      updateRecordTable();
    };

    qs('applyFilter').addEventListener('click', applyFilter);
    qs('filterQuery').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyFilter();
    });
    qs('filterType').addEventListener('change', applyFilter);
    qs('filterStart').addEventListener('change', applyFilter);
    qs('filterEnd').addEventListener('change', applyFilter);
    qs('resetFilter').addEventListener('click', () => {
      state.recordFilter = { type: 'all', start: '', end: '', q: '' };
      qs('filterStart').value = '';
      qs('filterEnd').value = '';
      qs('filterType').value = 'all';
      qs('filterQuery').value = '';
      updateRecordTable();
    });

    qs('recordTableBody').addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit]');
      const deleteButton = event.target.closest('[data-delete]');
      if (editButton) {
        const record = allRecords().find((item) => item.id === editButton.dataset.id && item._type === editButton.dataset.edit);
        if (record) openRecordModal(record._type, record);
      }
      if (deleteButton) {
        const record = allRecords().find((item) => item.id === deleteButton.dataset.id && item._type === deleteButton.dataset.delete);
        if (record) deleteRecord(record);
      }
    });

    updateRecordTable();
  }

  function updateRecordTable() {
    const records = filteredRecords();
    const body = qs('recordTableBody');
    const summaryEl = qs('recordSummaryText');
    if (!body) return;

    const income = U.sum(records.filter((r) => r._type === 'income'), (r) => r.amount);
    const expense = U.sum(records.filter((r) => r._type === 'expense'), (r) => r.amount);
    const capital = U.sum(records.filter((r) => r._type === 'capital'), (r) => r.amount);
    summaryEl.textContent = `共 ${records.length} 笔 · 收入 ${U.money(income)} · 支出 ${U.money(expense)} · 开业投入 ${U.money(capital)}`;

    if (!records.length) {
      body.innerHTML = '';
      qs('recordEmpty').innerHTML = `
        <div class="empty">
          <div class="empty-mark">空</div>
          <div class="empty-title">没有符合条件的流水</div>
          <div class="empty-sub">调整筛选条件，或先记一笔。</div>
          <div class="empty-actions">
            <button type="button" class="btn btn-soft btn-sm" id="emptyRecordIncome">记收入</button>
            <button type="button" class="btn btn-ghost btn-sm" id="emptyRecordExpense">记支出</button>
          </div>
        </div>`;
      qs('emptyRecordIncome').addEventListener('click', () => openRecordModal('income'));
      qs('emptyRecordExpense').addEventListener('click', () => openRecordModal('expense'));
      return;
    }
    qs('recordEmpty').innerHTML = '';

    body.innerHTML = records.map((record) => {
      const meta = TYPE_META[record._type];
      const method = record._type === 'expense' ? record.method || '—' : '—';
      return `
        <tr>
          <td class="muted">${U.esc(record.date)}</td>
          <td><span class="badge ${meta.badge}">${meta.label}</span></td>
          <td>
            ${U.esc(recordCategory(record))}
            ${recordSub(record) ? `<span class="cell-sub">${U.esc(recordSub(record))}</span>` : ''}
          </td>
          <td class="num ${record._type === 'income' ? 'pos' : ''}">${recordAmount(record)}</td>
          <td class="muted">${U.esc(method)}</td>
          <td class="muted">${U.esc(record.note || '—')}</td>
          <td class="num no-print">
            <span class="row-actions">
              <button type="button" class="icon-btn" data-edit="${record._type}" data-id="${U.esc(record.id)}" title="编辑">编辑</button>
              <button type="button" class="icon-btn danger" data-delete="${record._type}" data-id="${U.esc(record.id)}" title="删除">删除</button>
            </span>
          </td>
        </tr>`;
    }).join('');
  }

  function openRecordModal(type, record) {
    const meta = TYPE_META[type];
    const isEdit = !!record;
    const today = U.todayISO();
    let bodyHTML = '';

    if (type === 'income') {
      bodyHTML = `
        <div class="form-grid">
          <div class="field">
            <label>日期</label>
            <input type="date" name="date" value="${record ? record.date : today}" required>
          </div>
          <div class="field">
            <label>收入渠道</label>
            <select name="channel">${options(Constants.INCOME_CHANNELS, record ? record.channel : '堂食')}</select>
          </div>
          <div class="field full">
            <label>金额</label>
            <div class="amount-input">
              <span class="symbol">¥</span>
              <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" value="${record ? U.plain(record.amount) : ''}" placeholder="0.00" required>
            </div>
          </div>
          <div class="field full">
            <label>备注（可选）</label>
            <input type="text" name="note" maxlength="200" value="${record ? U.esc(record.note) : ''}" placeholder="如：午市 + 晚市">
          </div>
        </div>`;
    } else if (type === 'expense') {
      const category = record ? record.category : '原材料';
      const subs = Constants.EXPENSE_CATEGORIES[category] || ['其他'];
      bodyHTML = `
        <div class="form-grid">
          <div class="field">
            <label>日期</label>
            <input type="date" name="date" value="${record ? record.date : today}" required>
          </div>
          <div class="field">
            <label>支出分类</label>
            <select name="category" id="modalExpenseCategory">${options(Constants.EXPENSE_CATEGORY_LIST, category)}</select>
          </div>
          <div class="field">
            <label>细分项目</label>
            <select name="sub" id="modalExpenseSub">${options(subs, record ? record.sub : subs[0])}</select>
          </div>
          <div class="field">
            <label>支付方式</label>
            <select name="method">${options(Constants.PAY_METHODS, record ? record.method : '微信')}</select>
          </div>
          <div class="field full">
            <label>金额</label>
            <div class="amount-input">
              <span class="symbol">¥</span>
              <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" value="${record ? U.plain(record.amount) : ''}" placeholder="0.00" required>
            </div>
          </div>
          <div class="field full">
            <label>备注（可选）</label>
            <input type="text" name="note" maxlength="200" value="${record ? U.esc(record.note) : ''}" placeholder="如：羊腿肉 20 斤，供应商老李">
          </div>
        </div>`;
    } else {
      bodyHTML = `
        <div class="form-grid">
          <div class="field">
            <label>日期</label>
            <input type="date" name="date" value="${record ? record.date : today}" required>
          </div>
          <div class="field">
            <label>投入分类</label>
            <select name="category">${options(Constants.CAPITAL_CATEGORIES, record ? record.category : '装修')}</select>
          </div>
          <div class="field full">
            <label>金额</label>
            <div class="amount-input">
              <span class="symbol">¥</span>
              <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" value="${record ? U.plain(record.amount) : ''}" placeholder="0.00" required>
            </div>
          </div>
          <div class="field full">
            <label>备注（可选）</label>
            <input type="text" name="note" maxlength="200" value="${record ? U.esc(record.note) : ''}" placeholder="如：门头改造、厨房设备首付">
          </div>
          <div class="field full"><div class="hint">开业投入不计入日常支出，只用于计算总投资和回本进度；折旧摊销请在设置中填写。</div></div>
        </div>`;
    }

    openModal({
      title: isEdit ? `编辑${meta.label}` : `新增${meta.label}`,
      subtitle: isEdit ? '修改后立即生效，并会影响相关报表' : '金额、日期为必填，其余可留空',
      bodyHTML,
      submitText: isEdit ? '保存修改' : `添加${meta.label}`,
      onMount(form) {
        if (type !== 'expense') return;
        const categorySelect = form.querySelector('#modalExpenseCategory');
        const subSelect = form.querySelector('#modalExpenseSub');
        categorySelect.addEventListener('change', () => {
          const subs = Constants.EXPENSE_CATEGORIES[categorySelect.value] || ['其他'];
          subSelect.innerHTML = options(subs, subs[0]);
        });
      },
      onSubmit(formData) {
        const date = String(formData.get('date') || '');
        const amount = U.round2(formData.get('amount'));
        if (!date || !U.dateFromISO(date)) return '请选择正确的日期';
        if (!(amount > 0)) return '金额必须大于 0';

        const payload = {
          date,
          amount,
          note: String(formData.get('note') || '').trim()
        };
        if (type === 'income') payload.channel = String(formData.get('channel') || '堂食');
        if (type === 'expense') {
          payload.category = String(formData.get('category') || '其他支出');
          payload.sub = String(formData.get('sub') || '其他');
          payload.method = String(formData.get('method') || '微信');
        }
        if (type === 'capital') payload.category = String(formData.get('category') || '其他');

        const collection = state.data[meta.collection];
        if (isEdit) {
          const index = collection.findIndex((item) => item.id === record.id);
          if (index >= 0) collection[index] = Object.assign({}, collection[index], payload);
        } else {
          collection.push(Object.assign({ id: U.uid(), createdAt: Date.now() }, payload));
        }
        persist();
        toast(isEdit ? `${meta.label}已更新` : `已添加${meta.label} ${U.money(amount)}`);
        renderView();
        return null;
      }
    });
  }

  async function deleteRecord(record) {
    const meta = TYPE_META[record._type];
    const ok = await confirmDialog(
      `删除${meta.label}`,
      `确定删除 <b>${U.esc(record.date)}</b> 的${meta.label} <b>${U.esc(recordCategory(record))} ${U.money(record.amount)}</b> 吗？<br>删除后报表会立即重算，且无法撤销。`,
      '删除'
    );
    if (!ok) return;
    const collection = state.data[meta.collection];
    const index = collection.findIndex((item) => item.id === record.id);
    if (index >= 0) collection.splice(index, 1);
    persist();
    toast('已删除');
    renderView();
  }

  function exportRecords(records, label) {
    const rows = [
      [`${state.data.settings.shopName} - ${label}`],
      [`导出时间：${new Date().toLocaleString('zh-CN')}`],
      [`记录数量：${records.length} 笔`],
      [],
      ['日期', '类型', '分类', '细分/渠道', '金额', '支付方式', '备注']
    ];
    records.forEach((record) => {
      rows.push([
        record.date,
        TYPE_META[record._type].label,
        recordCategory(record),
        recordSub(record),
        U.plain(record.amount),
        record._type === 'expense' ? record.method || '' : '',
        record.note || ''
      ]);
    });
    const income = U.sum(records.filter((r) => r._type === 'income'), (r) => r.amount);
    const expense = U.sum(records.filter((r) => r._type === 'expense'), (r) => r.amount);
    const capital = U.sum(records.filter((r) => r._type === 'capital'), (r) => r.amount);
    rows.push([]);
    rows.push(['合计收入', U.plain(income)]);
    rows.push(['合计支出', U.plain(expense)]);
    rows.push(['合计开业投入', U.plain(capital)]);

    const content = U.buildCSV(rows);
    Store.exportFile(`${label}-${U.todayISO()}.csv`, content, 'text/csv;charset=utf-8')
      .then((result) => {
        if (result && result.ok) {
          toast(result.browser ? '已下载 CSV 文件' : `已导出到 ${result.filePath}`, 'info', 5000);
        } else if (result && !result.canceled) {
          toast(result.error || '导出失败', 'error');
        }
      })
      .catch((err) => toast(`导出失败：${err.message}`, 'error'));
  }

  function exportFilteredRecords() {
    const records = filteredRecords();
    if (!records.length) {
      toast('当前筛选结果为空，没有可导出的记录', 'info');
      return;
    }
    exportRecords(records, '流水明细');
  }

  /* ---------------- Reports ---------------- */

  function renderReports() {
    const { start, end } = state.range;
    const summary = C.summarize(state.data, start, end);
    const shareInfo = C.shares(state.data, summary.distributable);
    const cum = C.cumulative(state.data, end);
    const investors = state.data.investors;
    const periods = C.reportPeriods(state.data, start, end, state.reportMode);
    const ratioBad = investors.length > 0 && Math.abs(shareInfo.ratioSum - 100) >= 0.005;
    const hasRangeData = summary.revenue > 0 || summary.cashExpense > 0 || summary.depreciation > 0;
    const modeLabel = Constants.REPORT_MODE_LABELS[state.reportMode];

    const investorHeads = investors.map((investor) => (
      `<th class="num">${U.esc(investor.name)}<span class="cell-sub">${U.pct(investor.ratio)}</span></th>`
    )).join('');

    const rowsHTML = periods.map((period) => {
      const ps = period.summary;
      const shareCells = investors.map((investor) => {
        const item = period.shares.find((share) => share.id === investor.id);
        const value = item ? item.share : 0;
        return `<td class="num ${value < 0 ? 'neg' : ''}">${U.money(value)}</td>`;
      }).join('');
      return `
        <tr>
          <td class="period-cell">${U.esc(period.label)}${period.start !== period.end ? `<span>${U.esc(U.fmtDateShort(period.start))} - ${U.esc(U.fmtDateShort(period.end))}</span>` : ''}</td>
          <td class="num">${U.money(ps.revenue)}</td>
          <td class="num">${U.money(ps.cashExpense)}</td>
          <td class="num">${U.money(ps.depreciation)}</td>
          <td class="num ${ps.profit < 0 ? 'neg' : ps.profit > 0 ? 'pos' : ''}">${U.money(ps.profit)}</td>
          <td class="num">${U.money(ps.distributable)}</td>
          ${shareCells}
        </tr>`;
    }).join('');

    const totalShareCells = investors.map((investor) => {
      const item = shareInfo.shares.find((share) => share.id === investor.id);
      const value = item ? item.share : 0;
      return `<td class="num ${value < 0 ? 'neg' : ''}">${U.money(value)}</td>`;
    }).join('');

    const tableHTML = hasRangeData && periods.length ? `
      <div class="table-wrap">
        <table class="table table-report">
          <thead>
            <tr>
              <th>期间</th>
              <th class="num">营业收入</th>
              <th class="num">现金支出</th>
              <th class="num">折旧摊销</th>
              <th class="num">净利润</th>
              <th class="num">可分配</th>
              ${investorHeads}
            </tr>
          </thead>
          <tbody>
            ${rowsHTML}
            <tr class="total-row">
              <td class="period-cell">合计</td>
              <td class="num">${U.money(summary.revenue)}</td>
              <td class="num">${U.money(summary.cashExpense)}</td>
              <td class="num">${U.money(summary.depreciation)}</td>
              <td class="num ${summary.profit < 0 ? 'neg' : 'pos'}">${U.money(summary.profit)}</td>
              <td class="num">${U.money(summary.distributable)}</td>
              ${totalShareCells}
            </tr>
          </tbody>
        </table>
      </div>` : `
      <div class="empty">
        <div class="empty-mark">报</div>
        <div class="empty-title">该区间还没有经营数据</div>
        <div class="empty-sub">先去「记一笔」录入营业收入或支出，报表会自动生成。</div>
        <div class="empty-actions"><button type="button" class="btn btn-soft btn-sm" id="reportGoEntry">去记一笔</button></div>
      </div>`;

    const cumShareMap = new Map(cum.shares.map((item) => [item.id, item]));
    const investorRows = investors.map((investor, index) => {
      const periodShare = shareInfo.shares.find((item) => item.id === investor.id)?.share || 0;
      const cumulativeShare = cumShareMap.get(investor.id)?.share || 0;
      const periodRoi = investor.amount > 0 ? (periodShare / investor.amount) * 100 : null;
      const cumulativeRoi = investor.amount > 0 ? (cumulativeShare / investor.amount) * 100 : null;
      const annualized = cumulativeRoi === null || cum.days < ANNUALIZE_MIN_DAYS
        ? null
        : cumulativeRoi * (365 / cum.days);
      return `
        <tr>
          <td><span class="investor-inline">${avatarHTML(investor.name, index)}${U.esc(investor.name)}</span></td>
          <td class="num">${U.pct(investor.ratio)}</td>
          <td class="num">${U.money(investor.amount)}</td>
          <td class="num ${periodShare < 0 ? 'neg' : ''}">${U.money(periodShare)}</td>
          <td class="num">${periodRoi === null ? '—' : U.pct(periodRoi)}</td>
          <td class="num ${cumulativeShare < 0 ? 'neg' : ''}">${U.money(cumulativeShare)}</td>
          <td class="num ${cumulativeRoi === null ? '' : cumulativeRoi < 0 ? 'neg' : 'pos'}">${cumulativeRoi === null ? '—' : U.pct(cumulativeRoi)}</td>
          <td class="num ${annualized === null ? '' : annualized < 0 ? 'neg' : 'pos'}">${annualized === null ? '—' : U.pct(annualized)}</td>
        </tr>`;
    }).join('');

    const investorSummaryHTML = investors.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>股东</th>
              <th class="num">比例</th>
              <th class="num">出资额</th>
              <th class="num">本期应分</th>
              <th class="num">本期收益率</th>
              <th class="num">累计应分</th>
              <th class="num">累计收益率</th>
              <th class="num">年化收益率</th>
            </tr>
          </thead>
          <tbody>${investorRows}</tbody>
        </table>
      </div>
      <p class="ratio-note">累计应分按当前分红比例计算至 ${U.esc(end)}；年化收益率 = 累计收益率 ÷ 经营 ${cum.days} 天 × 365，经营满 ${ANNUALIZE_MIN_DAYS} 天后显示，仅供评估参考。</p>` : `
      <div class="empty">
        <div class="empty-mark">股</div>
        <div class="empty-title">还没有设置股东</div>
        <div class="empty-sub">设置出资额与分红比例后，这里会显示每位股东的应分与收益率。</div>
        <div class="empty-actions"><button type="button" class="btn btn-soft btn-sm" id="reportGoInvestors">去设置股东</button></div>
      </div>`;

    qs('view').innerHTML = `
      <div class="card">
        <div class="report-toolbar">
          <div class="seg" id="reportModes">
            ${['day', 'week', 'month', 'year'].map((mode) => (
              `<button type="button" class="seg-btn${state.reportMode === mode ? ' is-active' : ''}" data-mode="${mode}">${Constants.REPORT_MODE_LABELS[mode]}</button>`
            )).join('')}
          </div>
          <div class="head-actions">
            <button type="button" class="btn btn-ghost btn-sm no-print" id="printReport">打印</button>
            <button type="button" class="btn btn-ghost btn-sm no-print" id="exportPdfReport">导出 PDF</button>
            <button type="button" class="btn btn-soft btn-sm" id="exportReport">导出报表 CSV</button>
          </div>
        </div>

        ${ratioBad ? `
          <div class="banner warn">
            <span>分红比例合计为 <strong>${U.pct(shareInfo.ratioSum)}</strong>，与 100% 不一致。表格按现有比例计算，可能出现多分或少分。</span>
            <span class="banner-actions"><button type="button" class="btn btn-sm btn-soft" id="reportFixRatio">去调整</button></span>
          </div>` : ''}

        <div class="report-summary">
          <div class="mini-kpi"><span>营业收入</span><strong>${U.money(summary.revenue)}</strong></div>
          <div class="mini-kpi"><span>营业支出（含折旧）</span><strong>${U.money(summary.expenseTotal)}</strong></div>
          <div class="mini-kpi"><span>净利润</span><strong class="${summary.profit >= 0 ? 'pos' : 'neg'}">${U.money(summary.profit)}</strong></div>
          <div class="mini-kpi"><span>可分配利润</span><strong class="${summary.distributable >= 0 ? 'pos' : 'neg'}">${U.money(summary.distributable)}</strong></div>
          <div class="mini-kpi"><span>净利率</span><strong>${marginText(summary.profit, summary.revenue)}</strong></div>
          <div class="mini-kpi"><span>分红比例合计</span><strong class="${ratioBad ? 'neg' : ''}">${investors.length ? U.pct(shareInfo.ratioSum) : '未设置'}</strong></div>
        </div>

        ${tableHTML}
      </div>

      <div class="card section-gap">
        <div class="card-head">
          <div>
            <h2>股东收益汇总</h2>
            <p>${U.esc(state.range.label)}应分 + 自开业以来累计应分</p>
          </div>
          <span class="badge badge-muted">经营 ${cum.days} 天</span>
        </div>
        ${investorSummaryHTML}
      </div>`;

    qs('reportModes').querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.reportMode = button.dataset.mode;
        renderReports();
      });
    });
    const printButton = qs('printReport');
    if (printButton) printButton.addEventListener('click', () => window.print());
    const pdfButton = qs('exportPdfReport');
    if (pdfButton) pdfButton.addEventListener('click', openPdfExportModal);
    qs('exportReport').addEventListener('click', exportReportCSV);
    const reportFixRatio = qs('reportFixRatio');
    if (reportFixRatio) reportFixRatio.addEventListener('click', () => switchTab('investors'));
    const reportGoEntry = qs('reportGoEntry');
    if (reportGoEntry) reportGoEntry.addEventListener('click', () => switchTab('entry'));
    const reportGoInvestors = qs('reportGoInvestors');
    if (reportGoInvestors) reportGoInvestors.addEventListener('click', () => switchTab('investors'));
  }

  function exportReportCSV() {
    const { start, end } = state.range;
    const summary = C.summarize(state.data, start, end);
    const shareInfo = C.shares(state.data, summary.distributable);
    const cum = C.cumulative(state.data, end);
    const periods = C.reportPeriods(state.data, start, end, state.reportMode);
    const investors = state.data.investors;
    const modeLabel = Constants.REPORT_MODE_LABELS[state.reportMode];

    const rows = [
      [`${state.data.settings.shopName} - 分红报表`],
      [`统计区间：${start} 至 ${end}`],
      [`统计粒度：${modeLabel}`],
      [`导出时间：${new Date().toLocaleString('zh-CN')}`],
      [],
      ['期间', '起止日期', '营业收入', '现金支出', '折旧摊销', '净利润', '净利率', '可分配利润', ...investors.map((investor) => `${investor.name} 应分（${investor.ratio}%）`)]
    ];

    periods.forEach((period) => {
      const ps = period.summary;
      const margin = netMargin(ps.profit, ps.revenue);
      rows.push([
        period.label,
        `${period.start} 至 ${period.end}`,
        U.plain(ps.revenue),
        U.plain(ps.cashExpense),
        U.plain(ps.depreciation),
        U.plain(ps.profit),
        margin === null ? '' : `${margin.toFixed(2)}%`,
        U.plain(ps.distributable),
        ...investors.map((investor) => U.plain(period.shares.find((item) => item.id === investor.id)?.share || 0))
      ]);
    });

    const totalMargin = netMargin(summary.profit, summary.revenue);
    rows.push([
      '合计',
      `${start} 至 ${end}`,
      U.plain(summary.revenue),
      U.plain(summary.cashExpense),
      U.plain(summary.depreciation),
      U.plain(summary.profit),
      totalMargin === null ? '' : `${totalMargin.toFixed(2)}%`,
      U.plain(summary.distributable),
      ...investors.map((investor) => U.plain(shareInfo.shares.find((item) => item.id === investor.id)?.share || 0))
    ]);

    rows.push([]);
    rows.push(['股东收益汇总（截至期末）']);
    rows.push(['股东', '分红比例', '出资额', '本期应分', '本期收益率', '累计应分', '累计收益率', '年化收益率']);
    const cumMap = new Map(cum.shares.map((item) => [item.id, item]));
    investors.forEach((investor) => {
      const periodShare = shareInfo.shares.find((item) => item.id === investor.id)?.share || 0;
      const cumulativeShare = cumMap.get(investor.id)?.share || 0;
      const periodRoi = investor.amount > 0 ? (periodShare / investor.amount) * 100 : null;
      const cumulativeRoi = investor.amount > 0 ? (cumulativeShare / investor.amount) * 100 : null;
      const annualized = cumulativeRoi === null || cum.days < ANNUALIZE_MIN_DAYS
        ? null
        : cumulativeRoi * (365 / cum.days);
      rows.push([
        investor.name,
        `${investor.ratio}%`,
        U.plain(investor.amount),
        U.plain(periodShare),
        periodRoi === null ? '' : `${periodRoi.toFixed(2)}%`,
        U.plain(cumulativeShare),
        cumulativeRoi === null ? '' : `${cumulativeRoi.toFixed(2)}%`,
        annualized === null ? '' : `${annualized.toFixed(2)}%`
      ]);
    });

    rows.push([]);
    rows.push(['口径说明']);
    rows.push(['净利润 = 营业收入 - 现金支出 - 折旧摊销']);
    rows.push(['可分配利润 = 净利润 - 备用金留存（仅盈利时按设置比例计提）']);
    rows.push(['股东应分 = 可分配利润 × 当前分红比例；亏损按比例分摊']);
    rows.push([`备用金留存比例：${summary.reservePct}%；每月折旧摊销：${U.plain(state.data.settings.depreciationMonthly)} 元`]);
    rows.push([`经营天数：${cum.days} 天；累计应分截至 ${end}`]);

    const content = U.buildCSV(rows);
    Store.exportFile(`分红报表-${start}-${end}-${modeLabel}.csv`, content, 'text/csv;charset=utf-8')
      .then((result) => {
        if (result && result.ok) {
          toast(result.browser ? '已下载报表 CSV' : `已导出到 ${result.filePath}`, 'info', 5000);
        } else if (result && !result.canceled) {
          toast(result.error || '导出失败', 'error');
        }
      })
      .catch((err) => toast(`导出失败：${err.message}`, 'error'));
  }

  /* ---------------- PDF export ---------------- */

  function exportPdfReport(type, periodKey) {
    const html = window.PdfReport.buildHTML(state.data, type, periodKey);
    const label = type === 'month' ? `${periodKey} 月度报表` : `${periodKey} 年度报表`;
    const filename = `${state.data.settings.shopName}-${label}.pdf`;
    toast('正在生成 PDF…', 'info', 2500);
    Store.exportPdf(html, filename)
      .then((result) => {
        if (result && result.ok) {
          if (result.html) toast('浏览器拦截了弹窗，已下载报表 HTML，可打开后打印为 PDF', 'info', 6000);
          else if (result.browser) toast('已打开打印窗口，可选择「另存为 PDF」', 'info', 6000);
          else toast(`已导出到 ${result.filePath}`, 'info', 6000);
        } else if (result && !result.canceled) {
          toast(result.error || '导出失败', 'error');
        }
      })
      .catch((err) => toast(`导出失败：${err.message}`, 'error'));
  }

  function openPdfExportModal() {
    const today = U.todayISO();
    const baseDate = state.range.start || today;
    const defMonth = U.monthKey(baseDate);
    const defYear = baseDate.slice(0, 4);
    const startYear = Number((C.effectiveStart(state.data) || today).slice(0, 4));
    const endYear = Number(today.slice(0, 4));
    const lo = Math.min(startYear, endYear);
    const hi = Math.max(startYear, endYear);
    const years = [];
    for (let y = hi; y >= lo; y -= 1) years.push(y);

    openModal({
      title: '导出 PDF 报表',
      subtitle: '生成月度或年度的收支与分红报表（A4，可打印存档）',
      submitText: '生成 PDF',
      bodyHTML: `
        <div class="form-grid">
          <div class="field">
            <label>报表类型</label>
            <select name="pdfType" id="pdfType">
              <option value="month">月度报表</option>
              <option value="year">年度报表</option>
            </select>
          </div>
          <div class="field" id="pdfMonthField">
            <label>月份</label>
            <input type="month" name="pdfMonth" id="pdfMonth" value="${U.esc(defMonth)}">
          </div>
          <div class="field" id="pdfYearField" style="display:none">
            <label>年份</label>
            <select name="pdfYear" id="pdfYear">
              ${years.map((y) => `<option value="${y}"${String(y) === defYear ? ' selected' : ''}>${y}年</option>`).join('')}
            </select>
          </div>
        </div>
        <p class="ratio-note">月度报表含当月收支构成、每日概览与股东分红；年度报表含全年汇总、逐月趋势与股东分红。</p>`,
      onMount: (form) => {
        const typeSel = form.querySelector('#pdfType');
        const monthField = form.querySelector('#pdfMonthField');
        const yearField = form.querySelector('#pdfYearField');
        const sync = () => {
          const isMonth = typeSel.value === 'month';
          monthField.style.display = isMonth ? '' : 'none';
          yearField.style.display = isMonth ? 'none' : '';
        };
        typeSel.addEventListener('change', sync);
        sync();
      },
      onSubmit: (formData) => {
        const type = formData.get('pdfType');
        const periodKey = type === 'month'
          ? String(formData.get('pdfMonth') || '')
          : String(formData.get('pdfYear') || '');
        if (type === 'month' && !/^\d{4}-\d{2}$/.test(periodKey)) return '请选择有效的月份';
        if (type === 'year' && !/^\d{4}$/.test(periodKey)) return '请选择有效的年份';
        exportPdfReport(type, periodKey);
        return null;
      }
    });
  }

  /* ---------------- Investors ---------------- */

  function renderInvestors() {
    const cum = C.cumulative(state.data, U.todayISO());
    const investors = state.data.investors;
    const totalInvest = cum.totalInvest;
    const ratioSum = cum.ratioSum;
    const ratioBad = investors.length > 0 && Math.abs(ratioSum - 100) >= 0.005;
    const capitalCats = C.capitalByCategory(state.data);
    const cumMap = new Map(cum.shares.map((item) => [item.id, item]));

    const investorRows = investors.map((investor, index) => {
      const cumulativeShare = cumMap.get(investor.id)?.share || 0;
      const roi = investor.amount > 0 ? (cumulativeShare / investor.amount) * 100 : null;
      const annualized = roi === null || cum.days < ANNUALIZE_MIN_DAYS
        ? null
        : roi * (365 / cum.days);
      return `
        <tr>
          <td><span class="investor-inline">${avatarHTML(investor.name, index)}${U.esc(investor.name)}</span></td>
          <td class="num">${U.money(investor.amount)}</td>
          <td>
            <span class="ratio-cell">${U.pct(investor.ratio)}<span class="meter"><span style="width:${Math.min(100, Math.max(0, investor.ratio))}%"></span></span></span>
          </td>
          <td class="num ${cumulativeShare < 0 ? 'neg' : ''}">${U.money(cumulativeShare)}</td>
          <td class="num ${roi === null ? '' : roi < 0 ? 'neg' : 'pos'}">${roi === null ? '—' : U.pct(roi)}</td>
          <td class="num ${annualized === null ? '' : annualized < 0 ? 'neg' : 'pos'}">${annualized === null ? '—' : U.pct(annualized)}</td>
          <td class="num">
            <span class="row-actions">
              <button type="button" class="icon-btn" data-investor-edit="${U.esc(investor.id)}" title="编辑">编辑</button>
              <button type="button" class="icon-btn danger" data-investor-delete="${U.esc(investor.id)}" title="删除">删除</button>
            </span>
          </td>
        </tr>`;
    }).join('');

    const tableHTML = investors.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>股东</th>
              <th class="num">出资额</th>
              <th>分红比例</th>
              <th class="num">累计应分（截至今日）</th>
              <th class="num">累计收益率</th>
              <th class="num">年化收益率</th>
              <th class="num">操作</th>
            </tr>
          </thead>
          <tbody>${investorRows}</tbody>
        </table>
      </div>` : `
      <div class="empty">
        <div class="empty-mark">股</div>
        <div class="empty-title">还没有股东</div>
        <div class="empty-sub">添加股东、填写出资额与分红比例，合计建议为 100%。</div>
        <div class="empty-actions"><button type="button" class="btn btn-soft btn-sm" id="emptyInvestorAdd">新增股东</button></div>
      </div>`;

    const capitalList = capitalCats.length ? capitalCats.map((item) => (
      `<div class="stat-row"><span>${U.esc(item.name)}</span><strong>${U.money(item.amount)}</strong></div>`
    )).join('') : '<div class="empty-inline">还没有记录开业投入</div>';

    qs('view').innerHTML = `
      <div class="grid-kpi">
        <div class="kpi-card accent-brand">
          <div class="kpi-label">股东人数</div>
          <div class="kpi-value">${investors.length} 人</div>
          <div class="kpi-foot">分红比例合计 <b>${investors.length ? U.pct(ratioSum) : '—'}</b></div>
        </div>
        <div class="kpi-card accent-gold">
          <div class="kpi-label">投资总额</div>
          <div class="kpi-value">${U.money(totalInvest)}</div>
          <div class="kpi-foot">开业投入 ${U.money(cum.startupCost)}</div>
        </div>
        <div class="kpi-card accent-${ratioBad ? 'red' : 'green'}">
          <div class="kpi-label">比例合计</div>
          <div class="kpi-value ${ratioBad ? 'is-neg' : 'is-pos'}">${investors.length ? U.pct(ratioSum) : '—'}</div>
          <div class="kpi-foot">${ratioBad ? '建议调整为 100%' : '可以完整分配'}</div>
        </div>
        <div class="kpi-card accent-purple">
          <div class="kpi-label">累计可分配</div>
          <div class="kpi-value ${cum.summary.distributable >= 0 ? 'is-pos' : 'is-neg'}">${U.money(cum.summary.distributable)}</div>
          <div class="kpi-foot">经营 ${cum.days} 天 · 截至今天</div>
        </div>
        <div class="kpi-card accent-gold">
          <div class="kpi-label">回本进度</div>
          <div class="kpi-value">${cum.paybackPct === null ? '—' : U.pct(cum.paybackPct)}</div>
          <div class="kpi-foot">累计可分配 ÷ 开业投入</div>
        </div>
      </div>

      ${ratioBad ? `
        <div class="banner warn section-gap">
          <span>分红比例合计 <strong>${U.pct(ratioSum)}</strong>，与 100% 不一致，可能出现多分或少分。修改比例会按新比例重算历史报表。</span>
          <span class="banner-actions">
            <button type="button" class="btn btn-sm btn-soft" id="autoAllocate">按出资额自动分配</button>
          </span>
        </div>` : ''}

      <div class="grid-main ${ratioBad ? '' : 'section-gap'}">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>股东列表</h2>
              <p>累计应分按当前比例从开业算到今天</p>
            </div>
            <button type="button" class="btn btn-soft btn-sm" id="addInvestorInline">新增股东</button>
          </div>
          ${tableHTML}
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div>
                <h2>开业投入与回本</h2>
                <p>开业投入不计入日常支出</p>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="investorAddCapital">记一笔</button>
            </div>
            <div class="stat-row"><span>开业投入合计</span><strong>${U.money(cum.startupCost)}</strong></div>
            <div class="stat-row"><span>累计可分配利润</span><strong>${U.money(cum.summary.distributable)}</strong></div>
            <div class="stat-row"><span>回本进度</span><strong>${cum.paybackPct === null ? '—' : U.pct(cum.paybackPct)}</strong></div>
            <div class="meter ${cum.paybackPct !== null && cum.paybackPct >= 100 ? 'is-ok' : ''}" style="margin:2px 0 12px">
              <span style="width:${cum.paybackPct === null ? 0 : Math.min(100, Math.max(0, cum.paybackPct))}%"></span>
            </div>
            ${capitalList}
          </div>

          <div class="card">
            <div class="card-head"><div><h2>比例设置说明</h2></div></div>
            <ul class="rule-list">
              <li><b>比例可以手填</b>，用于技术股、管理股等与出资额不一致的情况；合计建议为 100%。</li>
              <li><b>按出资额建议</b>只是把比例自动填成出资占比，之后仍可手动修改。</li>
              <li><b>修改比例会重算历史</b>，当前版本不保留比例生效日期。</li>
              <li><b>亏损按比例分摊</b>；盈利时先按设置留存备用金，再分配。</li>
            </ul>
          </div>
        </div>
      </div>`;

    const addInvestorInline = qs('addInvestorInline');
    if (addInvestorInline) addInvestorInline.addEventListener('click', () => openInvestorModal());
    const emptyInvestorAdd = qs('emptyInvestorAdd');
    if (emptyInvestorAdd) emptyInvestorAdd.addEventListener('click', () => openInvestorModal());
    const autoAllocate = qs('autoAllocate');
    if (autoAllocate) autoAllocate.addEventListener('click', () => {
      autoAllocateRatios();
    });
    const investorAddCapital = qs('investorAddCapital');
    if (investorAddCapital) investorAddCapital.addEventListener('click', () => openRecordModal('capital'));

    qs('view').querySelectorAll('[data-investor-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const investor = state.data.investors.find((item) => item.id === button.dataset.investorEdit);
        if (investor) openInvestorModal(investor);
      });
    });
    qs('view').querySelectorAll('[data-investor-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        const investor = state.data.investors.find((item) => item.id === button.dataset.investorDelete);
        if (investor) deleteInvestor(investor);
      });
    });
  }

  function openInvestorModal(investor) {
    const isEdit = !!investor;
    openModal({
      title: isEdit ? '编辑股东' : '新增股东',
      subtitle: '分红比例合计建议为 100%；修改比例后历史报表会按新比例重算',
      bodyHTML: `
        <div class="form-grid">
          <div class="field full">
            <label>股东姓名</label>
            <input type="text" name="name" maxlength="30" value="${investor ? U.esc(investor.name) : ''}" placeholder="如：张三" required>
          </div>
          <div class="field">
            <label>出资额（元）</label>
            <input type="number" name="amount" min="0" step="0.01" inputmode="decimal" value="${investor ? U.plain(investor.amount) : ''}" placeholder="0.00">
            <div class="hint">用于计算收益率，不会自动改变比例。</div>
          </div>
          <div class="field">
            <label>分红比例（%）</label>
            <input type="number" name="ratio" min="0" max="100" step="0.01" inputmode="decimal" value="${investor ? investor.ratio : ''}" placeholder="如：30">
            <div class="hint">比例合计不足 100% 时，剩余部分不分给股东。</div>
          </div>
        </div>`,
      submitText: isEdit ? '保存修改' : '添加股东',
      onSubmit(formData) {
        const name = String(formData.get('name') || '').trim();
        const amount = U.round2(formData.get('amount'));
        const ratio = U.round2(formData.get('ratio'));
        if (!name) return '请填写股东姓名';
        if (amount < 0) return '出资额不能为负数';
        if (!(ratio >= 0 && ratio <= 100)) return '分红比例应在 0 到 100 之间';
        const duplicate = state.data.investors.some((item) => (
          item.name === name && (!isEdit || item.id !== investor.id)
        ));
        if (duplicate) return '已有同名股东，请换一个名字或直接编辑原股东';

        if (isEdit) {
          const index = state.data.investors.findIndex((item) => item.id === investor.id);
          if (index >= 0) {
            state.data.investors[index] = Object.assign({}, state.data.investors[index], { name, amount, ratio });
          }
        } else {
          state.data.investors.push({ id: U.uid(), name, amount, ratio });
        }
        persist();
        toast(isEdit ? '股东信息已更新' : `已添加股东 ${name}`);
        renderView();
        return null;
      }
    });
  }

  async function deleteInvestor(investor) {
    const ok = await confirmDialog(
      '删除股东',
      `确定删除股东 <b>${U.esc(investor.name)}</b> 吗？<br>删除后分红比例合计会变化，历史报表将按剩余股东比例重新计算。`,
      '删除'
    );
    if (!ok) return;
    const index = state.data.investors.findIndex((item) => item.id === investor.id);
    if (index >= 0) state.data.investors.splice(index, 1);
    persist();
    toast('股东已删除');
    renderView();
  }

  function autoAllocateRatios() {
    const investors = state.data.investors;
    if (!investors.length) {
      toast('还没有股东', 'info');
      return;
    }
    const total = U.sum(investors, (item) => item.amount);
    let assigned = 0;
    investors.forEach((investor, index) => {
      if (index === investors.length - 1) {
        investor.ratio = U.round2(Math.max(0, 100 - assigned));
      } else {
        const ratio = total > 0
          ? U.round2((investor.amount / total) * 100)
          : U.round2(100 / investors.length);
        investor.ratio = ratio;
        assigned = U.round2(assigned + ratio);
      }
    });
    persist();
    toast('已按出资额分配比例');
    renderView();
  }

  /* ---------------- Settings ---------------- */

  function renderSettings() {
    const settings = state.data.settings;
    const records = allRecords();
    const modeLabel = Store.isElectron
      ? (state.mode === 'portable' ? '便携版（数据在 exe 同目录）' : state.mode === 'dev' ? '开发模式' : '桌面版')
      : '浏览器预览（localStorage）';

    qs('view').innerHTML = `
      <div class="settings-grid">
        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div>
                <h2>门店与核算口径</h2>
                <p>这些设置会影响所有报表与分红计算</p>
              </div>
            </div>
            <form id="settingsForm" class="form-grid" novalidate>
              <div class="field full">
                <label>店铺名称</label>
                <input type="text" name="shopName" maxlength="30" value="${U.esc(settings.shopName)}">
              </div>
              <div class="field">
                <label>开业日期</label>
                <input type="date" name="openDate" value="${U.esc(settings.openDate)}">
                <div class="hint">用于计算经营天数和累计收益率；留空则按第一笔账计算。</div>
              </div>
              <div class="field">
                <label>备用金留存比例（%）</label>
                <input type="number" name="reservePct" min="0" max="100" step="0.1" value="${settings.reservePct}" inputmode="decimal">
                <div class="hint">盈利时先留一部分不分，0 表示不留。</div>
              </div>
              <div class="field">
                <label>每月折旧摊销（元）</label>
                <input type="number" name="depreciationMonthly" min="0" step="0.01" value="${settings.depreciationMonthly}" inputmode="decimal">
                <div class="hint">装修、设备等按月摊入成本，0 表示不计提。</div>
              </div>
              <div class="field">
                <label>数据保存方式</label>
                <div class="readonly-value">${U.esc(modeLabel)}</div>
              </div>
              <div class="form-actions full">
                <button type="submit" class="btn btn-primary">保存设置</button>
              </div>
              <div class="form-error full"></div>
            </form>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <h2>核算口径说明</h2>
                <p>报表里的分红都是“应分”，不是实际已发</p>
              </div>
            </div>
            <ul class="rule-list">
              <li><b>净利润</b> = 营业收入 − 现金支出 − 每月折旧摊销。</li>
              <li><b>可分配利润</b> = 净利润 − 备用金留存；只有盈利时按比例计提。</li>
              <li><b>股东应分</b> = 可分配利润 × 当前分红比例；亏损也按比例分摊。</li>
              <li><b>年化收益率</b> = 累计应分 ÷ 出资额 ÷ 经营天数 × 365，用于横向评估，不代表承诺收益。</li>
              <li><b>外卖平台佣金</b>单独归在「平台佣金」，方便核算外卖真实利润。</li>
              <li><b>开业投入</b>（装修、设备、押金等）不计入日常支出，只用于回本进度。</li>
              <li>修改分红比例会重算历史报表；当前版本不保留比例生效日期。</li>
            </ul>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div>
                <h2>数据与备份</h2>
                <p>每天首次保存时会自动备份，最多保留 30 份</p>
              </div>
            </div>
            <div class="kv-list">
              <div class="kv-row"><span>数据根目录</span><strong>${U.esc(state.paths.rootDir || '—')}</strong></div>
              <div class="kv-row"><span>当前门店文件夹</span><strong>${U.esc(state.paths.dataDir || '—')}</strong></div>
              <div class="kv-row"><span>数据文件</span><strong>${U.esc(state.paths.dataFile || '—')}</strong></div>
              <div class="kv-row"><span>当前记录</span><strong>${records.length} 笔 · ${state.data.investors.length} 位股东</strong></div>
            </div>
            <div class="data-actions">
              <button type="button" class="btn btn-soft btn-sm" id="exportBackup">导出备份</button>
              <button type="button" class="btn btn-ghost btn-sm" id="importBackup">导入备份</button>
              <button type="button" class="btn btn-ghost btn-sm" id="exportAllRecords">导出全部流水</button>
              <button type="button" class="btn btn-ghost btn-sm" id="openFolder"${Store.isElectron ? '' : ' disabled title="浏览器预览模式不可用"'}>打开数据文件夹</button>
            </div>
            <div class="hint" style="margin-top:12px">备份与导入只作用于当前门店；其他门店请先到「门店管理」切换。换电脑前先导出备份，建议定期复制数据根目录到 U 盘或网盘。</div>
          </div>

          <div class="card">
            <div class="card-head"><div><h2>关于</h2></div></div>
            <div class="kv-list">
              <div class="kv-row"><span>软件版本</span><strong>v${U.esc(state.version || '1.0.0')}</strong></div>
              <div class="kv-row"><span>运行模式</span><strong>${U.esc(modeLabel)}</strong></div>
              <div class="kv-row"><span>数据范围</span><strong>多门店 · 当前「${U.esc((state.store && state.store.name) || state.data.settings.shopName)}」</strong></div>
              <div class="kv-row"><span>版权署名</span><strong>by @ 猴子_扛过吴彦祖</strong></div>
            </div>
            <p class="ratio-note" style="margin-top:12px">本软件不联网、不上传账目；请自行做好备份与电脑安全管理。</p>
          </div>
        </div>
      </div>`;

    const settingsForm = qs('settingsForm');
    settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFormError(settingsForm);
      const formData = new FormData(settingsForm);
      const shopName = String(formData.get('shopName') || '').trim();
      const openDate = String(formData.get('openDate') || '');
      const reservePct = U.round2(formData.get('reservePct'));
      const depreciationMonthly = U.round2(formData.get('depreciationMonthly'));
      if (!shopName) {
        showFormError(settingsForm, '店铺名称不能为空');
        return;
      }
      if (state.stores.some((store) => (!state.store || store.id !== state.store.id) && store.name === shopName)) {
        showFormError(settingsForm, '已存在同名门店，请换一个名称');
        return;
      }
      if (openDate && !U.dateFromISO(openDate)) {
        showFormError(settingsForm, '开业日期格式不正确');
        return;
      }
      if (reservePct < 0 || reservePct > 100) {
        showFormError(settingsForm, '备用金留存比例应在 0 到 100 之间');
        return;
      }
      if (depreciationMonthly < 0) {
        showFormError(settingsForm, '每月折旧摊销不能为负数');
        return;
      }
      state.data.settings.shopName = shopName;
      state.data.settings.openDate = openDate;
      state.data.settings.reservePct = reservePct;
      state.data.settings.depreciationMonthly = depreciationMonthly;
      if (state.store) {
        state.store.name = shopName;
        state.store.openDate = openDate;
      }
      const currentMeta = state.stores.find((store) => state.store && store.id === state.store.id);
      if (currentMeta) {
        currentMeta.name = shopName;
        currentMeta.openDate = openDate;
      }
      persist();
      syncBrand();
      renderStoreSwitcher();
      toast('设置已保存');
    });

    qs('exportBackup').addEventListener('click', async () => {
      const result = await Store.exportBackup(state.data);
      if (result && result.ok) {
        toast(result.browser ? '备份文件已下载' : `备份已导出到 ${result.filePath}`, 'info', 5000);
      } else if (result && !result.canceled) {
        toast(result.error || '导出失败', 'error');
      }
    });

    qs('importBackup').addEventListener('click', async () => {
      const result = await Store.importBackup();
      if (!result.ok) {
        if (!result.canceled) toast(result.error || '导入失败', 'error');
        return;
      }
      const ok = await confirmDialog(
        '导入备份',
        `将用备份文件覆盖当前门店「${U.esc(state.data.settings.shopName)}」的全部数据（当前 ${records.length} 笔记录、${state.data.investors.length} 位股东），其他门店不受影响。<br><br>建议先导出当前备份。确定继续吗？`,
        '覆盖并导入'
      );
      if (!ok) return;
      state.data = result.data;
      state.data.settings = Store.normalize(state.data).settings;
      persist();
      syncBrand();
      if (state.store) {
        state.store.name = state.data.settings.shopName;
        state.store.openDate = state.data.settings.openDate;
      }
      const importedMeta = state.stores.find((store) => state.store && store.id === state.store.id);
      if (importedMeta) {
        importedMeta.name = state.data.settings.shopName;
        importedMeta.openDate = state.data.settings.openDate;
      }
      renderStoreSwitcher();
      setRangePreset('month');
      toast('备份已导入');
    });

    qs('exportAllRecords').addEventListener('click', () => {
      if (!records.length) {
        toast('还没有流水记录', 'info');
        return;
      }
      exportRecords(records, '全部流水');
    });

    const openFolder = qs('openFolder');
    if (openFolder && Store.isElectron) {
      openFolder.addEventListener('click', async () => {
        const result = await Store.openDataFolder();
        if (result && !result.ok) toast(result.error || '无法打开文件夹', 'error');
      });
    }
  }

  /* ---------------- Stores ---------------- */

  function applyStoreResult(result) {
    state.data = result.data;
    state.paths = Store.paths || {};
    state.mode = Store.mode || '';
    state.store = result.store || null;
    state.stores = result.stores || [];
    syncBrand();
    renderStoreSwitcher();
  }

  function resetRangeForStore() {
    state.rangePreset = 'month';
    state.range = computeRange('month');
  }

  function closeStoreMenu() {
    const menu = qs('storeMenu');
    if (menu) menu.hidden = true;
  }

  function renderStoreSwitcher() {
    const nameEl = qs('storeSwitcherName');
    const menu = qs('storeMenu');
    if (!nameEl || !menu) return;
    const currentName = (state.store && state.store.name) || (state.data && state.data.settings.shopName) || '门店';
    nameEl.textContent = currentName;
    nameEl.title = currentName;
    menu.innerHTML = state.stores.map((store) => `
      <button type="button" class="store-menu-item${store.active ? ' is-active' : ''}" data-store-id="${U.esc(store.id)}">
        <span class="store-menu-name">${U.esc(store.name)}</span>
        ${store.active ? '<span class="store-menu-check">✓</span>' : ''}
      </button>`).join('') + `
      <div class="store-menu-sep"></div>
      <button type="button" class="store-menu-item store-menu-manage" id="storeMenuManage">管理门店 / 新建门店…</button>`;
    menu.querySelectorAll('[data-store-id]').forEach((button) => {
      button.addEventListener('click', () => {
        closeStoreMenu();
        switchStoreById(button.dataset.storeId);
      });
    });
    qs('storeMenuManage').addEventListener('click', () => {
      closeStoreMenu();
      switchTab('stores');
    });
  }

  function bindStoreSwitcher() {
    const btn = qs('storeSwitcherBtn');
    const menu = qs('storeMenu');
    const wrap = qs('storeSwitcher');
    if (!btn || !menu || !wrap) return;
    btn.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('mousedown', (event) => {
      if (!menu.hidden && !wrap.contains(event.target)) closeStoreMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeStoreMenu();
    });
  }

  async function switchStoreById(id) {
    if (state.store && state.store.id === id) return;
    try {
      await saveChain;
      const result = await Store.switchStore(id);
      if (!result.ok) {
        toast(result.error || '切换失败', 'error');
        return;
      }
      applyStoreResult(result);
      resetRangeForStore();
      render();
      toast(`已切换到「${state.store ? state.store.name : ''}」`, 'info');
      if (result.recoveredMessage) toast(result.recoveredMessage, 'error', 10000);
    } catch (err) {
      toast(`切换失败：${err.message}`, 'error');
    }
  }

  async function renderStores() {
    let listed;
    try {
      listed = await Store.listStores();
    } catch (err) {
      toast(`读取门店列表失败：${err.message}`, 'error');
      return;
    }
    if (state.tab !== 'stores') return;
    state.stores = listed.stores;
    const rootPath = listed.rootDir || state.paths.rootDir || state.paths.dataDir || '—';
    const current = state.stores.find((store) => store.active);
    const onlyOne = state.stores.length <= 1;

    qs('view').innerHTML = `
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>门店列表</h2>
              <p>共 ${state.stores.length} 个门店 · 各门店账目、股东、备份完全独立</p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="createStore">新建门店</button>
          </div>
          <div class="store-list">
            ${state.stores.map((store) => `
              <div class="store-row${store.active ? ' is-active' : ''}">
                <div class="store-row-main">
                  <div class="store-row-title">
                    <strong>${U.esc(store.name)}</strong>
                    ${store.active ? '<span class="badge badge-muted">当前</span>' : ''}
                  </div>
                  <div class="store-row-meta">
                    ${store.openDate ? `开业于 ${U.fmtDateCN(store.openDate)} · ` : ''}${store.records} 笔流水 · ${store.investors} 位股东
                  </div>
                </div>
                <div class="store-row-actions">
                  ${store.active ? '' : `<button type="button" class="btn btn-soft btn-sm" data-switch="${U.esc(store.id)}">切换</button>`}
                  <button type="button" class="btn btn-danger btn-sm" data-delete="${U.esc(store.id)}"${onlyOne ? ' disabled title="至少需要保留一个门店"' : ''}>删除</button>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h2>数据存放</h2>
              <p>每个门店一个独立子文件夹，删除门店只清理它自己的文件夹</p>
            </div>
          </div>
          <div class="kv-list">
            <div class="kv-row"><span>数据根目录</span><strong>${U.esc(rootPath)}</strong></div>
            <div class="kv-row"><span>当前门店文件夹</span><strong>${U.esc(state.paths.dataDir || '—')}</strong></div>
            <div class="kv-row"><span>当前门店</span><strong>${U.esc(current ? current.name : '—')}</strong></div>
          </div>
          <div class="data-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="openRootFolder"${Store.isElectron ? '' : ' disabled title="浏览器预览模式不可用"'}>打开数据根目录</button>
          </div>
          <div class="hint" style="margin-top:12px">建议定期把整个数据根目录复制到 U 盘或网盘；单个门店也可以在「设置与备份」里导出备份。</div>
        </div>
      </div>`;

    qs('createStore').addEventListener('click', openStoreCreateModal);
    qs('view').querySelectorAll('[data-switch]').forEach((button) => {
      button.addEventListener('click', () => switchStoreById(button.dataset.switch));
    });
    qs('view').querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        const store = state.stores.find((item) => item.id === button.dataset.delete);
        if (store) openStoreDeleteModal(store);
      });
    });
    const openRoot = qs('openRootFolder');
    if (openRoot && Store.isElectron) {
      openRoot.addEventListener('click', async () => {
        const result = await Store.openRootFolder();
        if (result && !result.ok) toast(result.error || '无法打开文件夹', 'error');
      });
    }
  }

  function openStoreCreateModal() {
    const rootPath = state.paths.rootDir || state.paths.dataDir || '—';
    openModal({
      title: '新建门店',
      subtitle: '每个门店拥有独立的账目、股东与备份',
      bodyHTML: `
        <div class="form-grid">
          <div class="field full">
            <label>门店名称（必填）</label>
            <input type="text" name="storeName" maxlength="30" placeholder="如：攀枝花羊肉米线（XX店）">
          </div>
          <div class="field full">
            <label>开业日期（必填）</label>
            <input type="date" name="storeOpenDate" value="${U.todayISO()}">
            <div class="hint">用于计算经营天数与年化收益率。</div>
          </div>
          <div class="field full">
            <label>数据文件夹（自动创建，无需手动配置）</label>
            <div class="readonly-value">${U.esc(rootPath)}</div>
            <div class="hint">新门店会在这个目录下建立自己的独立子文件夹。</div>
          </div>
        </div>
        <div class="hint" style="margin-top:10px">股东与分红比例、备用金、折旧等，可在创建后到「设置与备份」里配置。</div>`,
      submitText: '创建门店',
      onSubmit: async (formData) => {
        const name = String(formData.get('storeName') || '').trim();
        const openDate = String(formData.get('storeOpenDate') || '');
        if (!name) return '请填写门店名称';
        if (!U.dateFromISO(openDate)) return '请填写有效的开业日期';
        await saveChain;
        const result = await Store.createStore({ name, openDate });
        if (!result.ok) return result.error || '创建失败';
        applyStoreResult(result);
        resetRangeForStore();
        switchTab('dashboard');
        toast(`门店「${name}」已创建，开始记账吧`);
        if (result.recoveredMessage) toast(result.recoveredMessage, 'error', 10000);
      }
    });
  }

  function openStoreDeleteModal(store) {
    openModal({
      title: '删除门店',
      subtitle: '该操作不可恢复，请谨慎操作',
      bodyHTML: `
        <div class="modal-text">
          将永久删除门店「<b>${U.esc(store.name)}</b>」的全部数据：<br>
          ${store.records} 笔流水、${store.investors} 位股东，以及该门店的全部自动备份。其他门店不受影响。
        </div>
        <div class="field full" style="margin-top:14px">
          <label class="checkbox-line"><input type="checkbox" name="backupBeforeDelete" checked> 删除前先导出备份文件（推荐）</label>
        </div>
        <div class="field full" style="margin-top:12px">
          <label>请输入门店名称「${U.esc(store.name)}」以确认删除</label>
          <input type="text" name="confirmName" autocomplete="off" placeholder="${U.esc(store.name)}">
        </div>`,
      submitText: '永久删除',
      submitClass: 'btn-danger',
      onSubmit: async (formData) => {
        const typed = String(formData.get('confirmName') || '').trim();
        if (typed !== store.name) return `请完整输入门店名称「${store.name}」`;
        const backup = formData.get('backupBeforeDelete') === 'on';
        await saveChain;
        const result = await Store.deleteStore(store.id, { backup });
        if (result.canceled) return '已取消备份导出，删除未执行';
        if (!result.ok) return result.error || '删除失败';
        if (result.switched) {
          applyStoreResult(result);
          resetRangeForStore();
        } else {
          state.stores = result.stores;
          renderStoreSwitcher();
        }
        render();
        toast(`门店「${store.name}」已删除`);
      }
    });
  }

  /* ---------------- Init ---------------- */

  function bindNavigation() {
    qs('nav').querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
    bindStoreSwitcher();
    qs('applyRange').addEventListener('click', applyCustomRange);
    qs('rangeStart').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyCustomRange();
    });
    qs('rangeEnd').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyCustomRange();
    });
  }

  async function init() {
    try {
      const result = await Store.load();
      state.version = await Store.getVersion();
      applyStoreResult(result);
      resetRangeForStore();
      bindNavigation();
      render();

      if (result.recoveredMessage) {
        toast(result.recoveredMessage, 'error', 10000);
      }
    } catch (err) {
      qs('view').innerHTML = `
        <div class="card">
          <div class="empty">
            <div class="empty-mark">!</div>
            <div class="empty-title">软件启动失败</div>
            <div class="empty-sub">${U.esc(err.message || '未知错误')}</div>
          </div>
        </div>`;
    }
  }

  window.App = {
    state,
    switchTab,
    persist,
    init,
    switchStore: switchStoreById
  };

  document.addEventListener('DOMContentLoaded', init);
})();
