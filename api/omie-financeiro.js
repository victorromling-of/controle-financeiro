const OMIE_ENDPOINTS = {
  movements: 'https://app.omie.com.br/api/v1/financas/mf/',
  categories: 'https://app.omie.com.br/api/v1/geral/categorias/',
  clients: 'https://app.omie.com.br/api/v1/geral/clientes/',
  accounts: 'https://app.omie.com.br/api/v1/geral/contacorrente/',
};

const PAGE_SIZE = 500;
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DATE_FIELD_MAP = {
  vencimento: { from: 'dDtVencDe', to: 'dDtVencAte', row: 'dueDate' },
  emissao: { from: 'dDtEmisDe', to: 'dDtEmisAte', row: 'issueDate' },
  pagamento: { from: 'dDtPagtoDe', to: 'dDtPagtoAte', row: 'paymentDate' },
  previsao: { from: 'dDtPrevDe', to: 'dDtPrevAte', row: 'forecastDate' },
  registro: { from: 'dDtRegDe', to: 'dDtRegAte', row: 'recordDate' },
};

module.exports = async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Metodo nao permitido.' });
    return;
  }

  const appKey = process.env.OMIE_APP_KEY;
  const appSecret = process.env.OMIE_APP_SECRET;

  if (!appKey || !appSecret) {
    res.status(500).json({ ok: false, error: 'Credenciais da Omie nao configuradas.' });
    return;
  }

  const query = parseQuery(req.query || {});

  try {
    const movementParam = {
      nPagina: 1,
      nRegPorPagina: PAGE_SIZE,
      lDadosCad: true,
      ...buildOmiePeriod(query),
    };

    const movements = await fetchAllOmie({
      endpoint: OMIE_ENDPOINTS.movements,
      call: 'ListarMovimentos',
      baseParam: movementParam,
      listKey: 'movimentos',
      pageParam: 'nPagina',
      pageSizeParam: 'nRegPorPagina',
      totalPagesKey: 'nTotPaginas',
      totalRecordsKey: 'nTotRegistros',
      appKey,
      appSecret,
    });

    const categories = await fetchAllOmie({
      endpoint: OMIE_ENDPOINTS.categories,
      call: 'ListarCategorias',
      baseParam: { pagina: 1, registros_por_pagina: PAGE_SIZE },
      listKey: 'categoria_cadastro',
      appKey,
      appSecret,
    });

    const clients = await fetchAllOmie({
      endpoint: OMIE_ENDPOINTS.clients,
      call: 'ListarClientesResumido',
      baseParam: { pagina: 1, registros_por_pagina: PAGE_SIZE, apenas_importado_api: 'N' },
      listKey: 'clientes_cadastro_resumido',
      appKey,
      appSecret,
    });

    const accounts = await fetchAllOmie({
      endpoint: OMIE_ENDPOINTS.accounts,
      call: 'ListarContasCorrentes',
      baseParam: { pagina: 1, registros_por_pagina: PAGE_SIZE, apenas_importado_api: 'N' },
      listKey: 'ListarContasCorrentes',
      appKey,
      appSecret,
    });

    const response = buildDashboardData({
      movements,
      categories,
      clients,
      accounts,
      query,
    });

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    res.status(200).json(response);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: 'Falha ao consultar a Omie.',
      detail: error.message,
    });
  }
};

function parseQuery(query) {
  const year = clampNumber(Number(query.ano), 2020, 2035) || new Date().getFullYear();
  const dateField = DATE_FIELD_MAP[query.dataBase] ? query.dataBase : 'vencimento';
  const monthStart = clampNumber(Number(query.mesInicio), 1, 12) || 1;
  const monthEnd = clampNumber(Number(query.mesFim), 1, 12) || 12;
  const startMonth = Math.min(monthStart, monthEnd);
  const endMonth = Math.max(monthStart, monthEnd);

  return {
    year,
    dateField,
    startDate: query.inicio || formatDate(new Date(year, startMonth - 1, 1)),
    endDate: query.fim || formatDate(new Date(year, endMonth, 0)),
  };
}

function buildOmiePeriod(query) {
  const field = DATE_FIELD_MAP[query.dateField] || DATE_FIELD_MAP.vencimento;
  return {
    [field.from]: query.startDate,
    [field.to]: query.endDate,
  };
}

