const OMIE_ENDPOINTS = {
  payable: 'https://app.omie.com.br/api/v1/financas/contapagar/',
  receivable: 'https://app.omie.com.br/api/v1/financas/contareceber/',
  categories: 'https://app.omie.com.br/api/v1/geral/categorias/',
};

const PAGE_SIZE = 100;
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

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

  const year = Number(req.query?.ano) || new Date().getFullYear();
  const period = {
    filtrar_por_emissao_de: `01/01/${year}`,
    filtrar_por_emissao_ate: `31/12/${year}`,
  };

  try {
    const payable = await fetchAllOmie(OMIE_ENDPOINTS.payable, 'ListarContasPagar', {
        apenas_importado_api: 'N',
        ordem_descrescente: 'S',
        ...period,
      }, 'conta_pagar_cadastro', appKey, appSecret);
    const receivable = await fetchAllOmie(OMIE_ENDPOINTS.receivable, 'ListarContasReceber', {
        apenas_importado_api: 'N',
        ordem_descrescente: 'S',
        ...period,
      }, 'conta_receber_cadastro', appKey, appSecret);
    const categories = await fetchAllOmie(OMIE_ENDPOINTS.categories, 'ListarCategorias', {}, 'categoria_cadastro', appKey, appSecret);

    const response = buildFinancialSummary({ payable, receivable, categories, year });

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

async function fetchAllOmie(endpoint, call, baseParam, listKey, appKey, appSecret) {
  const first = await callOmie(endpoint, call, {
    ...baseParam,
    pagina: 1,
    registros_por_pagina: PAGE_SIZE,
  }, appKey, appSecret);

  const totalPages = Number(first.total_de_paginas) || 1;
  const rows = Array.isArray(first[listKey]) ? [...first[listKey]] : [];

  for (let page = 2; page <= totalPages; page += 1) {
    const result = await callOmie(endpoint, call, {
      ...baseParam,
      pagina: page,
      registros_por_pagina: PAGE_SIZE,
    }, appKey, appSecret);

    if (Array.isArray(result[listKey])) rows.push(...result[listKey]);
  }

  return {
    totalRecords: Number(first.total_de_registros) || rows.length,
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

function buildFinancialSummary({ payable, receivable, categories, year }) {
  const categoryMap = new Map(
    categories.rows.map((category) => [
      String(category.codigo || ''),
      category.descricao || category.descricao_padrao || String(category.codigo || 'Sem categoria'),
    ]),
  );

  const payableRows = payable.rows.filter((row) => isActive(row.status_titulo));
  const receivableRows = receivable.rows.filter((row) => isActive(row.status_titulo));
  const payableYear = payableRows.filter((row) => getYear(row) === year);
  const receivableYear = receivableRows.filter((row) => getYear(row) === year);

  const monthly = MONTHS.map((label, index) => ({
    label,
    payable: sumByMonth(payableYear, index),
    receivable: sumByMonth(receivableYear, index),
    balance: sumByMonth(receivableYear, index) - sumByMonth(payableYear, index),
  }));

  const payableTotal = sumRecords(payableYear);
  const receivableTotal = sumRecords(receivableYear);
  const paidTotal = sumRecords(payableYear.filter((row) => isPaid(row.status_titulo)));
  const receivedTotal = sumRecords(receivableYear.filter((row) => isReceived(row.status_titulo)));
  const payableOpen = sumRecords(payableYear.filter((row) => isOpenPayable(row.status_titulo)));
  const receivableOpen = sumRecords(receivableYear.filter((row) => isOpenReceivable(row.status_titulo)));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    year,
    source: 'Omie',
    counts: {
      payable: payable.totalRecords,
      receivable: receivable.totalRecords,
      categories: categories.totalRecords,
      payableInYear: payableYear.length,
      receivableInYear: receivableYear.length,
    },
    totals: {
      payable: round(payableTotal),
      receivable: round(receivableTotal),
      net: round(receivableTotal - payableTotal),
      paid: round(paidTotal),
      received: round(receivedTotal),
      payableOpen: round(payableOpen),
      receivableOpen: round(receivableOpen),
      overduePayable: round(sumRecords(payableYear.filter(isOverdueOpenPayable))),
      overdueReceivable: round(sumRecords(receivableYear.filter(isOverdueOpenReceivable))),
    },
    monthly: monthly.map((item) => ({
      ...item,
      payable: round(item.payable),
      receivable: round(item.receivable),
      balance: round(item.balance),
    })),
    byCategory: buildCategorySummary(payableYear, receivableYear, categoryMap),
    byStatus: {
      payable: buildStatusSummary(payableYear),
      receivable: buildStatusSummary(receivableYear),
    },
    upcoming: {
      payable: upcomingRows(payableRows.filter(isOpenPayable), categoryMap),
      receivable: upcomingRows(receivableRows.filter(isOpenReceivable), categoryMap),
    },
  };
}

function buildCategorySummary(payableRows, receivableRows, categoryMap) {
  const map = new Map();

  payableRows.forEach((row) => addAllocations(map, row, 'payable', categoryMap));
  receivableRows.forEach((row) => addAllocations(map, row, 'receivable', categoryMap));

  return [...map.values()]
    .map((item) => ({
      ...item,
      payable: round(item.payable),
      receivable: round(item.receivable),
      balance: round(item.receivable - item.payable),
    }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, 12);
}

function addAllocations(map, row, side, categoryMap) {
  const fallbackCode = String(row.codigo_categoria || 'SEM_CATEGORIA');
  const totalValue = amount(row);
  const rawAllocations = Array.isArray(row.categorias) && row.categorias.length
    ? row.categorias
    : [{ codigo_categoria: fallbackCode, valor: totalValue }];

  rawAllocations.forEach((allocation) => {
    const code = String(allocation.codigo_categoria || fallbackCode || 'SEM_CATEGORIA');
    const value = allocationValue(allocation, totalValue, rawAllocations.length);

    if (!map.has(code)) {
      map.set(code, {
        code,
        name: categoryMap.get(code) || code || 'Sem categoria',
        payable: 0,
        receivable: 0,
        count: 0,
      });
    }

    const item = map.get(code);
    item[side] += value;
    item.count += 1;
  });
}

function buildStatusSummary(rows) {
  const map = new Map();

  rows.forEach((row) => {
    const status = row.status_titulo || 'SEM_STATUS';
    if (!map.has(status)) map.set(status, { status, total: 0, count: 0 });
    const item = map.get(status);
    item.total += amount(row);
    item.count += 1;
  });

  return [...map.values()]
    .map((item) => ({ ...item, total: round(item.total) }))
    .sort((a, b) => b.total - a.total);
}

function upcomingRows(rows, categoryMap) {
  const today = startOfToday();

  return rows
    .map((row) => ({
      dueDate: row.data_vencimento || row.data_previsao || '',
      dueTime: parseDate(row.data_vencimento || row.data_previsao)?.getTime() || 0,
      value: round(amount(row)),
      status: row.status_titulo || 'SEM_STATUS',
      category: categoryMap.get(String(row.codigo_categoria || '')) || String(row.codigo_categoria || 'Sem categoria'),
      overdue: (parseDate(row.data_vencimento || row.data_previsao)?.getTime() || 0) < today.getTime(),
    }))
    .filter((row) => row.dueTime > 0)
    .sort((a, b) => a.dueTime - b.dueTime)
    .slice(0, 10)
    .map(({ dueTime, ...row }) => row);
}

function sumByMonth(rows, monthIndex) {
  return sumRecords(rows.filter((row) => parseDate(row.data_vencimento || row.data_previsao)?.getMonth() === monthIndex));
}

function sumRecords(rows) {
  return rows.reduce((sum, row) => sum + amount(row), 0);
}

function amount(row) {
  return Number(row.valor_documento) || 0;
}

function allocationValue(allocation, totalValue, fallbackParts) {
  const fixed = Number(allocation.valor);
  if (Number.isFinite(fixed) && fixed > 0) return fixed;

  const percentage = Number(allocation.percentual);
  if (Number.isFinite(percentage) && percentage > 0) return totalValue * (percentage / 100);

  return fallbackParts > 0 ? totalValue / fallbackParts : totalValue;
}

function getYear(row) {
  return parseDate(row.data_vencimento || row.data_previsao || row.data_emissao)?.getFullYear();
}

function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isActive(status) {
  return normalizeStatus(status) !== 'CANCELADO';
}

function isPaid(status) {
  return ['PAGO', 'LIQUIDADO'].includes(normalizeStatus(status));
}

function isReceived(status) {
  return ['RECEBIDO', 'LIQUIDADO'].includes(normalizeStatus(status));
}

function isOpenPayable(rowOrStatus) {
  const status = typeof rowOrStatus === 'string' ? rowOrStatus : rowOrStatus.status_titulo;
  return isActive(status) && !isPaid(status);
}

function isOpenReceivable(rowOrStatus) {
  const status = typeof rowOrStatus === 'string' ? rowOrStatus : rowOrStatus.status_titulo;
  return isActive(status) && !isReceived(status);
}

function isOverdueOpenPayable(row) {
  return isOpenPayable(row) && isPastDue(row);
}

function isOverdueOpenReceivable(row) {
  return isOpenReceivable(row) && isPastDue(row);
}

function isPastDue(row) {
  const due = parseDate(row.data_vencimento || row.data_previsao);
  return due && due.getTime() < startOfToday().getTime();
}

function normalizeStatus(status) {
  return String(status || '').trim().toUpperCase();
}

function isOmieBusy(message) {
  return String(message || '').toLowerCase().includes('requisi') && String(message || '').toLowerCase().includes('execut');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
