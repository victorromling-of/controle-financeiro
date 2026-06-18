(() => {
  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const ALL_MONTHS = new Set(Array.from({ length: 12 }, (_, index) => index + 1));
  const COLORS = {
    payable: '#ef4444',
    receivable: '#16a34a',
    net: '#006b65',
    open: '#d97706',
    paid: '#0891b2',
    purple: '#7c3aed',
    slate: '#475569',
  };

  const DEFAULT_SORTS = {
    titles: { key: 'date', dir: 'desc' },
    categories: { key: 'net', dir: 'desc' },
    partners: { key: 'net', dir: 'desc' },
    accounts: { key: 'name', dir: 'asc' },
    monthly: { key: 'month', dir: 'asc' },
  };
  const NUMERIC_KEYS = new Set(['count', 'payable', 'receivable', 'open', 'net', 'amount', 'openAmount', 'paidAmount', 'initialBalance', 'month']);

  const state = {
    data: null,
    loaded: false,
    loading: false,
    months: new Set(ALL_MONTHS),
    charts: {},
    showUnpaid: false,
    sort: JSON.parse(JSON.stringify(DEFAULT_SORTS)),
  };

  const $ = (id) => document.getElementById(id);
  const money = (value) => 'R$ ' + (Number(value) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const moneyShort = (value) => {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 1000000) return 'R$ ' + (n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  };
  const number = (value) => (Number(value) || 0).toLocaleString('pt-BR');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));

  function init() {
    buildMonths();
    bindNavigation();
    bindFilters();
    window.omieLive = { ensureLoaded };
    if ($('omie-live')?.classList.contains('active')) ensureLoaded();
  }

  async function ensureLoaded(force = false) {
    if (state.loading) return;
    if (state.loaded && !force) {
      render();
      return;
    }

    await loadData(force);
  }

  async function loadData(force = false) {
    state.loading = true;
    setStatus('Carregando dados da Omiê...');
    $('omieRefresh').disabled = true;

    const year = $('omieYear').value || new Date().getFullYear();
    const dateField = $('omieDateField').value || 'vencimento';
    const cacheBust = force ? '&_=' + Date.now() : '';

    try {
      const response = await fetch(`/api/omie-financeiro?ano=${encodeURIComponent(year)}&dataBase=${encodeURIComponent(dateField)}${cacheBust}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.detail || data.error || 'Falha ao carregar dados.');

      state.data = data;
      state.loaded = true;
      populateFilters(data);
      render();
      setStatus(`Sincronizado com ${number(data.counts.movements)} movimentos, ${number(data.counts.clients)} parceiros, ${number(data.counts.categories)} categorias e ${number(data.counts.accounts)} contas.`);
    } catch (error) {
      setStatus('Não foi possível carregar os dados da Omiê agora. ' + error.message, true);
    } finally {
      state.loading = false;
      $('omieRefresh').disabled = false;
    }
  }

  function setStatus(text, error = false) {
    const status = $('omieStatus');
    status.className = 'omie-state' + (error ? ' error' : '');
    status.textContent = text;
  }

  function bindNavigation() {
    document.querySelectorAll('.omie-nav').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.omie-nav').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('.omie-view').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        document.querySelector(`[data-omie-panel="${button.dataset.omieView}"]`)?.classList.add('active');
        setTimeout(resizeCharts, 50);
      });
    });
  }

  function bindFilters() {
    $('omieRefresh').addEventListener('click', () => ensureLoaded(true));
    $('omieYear').addEventListener('change', () => ensureLoaded(true));
    $('omieDateField').addEventListener('change', () => ensureLoaded(true));
    ['omieNature', 'omieStatusFilter', 'omieCategoryFilter', 'omieAccountFilter'].forEach((id) => {
      $(id).addEventListener('change', render);
    });
    $('omieSearch').addEventListener('input', render);
    const unpaid = $('omieShowUnpaid');
    if (unpaid) {
      unpaid.checked = state.showUnpaid;
      unpaid.addEventListener('change', () => {
        state.showUnpaid = unpaid.checked;
        render();
      });
    }
    setupSortableHeaders();
  }

  function setupSortableHeaders() {
    document.querySelectorAll('[data-sort-table]').forEach((table) => {
      const name = table.dataset.sortTable;
      if (!state.sort[name]) return;
      table.querySelectorAll('th[data-k]').forEach((th) => {
        th.classList.add('omie-sortable');
        th.dataset.label = th.textContent.trim();
        th.addEventListener('click', () => {
          const sort = state.sort[name];
          const key = th.dataset.k;
          if (sort.key === key) {
            sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            sort.key = key;
            sort.dir = (NUMERIC_KEYS.has(key) || key === 'date') ? 'desc' : 'asc';
          }
          render();
        });
      });
    });
  }

  function compareRows(a, b, key) {
    if (key === 'date') return String(a.dateISO || '').localeCompare(String(b.dateISO || ''));
    if (NUMERIC_KEYS.has(key)) return (Number(a[key]) || 0) - (Number(b[key]) || 0);
    return normalize(String(a[key] ?? '')).localeCompare(normalize(String(b[key] ?? '')), 'pt-BR');
  }

  function applySort(rows, name) {
    const sort = state.sort[name];
    if (!sort) return rows;
    const sorted = [...rows].sort((a, b) => compareRows(a, b, sort.key));
    if (sort.dir === 'desc') sorted.reverse();
    return sorted;
  }

  function updateSortArrows(name) {
    const table = document.querySelector(`[data-sort-table="${name}"]`);
    if (!table) return;
    const sort = state.sort[name];
    table.querySelectorAll('th[data-k]').forEach((th) => {
      const active = th.dataset.k === sort.key;
      th.classList.toggle('sorted', active);
      th.textContent = th.dataset.label || th.textContent.trim();
      if (active) {
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = sort.dir === 'asc' ? '▲' : '▼';
        th.appendChild(arrow);
      }
    });
  }

  function isPaidRow(row) {
    return row.isLiquidated === true || (Number(row.paidAmount) > 0 && Number(row.openAmount) <= 0);
  }

  function buildMonths() {
    const wrap = $('omieMonths');
    wrap.innerHTML = '';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'omie-month active';
    all.dataset.month = 'all';
    all.textContent = 'Todos';
    all.addEventListener('click', () => {
      state.months = new Set(ALL_MONTHS);
      updateMonthButtons();
      render();
    });
    wrap.appendChild(all);

    MONTHS.forEach((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'omie-month active';
      button.dataset.month = String(index + 1);
      button.textContent = label;
      button.addEventListener('click', () => {
        const value = index + 1;
        if (state.months.size === 12) state.months = new Set([value]);
        else if (state.months.has(value) && state.months.size > 1) state.months.delete(value);
        else state.months.add(value);
        updateMonthButtons();
        render();
      });
      wrap.appendChild(button);
    });
  }

  function updateMonthButtons() {
    document.querySelectorAll('.omie-month').forEach((button) => {
      if (button.dataset.month === 'all') button.classList.toggle('active', state.months.size === 12);
      else button.classList.toggle('active', state.months.has(Number(button.dataset.month)));
    });
  }

  function populateFilters(data) {
    fillSelect('omieStatusFilter', [
      { value: '__ACTIVE__', label: 'Ativos' },
      { value: '', label: 'Todos' },
      ...data.facets.status.map((status) => ({ value: status, label: status })),
    ], '__ACTIVE__');
    fillSelect('omieCategoryFilter', [
      { value: '', label: 'Todas' },
      ...data.facets.categories.map((item) => ({ value: item.code, label: item.name })),
    ]);
    fillSelect('omieAccountFilter', [
      { value: '', label: 'Todas' },
      ...data.accounts.map((item) => ({ value: item.id, label: item.name })),
    ]);
  }

  function fillSelect(id, options, fallback = '') {
    const select = $(id);
    const current = select.value || fallback;
    select.innerHTML = options.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('');
    select.value = options.some((item) => item.value === current) ? current : fallback;
  }

  function filteredRows() {
    if (!state.data) return [];
    const nature = $('omieNature').value;
    const status = $('omieStatusFilter').value;
    const category = $('omieCategoryFilter').value;
    const account = $('omieAccountFilter').value;
    const search = normalize($('omieSearch').value);

    const statusIsSpecific = status && status !== '__ACTIVE__';

    return state.data.movements.filter((row) => {
      if (!state.months.has(row.month)) return false;
      if (!state.showUnpaid && !statusIsSpecific && !isPaidRow(row)) return false;
      if (nature && row.nature !== nature) return false;
      if (status === '__ACTIVE__' && row.status === 'CANCELADO') return false;
      if (statusIsSpecific && row.status !== status) return false;
      if (category && row.categoryCode !== category) return false;
      if (account && row.accountId !== account) return false;
      if (search && !normalize([row.clientName, row.categoryName, row.status, row.accountName, row.type].join(' ')).includes(search)) return false;
      return true;
    });
  }

  function render() {
    if (!state.data) return;
    const rows = filteredRows();
    const aggregate = aggregateRows(rows);

    renderHeader(rows);
    renderKpis(rows, aggregate);
    renderCharts(aggregate);
    renderTables(rows, aggregate);
    renderMeta(rows);
    resizeCharts();
  }

  function renderHeader(rows) {
    const data = state.data;
    $('omieUpdated').textContent = 'Atualizado em ' + new Date(data.generatedAt).toLocaleString('pt-BR');
    $('omieScope').textContent = `${number(rows.length)} movimentos filtrados · ${labelDateField(data.filters.dateField)} · ${data.filters.year}`;
  }

  function renderKpis(rows, aggregate) {
    $('omiePagarTotal').textContent = moneyShort(aggregate.totals.payable);
    $('omiePagarSub').textContent = `${number(rows.filter((row) => row.nature === 'P').length)} títulos · ${moneyShort(aggregate.totals.payableOpen)} em aberto`;
    $('omieReceberTotal').textContent = moneyShort(aggregate.totals.receivable);
    $('omieReceberSub').textContent = `${number(rows.filter((row) => row.nature === 'R').length)} títulos · ${moneyShort(aggregate.totals.receivableOpen)} em aberto`;
    $('omieSaldoTotal').textContent = moneyShort(aggregate.totals.net);
    $('omieSaldoTotal').style.color = aggregate.totals.net >= 0 ? 'var(--teal)' : '#ef4444';
    $('omieSaldoSub').textContent = `${number(rows.length)} movimentos no filtro`;
    $('omieAbertoTotal').textContent = moneyShort(Math.abs(aggregate.totals.open));
    $('omieAbertoSub').textContent = `Vencido: ${moneyShort(aggregate.totals.overduePayable + aggregate.totals.overdueReceivable)}`;
  }

  function aggregateRows(rows) {
    const totals = rows.reduce((acc, row) => {
      if (row.nature === 'R') {
        acc.receivable += row.amount;
        acc.receivableOpen += row.openAmount;
      } else {
        acc.payable += row.amount;
        acc.payableOpen += row.openAmount;
      }
      acc.net += row.signedAmount;
      acc.open += row.nature === 'R' ? row.openAmount : -row.openAmount;
      acc.paid += row.paidAmount;
      if (row.overdue && row.nature === 'P') acc.overduePayable += row.openAmount || row.amount;
      if (row.overdue && row.nature === 'R') acc.overdueReceivable += row.openAmount || row.amount;
      return acc;
    }, { payable: 0, receivable: 0, net: 0, open: 0, paid: 0, payableOpen: 0, receivableOpen: 0, overduePayable: 0, overdueReceivable: 0 });

    const monthly = MONTHS.map((label, index) => {
      const monthRows = rows.filter((row) => row.month === index + 1);
      const payable = sum(monthRows.filter((row) => row.nature === 'P'), 'amount');
      const receivable = sum(monthRows.filter((row) => row.nature === 'R'), 'amount');
      return {
        month: index + 1,
        label,
        count: monthRows.length,
        payable,
        receivable,
        net: receivable - payable,
        open: sum(monthRows.map((row) => ({ value: row.nature === 'R' ? row.openAmount : -row.openAmount })), 'value'),
        paid: sum(monthRows, 'paidAmount'),
      };
    });

    let cumulative = 0;
    monthly.forEach((item) => {
      cumulative += item.net;
      item.cumulative = cumulative;
    });

    return {
      totals,
      monthly,
      byStatus: groupRows(rows, 'status'),
      byCategory: groupRows(rows, 'categoryCode', 'categoryName'),
      byPartner: groupRows(rows, 'clientId', 'clientName'),
      byAccount: groupRows(rows, 'accountId', 'accountName'),
    };
  }

  function groupRows(rows, codeKey, nameKey = codeKey) {
    const map = new Map();
    rows.forEach((row) => {
      const code = row[codeKey] || 'SEM_VALOR';
      const name = row[nameKey] || code;
      if (!map.has(code)) map.set(code, { code, name, count: 0, payable: 0, receivable: 0, open: 0, paid: 0, net: 0 });
      const item = map.get(code);
      item.count += 1;
      if (row.nature === 'R') item.receivable += row.amount;
      else item.payable += row.amount;
      item.open += row.nature === 'R' ? row.openAmount : -row.openAmount;
      item.paid += row.paidAmount;
      item.net += row.signedAmount;
    });
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }

  function renderCharts(aggregate) {
    setChart('omieFluxo', {
      type: 'bar',
      data: {
        labels: aggregate.monthly.map((item) => item.label),
        datasets: [
          { label: 'Pagar', data: aggregate.monthly.map((item) => item.payable), backgroundColor: '#ef444488', borderRadius: 4 },
          { label: 'Receber', data: aggregate.monthly.map((item) => item.receivable), backgroundColor: '#16a34aaa', borderRadius: 4 },
          { label: 'Saldo', type: 'line', data: aggregate.monthly.map((item) => item.net), borderColor: COLORS.net, backgroundColor: '#006b6522', borderWidth: 2, pointRadius: 4, tension: 0.3 },
        ],
      },
      options: chartOptions(),
    });

    setChart('omieStatusChart', {
      type: 'doughnut',
      data: {
        labels: aggregate.byStatus.slice(0, 8).map((item) => item.name),
        datasets: [{ data: aggregate.byStatus.slice(0, 8).map((item) => Math.abs(item.net) || item.paid || item.count), backgroundColor: ['#006b65', '#16a34a', '#ef4444', '#d97706', '#0891b2', '#7c3aed', '#64748b', '#84cc16'], borderWidth: 2, borderColor: '#fff' }],
      },
      options: doughnutOptions(),
    });

    setChart('omieCategoryChart', horizontalBar(aggregate.byCategory.slice(0, 10), 'net'));
    setChart('omiePartnerChart', horizontalBar(aggregate.byPartner.slice(0, 10), 'net', COLORS.purple));
    setChart('omieCumulativeChart', {
      type: 'line',
      data: { labels: aggregate.monthly.map((item) => item.label), datasets: [{ label: 'Saldo acumulado', data: aggregate.monthly.map((item) => item.cumulative), borderColor: COLORS.net, backgroundColor: '#006b6522', fill: true, borderWidth: 2, pointRadius: 4, tension: 0.25 }] },
      options: chartOptions(),
    });
    setChart('omieOpenPaidChart', {
      type: 'bar',
      data: { labels: aggregate.monthly.map((item) => item.label), datasets: [{ label: 'Realizado', data: aggregate.monthly.map((item) => item.paid), backgroundColor: '#0891b2aa', borderRadius: 4 }, { label: 'Aberto', data: aggregate.monthly.map((item) => Math.abs(item.open)), backgroundColor: '#d97706aa', borderRadius: 4 }] },
      options: chartOptions(),
    });
  }

  function horizontalBar(items, field, color = COLORS.net) {
    return {
      type: 'bar',
      data: {
        labels: items.map((item) => truncate(item.name, 24)),
        datasets: [{ data: items.map((item) => item[field]), backgroundColor: items.map((item) => item[field] >= 0 ? color : COLORS.payable), borderRadius: 4 }],
      },
      options: { ...chartOptions(), indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => money(ctx.raw) } } } },
    };
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label || ctx.label}: ${money(ctx.raw)}` } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { grid: { color: '#f0f4f3' }, ticks: { font: { size: 11 }, callback: (value) => 'R$' + (value / 1000).toFixed(0) + 'k' } } },
    };
  }

  function doughnutOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: { labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${money(ctx.raw)}` } },
      },
    };
  }

  function setChart(id, config) {
    const canvas = $(id);
    if (!canvas) return;
    if (state.charts[id]) state.charts[id].destroy();
    state.charts[id] = new Chart(canvas, config);
  }

  function resizeCharts() {
    Object.values(state.charts).forEach((chart) => chart.resize());
  }

  function renderTables(rows, aggregate) {
    renderMonthly(aggregate.monthly);
    renderGroupTable('omieCategoriasBody', aggregate.byCategory, 'Categoria', 'categories');
    renderGroupTable('omiePartnersBody', aggregate.byPartner, 'Parceiro', 'partners');
    renderTitles(rows);
    renderAccounts(aggregate.byAccount);
  }

  function renderMonthly(monthly) {
    const sorted = applySort(monthly, 'monthly');
    $('omieMonthlyBody').innerHTML = sorted.map((item) => `<tr><td>${item.label}</td><td class="num">${number(item.count)}</td><td class="num">${money(item.payable)}</td><td class="num">${money(item.receivable)}</td><td class="num">${money(item.open)}</td><td class="num" style="color:${item.net >= 0 ? 'var(--teal)' : '#ef4444'};font-weight:700">${money(item.net)}</td></tr>`).join('');
    updateSortArrows('monthly');
  }

  function renderGroupTable(id, rows, label, name) {
    const body = $(id);
    const sorted = applySort(rows, name);
    body.innerHTML = sorted.length ? sorted.slice(0, 60).map((item) => `<tr><td><strong style="color:var(--ink);font-weight:600">${esc(item.name || label)}</strong><div class="omie-mini">${esc(item.code)}</div></td><td class="num">${number(item.count)}</td><td class="num">${money(item.payable)}</td><td class="num">${money(item.receivable)}</td><td class="num">${money(item.open)}</td><td class="num" style="color:${item.net >= 0 ? 'var(--teal)' : '#ef4444'};font-weight:700">${money(item.net)}</td></tr>`).join('') : `<tr><td colspan="6" class="omie-empty">Sem registros.</td></tr>`;
    updateSortArrows(name);
  }

  function renderTitles(rows) {
    const sorted = applySort(rows, 'titles');
    $('omieTitleCount').textContent = `${number(sorted.length)} títulos filtrados`;
    $('omieTitlesBody').innerHTML = sorted.slice(0, 250).map((row) => `<tr><td>${esc(row.date)}</td><td>${tag(row.natureLabel, row.nature === 'R' ? 'green' : 'red')}</td><td>${esc(row.clientName)}</td><td>${esc(row.categoryName)}<div class="omie-mini">${esc(row.accountName)}</div></td><td>${tag(row.status, statusClass(row.status))}</td><td class="num">${money(row.amount)}</td><td class="num">${money(row.openAmount)}</td></tr>`).join('') || '<tr><td colspan="7" class="omie-empty">Sem títulos.</td></tr>';
    updateSortArrows('titles');
  }

  function renderAccounts(accountGroups) {
    const movementMap = new Map(accountGroups.map((item) => [String(item.code), item]));
    const rows = state.data.accounts.map((account) => {
      const movement = movementMap.get(String(account.id));
      return {
        account,
        name: account.name || '',
        bank: account.bank || '',
        type: account.type || '',
        initialBalance: Number(account.initialBalance) || 0,
        net: movement ? movement.net : 0,
        statusText: account.inactive ? 'INATIVA' : account.blocked ? 'BLOQUEADA' : 'ATIVA',
      };
    });
    const sorted = applySort(rows, 'accounts');
    $('omieAccountsBody').innerHTML = sorted.map(({ account, net, statusText }) => `<tr><td><strong style="color:var(--ink);font-weight:600">${esc(account.name)}</strong><div class="omie-mini">${esc(account.id)}</div></td><td>${esc(account.bank || '—')}</td><td>${esc(account.type || '—')}</td><td class="num">${money(account.initialBalance)}</td><td class="num" style="color:${net >= 0 ? 'var(--teal)' : '#ef4444'};font-weight:700">${money(net)}</td><td>${tag(statusText, statusText === 'ATIVA' ? 'green' : 'amber')}</td></tr>`).join('');
    updateSortArrows('accounts');
  }

  function renderMeta(rows) {
    const data = state.data;
    $('omieDataMovements').textContent = number(data.counts.movements);
    $('omieDataCategories').textContent = number(data.counts.categories);
    $('omieDataClients').textContent = number(data.counts.clients);
    $('omieDataMeta').innerHTML = [
      ['Base de data', labelDateField(data.filters.dateField)],
      ['Período consultado', `${data.filters.startDate} até ${data.filters.endDate}`],
      ['Movimentos filtrados', number(rows.length)],
      ['Contas correntes', number(data.counts.accounts)],
      ['Última carga', new Date(data.generatedAt).toLocaleString('pt-BR')],
      ['Origem', 'API Omiê'],
    ].map(([label, value]) => `<div><strong>${esc(label)}</strong><br>${esc(value)}</div>`).join('');
  }

  function tag(text, cls = '') {
    return `<span class="omie-tag ${cls}">${esc(text || '—')}</span>`;
  }

  function statusClass(status) {
    const value = String(status || '').toUpperCase();
    if (value.includes('CANCEL')) return 'red';
    if (value.includes('PAGO') || value.includes('RECEB')) return 'green';
    if (value.includes('VENC')) return 'amber';
    return 'blue';
  }

  function labelDateField(value) {
    return ({ vencimento: 'Vencimento', emissao: 'Emissão', pagamento: 'Pagamento', previsao: 'Previsão', registro: 'Registro' })[value] || value;
  }

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function truncate(value, size) {
    const text = String(value || '');
    return text.length > size ? text.slice(0, size - 1) + '…' : text;
  }

  function sum(rows, key) {
    return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  }

  init();
})();