async function fetchAllOmie({
  endpoint,
  call,
  baseParam,
  listKey,
  pageParam = 'pagina',
  pageSizeParam = 'registros_por_pagina',
  totalPagesKey = 'total_de_paginas',
  totalRecordsKey = 'total_de_registros',
  appKey,
  appSecret,
}) {
  const first = await callOmie(endpoint, call, baseParam, appKey, appSecret);
  const totalPages = Number(first[totalPagesKey]) || 1;
  const rows = Array.isArray(first[listKey]) ? [...first[listKey]] : [];

  for (let page = 2; page <= totalPages; page += 1) {
    const result = await callOmie(endpoint, call, {
      ...baseParam,
      [pageParam]: page,
      [pageSizeParam]: PAGE_SIZE,
    }, appKey, appSecret);

    if (Array.isArray(result[listKey])) rows.push(...result[listKey]);
  }

  return {
    totalRecords: Number(first[totalRecordsKey]) || rows.length,
    totalPages,
    rows,
  };
}

async function callOmie(endpoint, call, param, appKey, appSecret, attempt = 1) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call,
      app_key: appKey,
      app_secret: appSecret,
      param: [param],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.faultstring || data.code) {
    const message = data.faultstring || data.description || `Omie HTTP ${response.status}`;
    if (attempt < 6 && isOmieBusy(message)) {
      await sleep(900 + attempt * 700);
      return callOmie(endpoint, call, param, appKey, appSecret, attempt + 1);
    }
    throw new Error(message);
  }

  return data;
}

function buildDashboardData({ movements, categories, clients, accounts, query }) {
  const categoryMap = new Map(categories.rows.map((item) => [
    String(item.codigo || ''),
    {
      code: String(item.codigo || ''),
      name: item.descricao || item.descricao_padrao || String(item.codigo || 'Sem categoria'),
      type: item.tipo_categoria || '',
      nature: item.natureza || '',
      inactive: item.conta_inativa === 'S',
    },
  ]));

  const clientMap = new Map(clients.rows.map((item) => [
    String(item.codigo_cliente || ''),
    {
      id: String(item.codigo_cliente || ''),
      name: item.nome_fantasia || item.razao_social || String(item.codigo_cliente || 'Sem nome'),
      legalName: item.razao_social || '',
    },
  ]));

  const accountMap = new Map(accounts.rows.map((item) => [
    String(item.nCodCC || ''),
    {
      id: String(item.nCodCC || ''),
      name: item.descricao || String(item.nCodCC || 'Conta'),
      bank: item.codigo_banco || '',
      type: item.tipo_conta_corrente || item.tipo || '',
      inactive: item.inativo === 'S',
      blocked: item.bloqueado === 'S',
      initialBalance: round(Number(item.saldo_inicial) || 0),
      limit: round(Number(item.valor_limite) || 0),
    },
  ]));

  const dateField = DATE_FIELD_MAP[query.dateField]?.row || DATE_FIELD_MAP.vencimento.row;
  const normalizedMovements = movements.rows
    .map((item) => normalizeMovement(item, { categoryMap, clientMap, accountMap, dateField }))
    .filter((item) => item.date);

  const summary = buildSummary(normalizedMovements, accountMap);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: 'Omie',
    filters: {
      year: query.year,
      dateField: query.dateField,
      startDate: query.startDate,
      endDate: query.endDate,
    },
    counts: {
      movements: movements.totalRecords,
      categories: categories.totalRecords,
      clients: clients.totalRecords,
      accounts: accounts.totalRecords,
    },
    summary,
    facets: buildFacets(normalizedMovements, { categoryMap, clientMap, accountMap }),
    movements: normalizedMovements,
    accounts: [...accountMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    categories: [...categoryMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    clients: [...clientMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

function normalizeMovement(item, { categoryMap, clientMap, accountMap, dateField }) {
  const detail = item.detalhes || {};
  const resume = item.resumo || {};
  const nature = detail.cNatureza || '';
  const amount = round(Number(detail.nValorTitulo) || Number(resume.nValLiquido) || Number(resume.nValPago) || 0);
  const category = categoryMap.get(String(detail.cCodCateg || '')) || {};
  const client = clientMap.get(String(detail.nCodCliente || '')) || {};
  const account = accountMap.get(String(detail.nCodCC || '')) || {};
  const row = {
    id: String(detail.nCodTitulo || ''),
    titleNumber: detail.cNumTitulo || '',
    nature,
    natureLabel: nature === 'R' ? 'Receber' : 'Pagar',
    status: detail.cStatus || 'SEM_STATUS',
    type: detail.cTipo || '',
    operation: detail.cOperacao || '',
    group: detail.cGrupo || '',
    amount,
    signedAmount: nature === 'R' ? amount : -amount,
    paidAmount: round(Number(resume.nValPago) || 0),
    openAmount: round(Number(resume.nValAberto) || 0),
    liquidAmount: round(Number(resume.nValLiquido) || amount),
    isLiquidated: resume.cLiquidado === 'S' || ['PAGO', 'RECEBIDO', 'LIQUIDADO'].includes(String(detail.cStatus || '').toUpperCase()),
    issueDate: detail.dDtEmissao || '',
    dueDate: detail.dDtVenc || '',
    forecastDate: detail.dDtPrevisao || '',
    paymentDate: detail.dDtPagamento || '',
    recordDate: detail.dDtRegistro || '',
    date: '',
    dateISO: '',
    month: null,
    categoryCode: String(detail.cCodCateg || ''),
    categoryName: category.name || detail.cCodCateg || 'Sem categoria',
    clientId: String(detail.nCodCliente || ''),
    clientName: client.name || String(detail.nCodCliente || 'Sem cliente'),
    accountId: String(detail.nCodCC || ''),
    accountName: account.name || String(detail.nCodCC || 'Sem conta'),
  };

  row.date = row[dateField] || row.dueDate || row.forecastDate || row.issueDate || row.paymentDate || row.recordDate || '';
  const parsed = parseDate(row.date);
  row.dateISO = parsed ? parsed.toISOString().slice(0, 10) : '';
  row.month = parsed ? parsed.getMonth() + 1 : null;
  row.overdue = !row.isLiquidated && row.dueDate && (parseDate(row.dueDate)?.getTime() || 0) < startOfToday().getTime();

  return row;
}

function buildSummary(rows, accountMap) {
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
  }, {
    payable: 0,
    receivable: 0,
    net: 0,
    open: 0,
    paid: 0,
    payableOpen: 0,
    receivableOpen: 0,
    overduePayable: 0,
    overdueReceivable: 0,
  });

  const monthly = MONTHS.map((label, index) => {
    const monthRows = rows.filter((row) => row.month === index + 1);
    const payable = sumBy(monthRows.filter((row) => row.nature === 'P'), 'amount');
    const receivable = sumBy(monthRows.filter((row) => row.nature === 'R'), 'amount');
    return {
      month: index + 1,
      label,
      payable: round(payable),
      receivable: round(receivable),
      net: round(receivable - payable),
      paid: round(sumBy(monthRows, 'paidAmount')),
      open: round(sumBy(monthRows.map((row) => ({ value: row.nature === 'R' ? row.openAmount : -row.openAmount })), 'value')),
      count: monthRows.length,
    };
  });

  let cumulative = 0;
  monthly.forEach((item) => {
    cumulative += item.net;
    item.cumulative = round(cumulative);
  });

  return {
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value)])),
    monthly,
    byStatus: groupRows(rows, 'status'),
    byCategory: groupRows(rows, 'categoryCode', 'categoryName'),
    byClient: groupRows(rows, 'clientId', 'clientName'),
    byAccount: groupRows(rows, 'accountId', 'accountName'),
    byType: groupRows(rows, 'type'),
    accountsBalance: [...accountMap.values()].map((account) => ({
      ...account,
      movementNet: round(sumBy(rows.filter((row) => row.accountId === account.id), 'signedAmount')),
    })),
  };
}

