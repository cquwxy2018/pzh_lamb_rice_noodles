(function () {
  const U = window.U;
  const Charts = {};

  function niceStep(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const exponent = Math.floor(Math.log10(value));
    const fraction = value / Math.pow(10, exponent);
    let nice;
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
    return nice * Math.pow(10, exponent);
  }

  function axisText(value) {
    const abs = Math.abs(value);
    if (abs >= 10000) {
      const text = (value / 10000).toFixed(abs >= 100000 ? 0 : 1).replace(/\.0$/, '');
      return `${text}万`;
    }
    return Math.round(value).toLocaleString('zh-CN');
  }

  Charts.cashflow = function (groups) {
    if (!groups || !groups.length) {
      return '<div class="chart-empty">该区间还没有数据</div>';
    }

    const W = 900;
    const H = 300;
    const padL = 62;
    const padR = 18;
    const padT = 20;
    const padB = 44;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let max = 0;
    let min = 0;
    groups.forEach((group) => {
      max = Math.max(max, group.revenue, group.expense, group.profit, 0);
      min = Math.min(min, group.profit, 0);
    });
    if (max === 0 && min === 0) {
      return '<div class="chart-empty">该区间还没有收支数据</div>';
    }
    if (max === min) max = min + 100;

    const step = niceStep((max - min) / 4);
    const yMax = Math.ceil(max / step) * step || step;
    const yMin = Math.floor(min / step) * step;
    const span = yMax - yMin || 1;
    const y = (value) => padT + ((yMax - value) / span) * plotH;
    const groupW = plotW / groups.length;
    const barW = Math.max(3, Math.min(18, groupW * 0.3));
    const gap = Math.min(3, groupW * 0.05);

    const parts = [];
    parts.push(`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="收支趋势图">`);

    for (let value = yMin; value <= yMax + step * 0.01; value += step) {
      const py = y(value);
      const isZero = Math.abs(value) < step * 0.01;
      parts.push(`<line class="${isZero ? 'chart-zero' : 'chart-grid'}" x1="${padL}" y1="${py.toFixed(1)}" x2="${W - padR}" y2="${py.toFixed(1)}"></line>`);
      parts.push(`<text class="chart-axis" x="${padL - 10}" y="${(py + 4).toFixed(1)}" text-anchor="end">${U.esc(axisText(value))}</text>`);
    }

    const labelEvery = groups.length <= 12 ? 1 : Math.ceil(groups.length / 10);
    const profitPoints = [];

    groups.forEach((group, index) => {
      const center = padL + groupW * (index + 0.5);
      const revX = center - barW - gap / 2;
      const expX = center + gap / 2;
      const revTop = y(Math.max(0, group.revenue));
      const expTop = y(Math.max(0, group.expense));
      const revHeight = Math.max(1, Math.abs(y(group.revenue) - y(0)));
      const expHeight = Math.max(1, Math.abs(y(group.expense) - y(0)));
      const tooltip = `${group.fullLabel}\n收入 ${U.money(group.revenue)}\n支出 ${U.money(group.expense)}\n净利润 ${U.money(group.profit)}`;

      parts.push(`<g><title>${U.esc(tooltip)}</title>`);
      parts.push(`<rect class="chart-bar-rev" x="${revX.toFixed(1)}" y="${revTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${revHeight.toFixed(1)}" rx="2"></rect>`);
      parts.push(`<rect class="chart-bar-exp" x="${expX.toFixed(1)}" y="${expTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${expHeight.toFixed(1)}" rx="2"></rect>`);
      parts.push('</g>');

      profitPoints.push(`${(center).toFixed(1)},${y(group.profit).toFixed(1)}`);

      if (index % labelEvery === 0 || index === groups.length - 1) {
        parts.push(`<text class="chart-x" x="${center.toFixed(1)}" y="${H - 16}" text-anchor="middle">${U.esc(group.label)}</text>`);
      }
    });

    if (profitPoints.length > 1) {
      parts.push(`<polyline class="chart-profit-line" points="${profitPoints.join(' ')}"></polyline>`);
    }
    if (groups.length <= 24) {
      groups.forEach((group, index) => {
        const center = padL + groupW * (index + 0.5);
        parts.push(`<circle class="chart-profit-dot" cx="${center.toFixed(1)}" cy="${y(group.profit).toFixed(1)}" r="2.6"><title>${U.esc(`${group.fullLabel} 净利润 ${U.money(group.profit)}`)}</title></circle>`);
      });
    }

    parts.push('</svg>');
    return parts.join('');
  };

  Charts.categoryBars = function (items) {
    if (!items || !items.length) {
      return '<div class="empty-inline">该区间还没有支出</div>';
    }
    const total = U.sum(items, (item) => item.amount);
    return items.map((item) => {
      const pct = total > 0 ? (item.amount / total) * 100 : 0;
      const color = window.Constants.CATEGORY_COLORS[item.name] || '#8c857c';
      return [
        '<div class="cat-row">',
        `<span class="cat-dot" style="background:${color}"></span>`,
        `<span class="cat-name">${U.esc(item.name)}${item.virtual ? '<em>非现金</em>' : ''}</span>`,
        `<span class="cat-track"><span class="cat-fill${item.virtual ? ' is-virtual' : ''}" style="width:${pct.toFixed(1)}%;background:${color}"></span></span>`,
        `<span class="cat-amt">${U.money(item.amount)}</span>`,
        `<span class="cat-pct">${pct.toFixed(1)}%</span>`,
        '</div>'
      ].join('');
    }).join('');
  };

  window.Charts = Charts;
})();
