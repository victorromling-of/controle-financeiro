const crypto = require('crypto');

const COOKIE_NAME = 'finance_session';
const SESSION_MAX_AGE = 60 * 60 * 8;

function requireSession(req, res) {
  const sessionSecret = process.env.FINANCE_SESSION_SECRET;

  if (!sessionSecret) {
    res.status(500).json({ ok: false, error: 'Protecao por senha nao configurada.' });
    return false;
  }

  const cookies = parseCookies(req.headers?.cookie || '');
  if (safeCompare(cookies[COOKIE_NAME], sessionSecret)) {
    return true;
  }

  res.status(401).json({ ok: false, error: 'Nao autorizado.' });
  return false;
}

function createSessionCookie(value, req) {
  const host = req.headers?.host || '';
  const secure = /(^localhost(:|$)|^127\.0\.0\.1(:|$))/i.test(host) ? '' : '; Secure';
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

function clearSessionCookie(req) {
  const host = req.headers?.host || '';
  const secure = /(^localhost(:|$)|^127\.0\.0\.1(:|$))/i.test(host) ? '' : '; Secure';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) return cookies;
    cookies[rawKey] = safeDecode(rawValue.join('=') || '');
    return cookies;
  }, {});
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return '';
  }
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  COOKIE_NAME,
  clearSessionCookie,
  createSessionCookie,
  parseCookies,
  requireSession,
  safeCompare,
};