function buildFacets(rows, { categoryMap, clientMap, accountMap }) {
  return {
    months: MONTHS.map((label, index) => ({ value: index + 1, label })),
    status: [...new Set(rows.map((row) => row.status).filter(Boolean))].sort(),
    nature: [
      { value: 'P', label: 'Pagar' },
      { value: 'R', label: 'Receber' },
    ],
    categories: [...categoryMap.values()].filter((item) => rows.some((row) => row.categoryCode === item.code)),
    clients: [...clientMap.values()].filter((item) => rows.some((row) => row.clientId === item.id)),
    accounts: [...accountMap.values()].filter((item) => rows.some((row) => row.accountId === item.id)),
    types: [...new Set(rows.map((row) => row.type).filter(Boolean))].sort(),
  };
}

function groupRows(rows, codeKey, nameKey = codeKey) {
  const map = new Map();

  rows.forEach((row) => {
    const code = String(row[codeKey] || 'SEM_VALOR');
    const name = row[nameKey] || code;

    if (!map.has(code)) {
      map.set(code, {
        code,
        name,
        count: 0,
        payable: 0,
        receivable: 0,
        paid: 0,
        open: 0,
        net: 0,
      });
    }

    const item = map.get(code);
    item.count += 1;
    if (row.nature === 'R') item.receivable += row.amount;
    else item.payable += row.amount;
    item.paid += row.paidAmount;
    item.open += row.nature === 'R' ? row.openAmount : -row.openAmount;
    item.net += row.signedAmount;
  });

  return [...map.values()]
    .map((item) => ({
      ...item,
      payable: round(item.payable),
      receivable: round(item.receivable),
      paid: round(item.paid),
      open: round(item.open),
      net: round(item.net),
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(value, min), max);
}

function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function formatDate(date) {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ].join('/');
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isOmieBusy(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('requisi') && normalized.includes('execut');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
