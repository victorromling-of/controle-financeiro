const { createSessionCookie, safeCompare } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Metodo nao permitido.' });
    return;
  }

  const expectedPassword = process.env.FINANCE_DASHBOARD_PASSWORD;
  const sessionSecret = process.env.FINANCE_SESSION_SECRET;

  if (!expectedPassword || !sessionSecret) {
    res.status(500).json({ ok: false, error: 'Protecao por senha nao configurada.' });
    return;
  }

  const body = await readBody(req);
  const password = String(body.password || '');
  const next = safeNext(body.next);

  if (!safeCompare(password, expectedPassword)) {
    return redirect(res, `/?erro=senha&next=${encodeURIComponent(next)}`);
  }

  res.setHeader('Set-Cookie', createSessionCookie(sessionSecret, req));
  return redirect(res, next);
};

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.end();
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return parseBody(req.body, req.headers?.['content-type']);

  const raw = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  return parseBody(raw, req.headers?.['content-type']);
}

function parseBody(raw, contentType = '') {
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }

  return Object.fromEntries(new URLSearchParams(raw || ''));
}

function safeNext(value) {
  const next = String(value || '/');
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/api/auth-login') || next.startsWith('/api/auth-logout')) {
    return '/';
  }
  return next;
}
