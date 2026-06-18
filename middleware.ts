const COOKIE_NAME = 'finance_session';
const PUBLIC_PATHS = new Set(['/api/auth-login', '/api/auth-logout', '/favicon.ico', '/robots.txt']);

export const config = {
  matcher: '/:path*',
};

export default function middleware(request) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS' || PUBLIC_PATHS.has(url.pathname)) {
    return;
  }

  const sessionSecret = process.env.FINANCE_SESSION_SECRET || '';
  const sessionCookie = getCookie(request.headers.get('cookie') || '', COOKIE_NAME);

  if (sessionSecret && sessionCookie === sessionSecret) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return Response.json(
      { ok: false, error: 'Nao autorizado.' },
      {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  return new Response(renderLoginPage(url), {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function getCookie(header, name) {
  return header
    .split(';')
    .map((part) => part.trim())
    .reduce((value, part) => {
      if (value) return value;
      const [key, ...rest] = part.split('=');
      return key === name ? safeDecode(rest.join('=')) : '';
    }, '');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return '';
  }
}

function renderLoginPage(url) {
  const failed = url.searchParams.get('erro') === 'senha';
  const next = safeNext(url.searchParams.get('next') || `${url.pathname}${url.search}`);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acesso financeiro</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,Arial,sans-serif;background:#f3f7f6;color:#14213d;padding:22px}.box{width:min(420px,100%);background:#fff;border:1px solid #d8e3e0;border-radius:10px;padding:28px;box-shadow:0 18px 50px rgba(15,42,38,.12)}.kicker{margin:0 0 8px;color:#006b65;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:0 0 8px;font-size:24px;line-height:1.15}p{margin:0 0 22px;color:#64748b;font-size:14px;line-height:1.5}label{display:block;margin:0 0 8px;color:#334155;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}input{width:100%;height:46px;border:1px solid #ccd8d5;border-radius:8px;padding:0 12px;font-size:16px;outline:none}input:focus{border-color:#006b65;box-shadow:0 0 0 3px rgba(0,107,101,.12)}button{width:100%;height:46px;border:0;border-radius:8px;background:#006b65;color:#fff;font-weight:800;cursor:pointer;margin-top:14px}.error{background:#fee2e2;color:#991b1b;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px}.foot{margin:16px 0 0;color:#94a3b8;font-size:12px}
</style>
</head>
<body>
  <main class="box">
    <p class="kicker">Controle financeiro</p>
    <h1>Acesso protegido</h1>
    <p>Digite a senha para abrir o dashboard financeiro.</p>
    ${failed ? '<div class="error">Senha incorreta. Tente novamente.</div>' : ''}
    <form method="post" action="/api/auth-login">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">Entrar</button>
    </form>
    <p class="foot">A sessao fica salva neste navegador por algumas horas.</p>
  </main>
</body>
</html>`;
}

function safeNext(value) {
  if (!value || value.startsWith('/api/auth-login') || value.startsWith('/api/auth-logout')) return '/';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}
