(function () {
  const U = window.U;
  const C = {};

  C.effectiveStart = function (data) {
    const openDate = data.settings && data.settings.openDate;
    if (openDate && U.dateFromISO(openDate)) return openDate;
    const operatingDates = [];
    ['incomes', 'expenses'].forEach((key) => {
      (data[key] || []).forEach((record) => {
        if (record.date && U.dateFromISO(record.date)) operatingDates.push(record.date);
      });
    });
    if (operatingDates.length) {
      operatingDates.sort();
      return operatingDates[0];
    }
    const capitalDates = (data.capitals || [])
      .map((record) => record.date)
      .filter((date) => U.dateFromISO(date))
      .sort();
    if (capitalDates.length) return capitalDates[0];
    return U.todayISO();
  };

  C.depreciationBetween = function (data, start, end) {
    const monthly = U.num(data.settings && data.settings.depreciationMonthly);
    if (monthly <= 0) return 0;
    const startDate = U.dateFromISO(start);
    const endDate = U.dateFromISO(end);
    if (!startDate || !endDate || endDate < startDate) return 0;

    let total = 0;
    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cursor <= endDate) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const overlapStart = monthStart < startDate ? startDate : monthStart;
      const overlapEnd = monthEnd > endDate ? endDate : monthEnd;
      const days = Math.round((overlapEnd - overlapStart) / 86400000) + 1;
      total += (monthly * days) / monthEnd.getDate();
      cursor = new Date(year, month + 1, 1);
    }
    return U.round2(total);
  };

  C.summarize = function (data, start, end) {
    const rangeStart = start;
    const rangeEnd = end;
    const incomes = (data.incomes || []).filter((r) => r.date >= rangeStart && r.date <= rangeEnd);
    const expenses = (data.expenses || []).filter((r) => r.date >= rangeStart && r.date <= rangeEnd);

    const revenue = U.round2(U.sum(incomes, (r) => r.amount));
    const cashExpense = U.round2(U.sum(expenses, (r) => r.amount));
    const depreciation = C.depreciationBetween(data, rangeStart, rangeEnd);
    const expenseTotal = U.round2(cashExpense + depreciation);
    const profit = U.round2(revenue - expenseTotal);
    const reservePct = U.clamp(data.settings && data.settings.reservePct, 0, 100);
    const reserve = profit > 0 ? U.round2((profit * reservePct) / 100) : 0;
    const distributable = U.round2(profit - reserve);

    const categoryMap = {};
    expenses.forEach((record) => {
      const key = record.category || '其他支出';
      categoryMap[key] = (categoryMap[key] || 0) + U.num(record.amount);
    });
    if (depreciation > 0) categoryMap['折旧摊销'] = depreciation;
    const byCategory = Object.keys(categoryMap)
      .map((name) => ({ name, amount: U.round2(categoryMap[name]), virtual: name === '折旧摊销' }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const channelMap = {};
    incomes.forEach((record) => {
      const key = record.channel || '其他收入';
      channelMap[key] = (channelMap[key] || 0) + U.num(record.amount);
    });
    const byChannel = Object.keys(channelMap)
      .map((name) => ({ name, amount: U.round2(channelMap[name]) }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    return {
      start: rangeStart,
      end: rangeEnd,
      days: Math.max(1, U.daysInclusive(rangeStart, rangeEnd)),
      revenue,
      cashExpense,
      depreciation,
      expenseTotal,
      profit,
      reserve,
      distributable,
      reservePct,
      byCategory,
      byChannel,
      incomeCount: incomes.length,
      expenseCount: expenses.length
    };
  };

  C.shares = function (data, distributable) {
    const investors = data.investors || [];
    const ratioSum = U.round2(U.sum(investors, (inv) => inv.ratio));
    const shares = investors.map((inv) => ({
      id: inv.id,
      name: inv.name,
      ratio: U.num(inv.ratio),
      amount: U.num(inv.amount),
      share: U.round2((U.num(distributable) * U.num(inv.ratio)) / 100)
    }));
    if (shares.length && Math.abs(ratioSum - 100) < 0.005) {
      const diff = U.round2(U.num(distributable) - U.sum(shares, (item) => item.share));
      if (Math.abs(diff) >= 0.005) {
        let target = 0;
        for (let i = 1; i < shares.length; i += 1) {
          if (Math.abs(shares[i].share) > Math.abs(shares[target].share)) target = i;
        }
        shares[target].share = U.round2(shares[target].share + diff);
      }
    }
    return { ratioSum, shares };
  };

  C.cumulative = function (data, endIso) {
    const start = C.effectiveStart(data);
    let end = endIso || U.todayISO();
    if (end < start) end = start;
    const summary = C.summarize(data, start, end);
    const shareInfo = C.shares(data, summary.distributable);
    const totalInvest = U.round2(U.sum(data.investors, (inv) => inv.amount));
    const startupCost = U.round2(U.sum(data.capitals, (item) => item.amount));
    const days = Math.max(1, U.daysInclusive(start, end));

    return {
      start,
      end,
      days,
      summary,
      ratioSum: shareInfo.ratioSum,
      shares: shareInfo.shares,
      totalInvest,
      startupCost,
      paybackPct: startupCost > 0 ? U.round2((summary.distributable / startupCost) * 100) : null,
      annualizedPct: totalInvest > 0 ? U.round2((summary.profit / totalInvest) * (365 / days) * 100) : null
    };
  };

  C.reportPeriods = function (data, start, end, mode) {
    const periods = [];
    const startDate = U.dateFromISO(start);
    const endDate = U.dateFromISO(end);
    if (!startDate || !endDate || endDate < startDate) return periods;

    let cursor = startDate;
    while (cursor <= endDate) {
      let periodStart;
      let periodEnd;
      let label;
      let short;

      if (mode === 'week') {
        const weekStart = U.startOfWeek(U.toISO(cursor));
        const weekEnd = U.endOfWeek(weekStart);
        periodStart = weekStart < start ? start : weekStart;
        periodEnd = weekEnd > end ? end : weekEnd;
        const info = U.isoWeek(U.startOfWeek(periodStart));
        label = `${info.year}年第${info.week}周`;
        short = `${info.week}周`;
        cursor = U.dateFromISO(U.addDays(periodEnd, 1));
      } else if (mode === 'month') {
        const monthStart = U.startOfMonth(U.toISO(cursor));
        const monthEnd = U.endOfMonth(monthStart);
        periodStart = monthStart < start ? start : monthStart;
        periodEnd = monthEnd > end ? end : monthEnd;
        const date = U.dateFromISO(periodStart);
        label = `${date.getFullYear()}年${date.getMonth() + 1}月`;
        short = `${date.getMonth() + 1}月`;
        cursor = U.dateFromISO(U.addDays(periodEnd, 1));
      } else if (mode === 'year') {
        const yearStart = U.startOfYear(U.toISO(cursor));
        const yearEnd = U.endOfYear(yearStart);
        periodStart = yearStart < start ? start : yearStart;
        periodEnd = yearEnd > end ? end : yearEnd;
        const date = U.dateFromISO(periodStart);
        label = `${date.getFullYear()}年`;
        short = `${date.getFullYear()}`;
        cursor = U.dateFromISO(U.addDays(periodEnd, 1));
      } else {
        periodStart = U.toISO(cursor);
        periodEnd = periodStart;
        label = `${periodStart} ${U.weekdayCN(periodStart)}`;
        short = U.fmtDateShort(periodStart);
        cursor = U.dateFromISO(U.addDays(periodStart, 1));
      }

      const summary = C.summarize(data, periodStart, periodEnd);
      const shareInfo = C.shares(data, summary.distributable);
      periods.push({
        start: periodStart,
        end: periodEnd,
        label,
        short,
        summary,
        shares: shareInfo.shares
      });
    }
    return periods;
  };

  C.chartGroups = function (data, start, end) {
    const days = U.daysInclusive(start, end);
    const mode = days <= 35 ? 'day' : days <= 210 ? 'week' : 'month';
    const periods = C.reportPeriods(data, start, end, mode);
    return {
      mode,
      groups: periods.map((period) => ({
        label: period.short,
        fullLabel: period.label,
        revenue: period.summary.revenue,
        expense: period.summary.expenseTotal,
        profit: period.summary.profit
      }))
    };
  };

  C.capitalByCategory = function (data) {
    const map = {};
    (data.capitals || []).forEach((record) => {
      const key = record.category || '其他';
      map[key] = (map[key] || 0) + U.num(record.amount);
    });
    return Object.keys(map)
      .map((name) => ({ name, amount: U.round2(map[name]) }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  };

  window.Calc = C;
})();
