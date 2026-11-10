(function () {
  const U = window.U;
  const C = window.Calc;

  function pctOf(part, total) {
    return total > 0 ? U.pct((part / total) * 100, 1) : '—';
  }

  function cellHTML(value, numeric) {
    const text = String(value == null ? '' : value);
    const neg = numeric && text.trim().startsWith('-');
    const cls = `${numeric ? 'num' : ''}${neg ? ' neg' : ''}`.trim();
    return `<td${cls ? ` class="${cls}"` : ''}>${U.esc(text)}</td>`;
  }

  function table(headers, rows, totalRow, numericFrom) {
    const from = numericFrom == null ? 1 : numericFrom;
    const thead = headers.map((h, i) => `<th${i >= from ? ' class="num"' : ''}>${U.esc(h)}</th>`).join('');
    const body = rows.map((row) => `<tr>${row.map((c, i) => cellHTML(c, i >= from)).join('')}</tr>`).join('');
    const total = totalRow ? `<tr class="total">${totalRow.map((c, i) => cellHTML(c, i >= from)).join('')}</tr>` : '';
    const empty = rows.length ? '' : '<tr><td class="empty-cell" colspan="' + headers.length + '">本期无数据</td></tr>';
    return `<table><thead><tr>${thead}</tr></thead><tbody>${body || empty}${total}</tbody></table>`;
  }

  function section(title, inner, note) {
    return `<section class="section"><h2>${U.esc(title)}</h2>${inner}${note ? `<p class="note">${U.esc(note)}</p>` : ''}</section>`;
  }

  function buildHTML(data, type, periodKey) {
    const isMonth = type === 'month';
    let start;
    let end;
    let title;
    if (isMonth) {
      start = `${periodKey}-01`;
      end = U.endOfMonth(start);
      const d = U.dateFromISO(start);
      title = `${d.getFullYear()}年${d.getMonth() + 1}月经营报表`;
    } else {
      start = `${periodKey}-01-01`;
      end = `${periodKey}-12-31`;
      title = `${periodKey}年度经营报表`;
    }

    const summary = C.summarize(data, start, end);
    const shareInfo = C.shares(data, summary.distributable);
    const investors = data.investors || [];
    const shopName = (data.settings && data.settings.shopName) || '羊肉米线记账';
    const margin = summary.revenue > 0 ? U.pct((summary.profit / summary.revenue) * 100, 1) : '—';

    const overviewItems = [
      ['营业收入', U.money(summary.revenue), ''],
      ['现金支出', U.money(summary.cashExpense), ''],
      ['折旧摊销', U.money(summary.depreciation), ''],
      ['营业支出合计', U.money(summary.expenseTotal), ''],
      ['净利润', U.money(summary.profit), summary.profit >= 0 ? 'pos' : 'neg'],
      ['净利率', margin, ''],
      [`备用金留存 ${summary.reservePct}%`, U.money(summary.reserve), ''],
      ['可分配利润', U.money(summary.distributable), summary.distributable >= 0 ? 'pos' : 'neg']
    ];
    const overviewHTML = `<div class="overview">${overviewItems.map((item) => (
      `<div class="ov-item"><span>${U.esc(item[0])}</span><strong class="${item[2]}">${U.esc(item[1])}</strong></div>`
    )).join('')}</div>`;

    const channelHTML = table(
      ['收入渠道', '金额', '占收入比'],
      summary.byChannel.map((it) => [it.name, U.money(it.amount), pctOf(it.amount, summary.revenue)]),
      ['合计', U.money(summary.revenue), '100%'],
      1
    );

    const categoryHTML = table(
      ['支出类别', '金额', '占支出比'],
      summary.byCategory.map((it) => [it.virtual ? `${it.name}（计提）` : it.name, U.money(it.amount), pctOf(it.amount, summary.expenseTotal)]),
      ['合计', U.money(summary.expenseTotal), '100%'],
      1
    );

    const ratioBad = investors.length > 0 && Math.abs(shareInfo.ratioSum - 100) >= 0.005;
    const dividendHTML = investors.length ? table(
      ['股东', '分红比例', '出资额', '本期应分', '本期收益率'],
      investors.map((inv) => {
        const share = shareInfo.shares.find((s) => s.id === inv.id)?.share || 0;
        const roi = inv.amount > 0 ? U.pct((share / inv.amount) * 100, 1) : '—';
        return [inv.name, U.pct(inv.ratio), U.money(inv.amount), U.money(share), roi];
      }),
      ['合计', U.pct(shareInfo.ratioSum), U.money(U.sum(investors, (inv) => inv.amount)), U.money(summary.distributable), ''],
      1
    ) : '<p class="note">尚未设置股东，请到「股东与分红」中配置出资额与比例。</p>';

    let trendHTML;
    let trendTitle;
    let trendNote;
    if (isMonth) {
      const periods = C.reportPeriods(data, start, end, 'day')
        .filter((p) => p.summary.revenue > 0 || p.summary.cashExpense > 0);
      trendTitle = '每日收支概览';
      trendNote = '仅列出当日有收入或支出的日期；净利润为当日收入减现金支出减当日折旧。';
      trendHTML = table(
        ['日期', '营业收入', '现金支出', '净利润'],
        periods.map((p) => [`${U.fmtDateShort(p.start)} ${U.weekdayCN(p.start)}`, U.money(p.summary.revenue), U.money(p.summary.cashExpense), U.money(p.summary.profit)]),
        ['合计', U.money(summary.revenue), U.money(summary.cashExpense), U.money(summary.profit)],
        1
      );
    } else {
      const periods = C.reportPeriods(data, start, end, 'month');
      trendTitle = '逐月收支趋势';
      trendNote = '按自然月汇总；折旧按月计提，不足整月按天数折算。';
      trendHTML = table(
        ['月份', '营业收入', '现金支出', '折旧摊销', '净利润', '可分配'],
        periods.map((p) => [p.label, U.money(p.summary.revenue), U.money(p.summary.cashExpense), U.money(p.summary.depreciation), U.money(p.summary.profit), U.money(p.summary.distributable)]),
        ['合计', U.money(summary.revenue), U.money(summary.cashExpense), U.money(summary.depreciation), U.money(summary.profit), U.money(summary.distributable)],
        1
      );
    }

    const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
    const rules = [
      '净利润 = 营业收入 − 现金支出 − 折旧摊销',
      '可分配利润 = 净利润 − 备用金留存（仅盈利时按设置比例计提）',
      '股东应分 = 可分配利润 × 当前分红比例；亏损按比例分摊',
      `备用金留存比例 ${summary.reservePct}%；每月折旧摊销 ${U.plain(data.settings.depreciationMonthly)} 元`,
      '本报表按当前分红比例计算，比例调整后历史报表会随之重算'
    ];

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${U.esc(shopName)} - ${U.esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif;
    color: #2b2620; font-size: 12px; line-height: 1.55;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .report-head { border-bottom: 2px solid #c2542e; padding-bottom: 10px; margin-bottom: 16px; }
  .report-head .shop { font-size: 13px; color: #8a7f70; letter-spacing: .5px; }
  .report-head h1 { font-size: 22px; margin: 4px 0 6px; color: #2b2620; }
  .report-head .meta { font-size: 11px; color: #8a7f70; }
  .report-head .meta span { margin-right: 16px; }
  .section { margin-bottom: 18px; }
  .section h2 {
    font-size: 14px; margin: 0 0 8px; padding-left: 8px;
    border-left: 4px solid #c2542e; color: #2b2620; break-after: avoid;
  }
  .overview { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .ov-item {
    border: 1px solid #e7ddd0; border-radius: 6px; padding: 8px 10px; background: #faf6f0;
    break-inside: avoid;
  }
  .ov-item span { display: block; font-size: 10.5px; color: #8a7f70; margin-bottom: 3px; }
  .ov-item strong { font-size: 15px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #e2d8ca; padding: 6px 8px; text-align: left; }
  th { background: #f3ece2; font-weight: 600; color: #5c5346; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
  tr.total td { background: #f8f3eb; font-weight: 700; border-top: 2px solid #d8cbb9; }
  td.neg, strong.neg { color: #b23b2e; }
  strong.pos { color: #2f7d4f; }
  td.empty-cell { text-align: center; color: #a99f90; padding: 14px; }
  .note { font-size: 10.5px; color: #8a7f70; margin: 6px 0 0; }
  .rules { margin-top: 6px; padding: 10px 12px; background: #faf6f0; border: 1px solid #e7ddd0; border-radius: 6px; }
  .rules li { font-size: 10.5px; color: #6b6254; margin: 2px 0; }
  .report-foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2d8ca; font-size: 10px; color: #a99f90; }
</style>
</head>
<body>
  <div class="report-head">
    <div class="shop">${U.esc(shopName)}</div>
    <h1>${U.esc(title)}</h1>
    <div class="meta">
      <span>统计区间：${U.esc(start)} 至 ${U.esc(end)}</span>
      <span>经营 ${summary.days} 天</span>
      <span>收入 ${summary.incomeCount} 笔 · 支出 ${summary.expenseCount} 笔</span>
    </div>
  </div>

  ${section('一、经营概览', overviewHTML)}
  ${section('二、收入构成', channelHTML)}
  ${section('三、支出构成', categoryHTML, '支出占比按含折旧的营业支出合计计算。')}
  ${section('四、股东分红', dividendHTML, ratioBad ? `分红比例合计为 ${U.pct(shareInfo.ratioSum)}，与 100% 不一致，应分金额按现有比例计算。` : '股东应分按可分配利润与当前分红比例计算。')}
  ${section(`五、${trendTitle}`, trendHTML, trendNote)}

  <section class="section">
    <h2>口径说明</h2>
    <ul class="rules">${rules.map((r) => `<li>${U.esc(r)}</li>`).join('')}</ul>
  </section>

  <div class="report-foot">
    生成时间：${U.esc(generatedAt)} · 由「${U.esc(shopName)}」记账分红工具生成<br>
    by @ 猴子_扛过吴彦祖 · 数据仅保存在本机
  </div>
</body>
</html>`;
  }

  window.PdfReport = { buildHTML };
})();