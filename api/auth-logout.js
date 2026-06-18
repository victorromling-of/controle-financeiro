const { clearSessionCookie } = require('./_auth');

module.exports = function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie(req));
  res.statusCode = 303;
  res.setHeader('Location', '/');
  res.end();
};
