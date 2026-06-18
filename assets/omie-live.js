(() => {
  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const state = {
    loaded: false,
    loading: false,
    data: null,
    rows: [],
    selectedMonths: new Set(MONTHS.map((_, index) => index + 1)),
    charts: {},
  };

  const byId = (id) => document.getElementById(id);
  const money = (value) => 'R$ ' + (Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shortMoney = (value) => Math.abs(Number(value) || 0) >= 1000000
    ? 'R$ ' + ((Number(value) || 0) / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'
    : 'R$ ' + ((Number(value) || 0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);

  function init() {
    buildMonths();
    bindNavigation();
    bindFilters();
  }

  async function ensureLoaded(force = false) {
    if (state.loading) return;
    if (state.loaded && !force) {
      render();
      return;
    }

    state.loading = true;
    setStatus('Carregando dados da Omiê...');
    byId('omieRefresh').disabled = true;

    const year = Number(byId('omieYear').value) || 2026;
    const dateField = byId('omieDateField').value || 'vencimento';
    const url = `/api/omie-financeiro?ano=${encodeURIComponent(year)}&dataBase=${encodeURIComponent(dateField)}`;

    try {
      const response = await fetch(url, { cache: force ? 'reload' : 'default' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.detail || payload.error || 'Falha ao carregar dados.');

      state.data = payload;
      state.loaded = true;
      populateFilterOptions(payload);
      setStatus(`Sincronizado com ${payload.counts.movements.toLocaleString('pt-BR')} movimentos, ${payload.counts.categories.toLocaleString('pt-BR')} categorias, ${payload.counts.clients.toLocaleString('pt-BR')} parceiros e ${payload.counts.accounts.toLocaleString('pt-BR')} contas.`);
      render();
    } catch (error) {
      setStatus('Não foi possível carregar os dados da Omiê agora. ' + error.message, true);
    } finally {
      state.loading = false;
      byId('omieRefresh').disabled = false;
    }
  }

  function bindNavigation() {
    document.querySelectorAll('.omie-nav').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.omie-nav').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('.omie-view').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        document.querySelector(`[data-omie-panel="${button.dataset.omieView}"]`)?.classList.add('active');
        setTimeout(resizeCharts, 40);
      });
    });
  }

  function bindFilters() {
    byId('omieRefresh').addEventListener('click', () => ensureLoaded(true));
    byId('omieYear').addEventListener('change', () => ensureLoaded(true));
    byId('omieDateField').addEventListener('change', render);
    ['omieNature', 'omieStatusFilter', 'omieCategoryFilter', 'omieAccountFilter', 'omieSearch'].forEach((id) => {
      byId(id).addEventListener(id === 'omieSearch' ? 'input' : 'change', render);
    });
  }

  function buildMonths() {
    const wrap = byId('omieMonths');
    wrap.innerHTML = '';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'omie-month active';
    all.textContent = 'Todos';
    all.dataset.month = 'all';
    all.addEventListener('click', () => {
      state.selectedMonths = new Set(MONTHS.map((_, index) => index + 1));
      syncMonthButtons();
      render();
    });
    wrap.appendChild(all);

    MONTHS.forEach((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'omie-month active';
      button.textContent = label;
      button.dataset.month = String(index + 1);
      button.addEventListener('click', () => {
        const month = index + 1;
        if (state.selectedMonths.has(month) && state.selectedMonths.size > 1) state.selectedMonths.delete(month);
        else state.selectedMonths.add(month);
        syncMonthButtons();
        render();
      });
      wrap.appendChild(button);
    });
  }

  function syncMonthButtons() {
    document.querySelectorAll('.omie-month').forEach((button) => {
      if (button.dataset.month === 'all') {
        button.classList.toggle('active', state.selectedMonths.size === 12);
      } else {
        button.classList.toggle('active', state.selectedMonths.has(Number(button.dataset.month)));
      }
    });
  }

  function populateFilterOptions(data) {
    fillSelect(byId('omieStatusFilter'), [
      { value: '', label: 'Todos' },
      ...data.facets.status.map((item) => ({ value: item, label: item })),
    ]);
    fillSelect(byId('omieCategoryFilter'), [
      { value: '', label: 'Todas' },
      ...data.facets.categories.map((item) => ({ value: item.code, label: item.name })),
    ]);
    fillSelect(byId('omieAccountFilter'), [
      { value: '', label: 'Todas' },
      ...data.accounts.map((item) => ({ value: item.id, label: item.name })),
    ]);
  }

  function fillSelect(select, options) {
    const previous = select.value;
    select.innerHTML = options.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('');
    if (options.some((item) => String(item.value) === previous)) select.value = previous;
  }

  function render() {
    if (!state.data) return;
    state.rows = filterRows(state.data.movements);
    const summary = summarizeRows(state.rows);
    updateHeader();
    renderKpis(summary);
    renderCharts(summary);
    renderTables(summary);
    renderMeta(summary);
    setTimeout(resizeCharts, 40);
  }

  function filterRows(rows) {
    const nature = byId('omieNature').value;
    const status = byId('omieStatusFilter').value;
    const category = byId('omieCategoryFilter').value;
    const account = byId('omieAccountFilter').value;
    const search = normalizeText(byId('omieSearch').value);

    return rows.filter((row) => {
      if (!state.selectedMonths.has(monthForRow(row))) return false;
      if (nature && row.nature !== nature) return false;
      if (status && row.status !== status) return false;
      if (category && row.categoryCode !== category) return false;
      if (account && row.accountId !== account) return false;
      if (search) {
        const haystack = normalizeText([row.clientName, row.categoryName, row.status, row.type, row.accountName, row.natureLabel].join(' '));
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function summarizeRows(rows) {
    const monthly = MONTHS.map((label, index) => {
      const monthRows = rows.filter((row) => monthForRow(row) === index + 1);
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

    const totals = rows.reduce((acc, row) => {
      if (row.nature === 'P') {
        acc.payable += row.amount;
        acc.payableOpen += row.openAmount;
      } else {
        acc.receivable += row.amount;
        acc.receivableOpen += row.openAmount;
      }
      acc.net += row.signedAmount;
      acc.open += row.nature === 'R' ? row.openAmount : -row.openAmount;
      acc.paid += row.paidAmount;
      return acc;
    }, { payable: 0, receivable: 0, net: 0, open: 0, paid: 0, payableOpen: 0, receivableOpen: 0 });

    return {
      totals,
      monthly,
      byStatus: groupRows(rows, 'status'),
      byCategory: groupRows(rows, 'categoryCode', 'categoryName'),
      byClient: groupRows(rows, 'clientId', 'clientName'),
      byAccount: groupRows(rows, 'accountId', 'accountName'),
      byType: groupRows(rows, 'type'),
      rows,
    };
  }

  function groupRows(rows, codeKey, nameKey = codeKey) {
    const map = new Map();
    rows.forEach((row) => {
      const code = String(row[codeKey] || 'SEM_VALOR');
      const name = row[nameKey] || code;
      if (!map.has(code)) map.set(code, { code, name, count: 0, payable: 0, receivable: 0, open: 0, paid: 0, net: 0 });
      const item = map.get(code);
      item.count += 1;
      if (row.nature === 'P') item.payable += row.amount;
      else item.receivable += row.amount;
      item.open += row.nature === 'R' ? row.openAmount : -row.openAmount;
      item.paid += row.paidAmount;
      item.net += row.signedAmount;
    });
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }

  function updateHeader() {
    const data = state.data;
    const updated = new Date(data.generatedAt).toLocaleString('pt-BR');
    byId('omieUpdated').textContent = `Atualizado em ${updated}`;
    byId('omieScope').textContent = `${data.counts.movements.toLocaleString('pt-BR')} movimentos · ${labelDateField(byId('omieDateField').value)} · ${data.filters.startDate} a ${data.filters.endDate}`;
  }

  function renderKpis(summary) {
    byId('omiePagarTotal').textContent = shortMoney(summary.totals.payable);
    byId('omiePagarSub').textContent = `${summary.rows.filter((row) => row.nature === 'P').length.toLocaleString('pt-BR')} títulos · aberto ${shortMoney(summary.totals.payableOpen)}`;
    byId('omieReceberTotal').textContent = shortMoney(summary.totals.receivable);
    byId('omieReceberSub').textContent = `${summary.rows.filter((row) => row.nature === 'R').length.toLocaleString('pt-BR')} títulos · aberto ${shortMoney(summary.totals.receivableOpen)}`;
    byId('omieSaldoTotal').textContent = shortMoney(summary.totals.net);
    byId('omieSaldoTotal').style.color = summary.totals.net >= 0 ? 'var(--teal)' : '#ef4444';
    byId('omieSaldoSub').textContent = `${summary.rows.length.toLocaleString('pt-BR')} movimentos filtrados`;
    byId('omieAbertoTotal').textContent = shortMoney(Math.abs(summary.totals.open));
    byId('omieAbertoSub').textContent = `Pagar ${shortMoney(summary.totals.payableOpen)} · receber ${shortMoney(summary.totals.receivableOpen)}`;
  }

  function renderCharts(summary) {
    setChart('omieFluxo', {
      type: 'bar',
      data: {
        labels: summary.monthly.map((item) => item.label),
        datasets: [
          { label: 'Pagar', data: summary.monthly.map((item) => item.payable), backgroundColor: '#ef444488', borderRadius: 4 },
          { label: 'Receber', data: summary.monthly.map((item) => item.receivable), backgroundColor: '#10b981aa', borderRadius: 4 },
          { label: 'Saldo', type: 'line', data: summary.monthly.map((item) => item.net), borderColor: '#006b65', backgroundColor: '#006b6522', borderWidth: 2, pointRadius: 4, tension: 0.3 },
        ],
      },
      options: chartOptions(),
    });

    setChart('omieStatusChart', {
      type: 'doughnut',
      data: {
        labels: summary.byStatus.map((item) => item.name).slice(0, 8),
        datasets: [{ data: summary.byStatus.map((item) => item.payable + item.receivable).slice(0, 8), backgroundColor: ['#006b65', '#ef4444', '#10b981', '#f59e0b', '#1d4ed8', '#7c3aed', '#64748b', '#14b8a6'], borderColor: '#fff', borderWidth: 2 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${money(ctx.raw)}` } } } },
    });

    setChart('omieCategoryChart', barChart(summary.byCategory.slice(0, 10), 'name', 'net'));
    setChart('omiePartnerChart', barChart(summary.byClient.slice(0, 10), 'name', 'net'));
    setChart('omieCumulativeChart', {
      type: 'line',
      data: {
        labels: summary.monthly.map((item) => item.label),
        datasets: [{ label: 'Saldo acumulado', data: summary.monthly.map((item) => item.cumulative), borderColor: '#006b65', backgroundColor: '#006b6520', borderWidth: 2, fill: true, tension: 0.32, pointRadius: 4 }],
      },
      options: chartOptions(),
    });
    setChart('omieOpenPaidChart', {
      type: 'bar',
      data: {
        labels: summary.monthly.map((item) => item.label),
        datasets: [
          { label: 'Pago/baixado', data: summary.monthly.map((item) => item.paid), backgroundColor: '#16a34aaa', borderRadius: 4 },
          { label: 'Aberto', data: summary.monthly.map((item) => Math.abs(item.open)), backgroundColor: '#f59e0baa', borderRadius: 4 },
        ],
      },
      options: chartOptions(),
    });
  }

  function barChart(rows, labelKey, valueKey) {
    return {
      type: 'bar',
      data: {
        labels: rows.map((item) => compactLabel(item[labelKey])),
        datasets: [{ data: rows.map((item) => item[valueKey]), backgroundColor: rows.map((item) => item[valueKey] >= 0 ? '#10b981bb' : '#ef4444aa'), borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => money(ctx.raw) } } },
        scales: { x: { ticks: { font: { size: 10 }, callback: (value) => 'R$' + (value / 1000).toFixed(0) + 'k' }, grid: { color: '#f0f4f3' } }, y: { ticks: { font: { size: 10 } }, grid: { display: false } } },
      },
    };
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.raw)}` } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { grid: { color: '#f0f4f3' }, ticks: { font: { size: 11 }, callback: (value) => 'R$' + (value / 1000).toFixed(0) + 'k' } } },
    };
  }

  function setChart(id, config) {
    const canvas = byId(id);
    if (!canvas) return;
    if (state.charts[id]) state.charts[id].destroy();
    state.charts[id] = new Chart(canvas, config);
  }

  function resizeCharts() {
    Object.values(state.charts).forEach((chart) => chart.resize());
  }

  function renderTables(summary) {
    byId('omieMonthlyBody').innerHTML = summary.monthly.map((row) => `
      <tr><td>${row.label}</td><td class="num">${row.count.toLocaleString('pt-BR')}</td><td class="num">${money(row.payable)}</td><td class="num">${money(row.receivable)}</td><td class="num">${money(row.open)}</td><td class="num" style="color:${row.net >= 0 ? 'var(--teal)' : '#ef4444'};font-weight:700">${money(row.net)}</td></tr>
    `).join('');

    byId('omieCategoriasBody').innerHTML = tableRows(summary.byCategory.slice(0, 40), 'category');
    byId('omiePartnersBody').innerHTML = tableRows(summary.byClient.slice(0, 60), 'partner');
    byId('omieTitlesBody').innerHTML = titleRows(summary.rows.slice().sort((a, b) => dateISOForRow(a).localeCompare(dateISOForRow(b)) || Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 250));
    byId('omieTitleCount').textContent = `${summary.rows.length.toLocaleString('pt-BR')} movimentos filtrados`;
    byId('omieAccountsBody').innerHTML = accountRows(summary);
  }

  function tableRows(rows, kind) {
    if (!rows.length) return `<tr><td colspan="6" class="omie-empty">Sem dados.</td></tr>`;
    return rows.map((row) => `
      <tr>
        <td><strong style="color:var(--ink);font-weight:600">${escapeHtml(row.name)}</strong><div class="omie-mini">${escapeHtml(row.code)}</div></td>
        <td class="num">${row.count.toLocaleString('pt-BR')}</td>
        <td class="num">${money(row.payable)}</td>
        <td class="num">${money(row.receivable)}</td>
        <td class="num">${money(row.open)}</td>
        <td class="num" style="color:${row.net >= 0 ? 'var(--teal)' : '#ef4444'};font-weight:700">${money(row.net)}</td>
      </tr>
    `).join('');
  }

  function titleRows(rows) {
    if (!rows.length) return `<tr><td colspan="7" class="omie-empty">Sem títulos.</td></tr>`;
    return rows.map((row) => `
      <tr>
        <td>${escapeHtml(dateForRow(row))}</td>
        <td>${tag(row.natureLabel, row.nature === 'R' ? 'green' : 'blue')}</td>
        <td>${escapeHtml(row.clientName)}</td>
        <td>${escapeHtml(row.categoryName)}</td>
        <td>${tag(row.status, statusColor(row.status))}</td>
        <td class="num">${money(row.amount)}</td>
        <td class="num">${money(row.openAmount)}</td>
      </tr>
    `).join('');
  }

  function accountRows(summary) {
    const movementByAccount = new Map(summary.byAccount.map((row) => [row.code, row]));
    const rows = state.data.accounts.map((account) => ({ ...account, movement: movementByAccount.get(account.id) }));
    return rows.map((row) => `
      <tr>
        <td><strong style="color:var(--ink);font-weight:600">${escapeHtml(row.name)}</strong><div class="omie-mini">${escapeHtml(row.id)}</div></td>
        <td>${escapeHtml(row.bank || '—')}</td>
        <td>${escapeHtml(row.type || '—')}</td>
        <td class="num">${money(row.initialBalance)}</td>
        <td class="num" style="color:${(row.movement?.net || 0) >= 0 ? 'var(--teal)' : '#ef4444'};font-weight:700">${money(row.movement?.net || 0)}</td>
        <td>${row.inactive ? tag('Inativa', 'amber') : tag('Ativa', 'green')}</td>
      </tr>
    `).join('');
  }

  function renderMeta(summary) {
    byId('omieDataMovements').textContent = state.data.counts.movements.toLocaleString('pt-BR');
    byId('omieDataCategories').textContent = state.data.counts.categories.toLocaleString('pt-BR');
    byId('omieDataClients').textContent = state.data.counts.clients.toLocaleString('pt-BR');
    byId('omieDataMeta').innerHTML = [
      ['Base de data', labelDateField(byId('omieDateField').value)],
      ['Período', `${state.data.filters.startDate} a ${state.data.filters.endDate}`],
      ['Filtrados na tela', summary.rows.length.toLocaleString('pt-BR')],
      ['Contas correntes', state.data.counts.accounts.toLocaleString('pt-BR')],
    ].map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</div>`).join('');
  }

  function sum(rows, key) {
    return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  }

  function tag(text, color = '') {
    return `<span class="omie-tag ${color}">${escapeHtml(text || '—')}</span>`;
  }

  function statusColor(status) {
    const value = String(status || '').toUpperCase();
    if (['PAGO', 'RECEBIDO', 'LIQUIDADO'].includes(value)) return 'green';
    if (['CANCELADO', 'ATRASADO'].includes(value)) return 'red';
    if (['A VENCER', 'EMABERTO', 'VENCEHOJE', 'PAGTO_PARCIAL'].includes(value)) return 'amber';
    return 'blue';
  }

  function labelDateField(value) {
    return {
      vencimento: 'Vencimento',
      emissao: 'Emissão',
      pagamento: 'Pagamento',
      previsao: 'Previsão',
      registro: 'Registro',
    }[value] || value;
  }

  function dateForRow(row) {
    const key = {
      vencimento: 'dueDate',
      emissao: 'issueDate',
      pagamento: 'paymentDate',
      previsao: 'forecastDate',
      registro: 'recordDate',
    }[byId('omieDateField').value] || 'dueDate';
    return row[key] || row.date || row.dueDate || row.forecastDate || row.issueDate || '';
  }

  function monthForRow(row) {
    const date = dateForRow(row);
    const match = String(date).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? Number(match[2]) : row.month;
  }

  function dateISOForRow(row) {
    const date = dateForRow(row);
    const match = String(date).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
  }

  function compactLabel(value) {
    const text = String(value || '—');
    return text.length > 24 ? text.slice(0, 22) + '…' : text;
  }

  function normalizeText(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function setStatus(text, isError = false) {
    const status = byId('omieStatus');
    status.className = 'omie-state' + (isError ? ' error' : '');
    status.textContent = text;
  }

  init();
  window.omieLive = { ensureLoaded, render };
})();
