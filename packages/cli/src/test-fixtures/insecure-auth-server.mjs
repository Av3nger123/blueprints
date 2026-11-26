// INSECURE TEST DOUBLE. DO NOT COPY INTO AN APPLICATION.
//
// An in-memory server that speaks the auth blueprint's API contract, used to test the verification
// suite and `blueprints verify` end to end. It is deliberately minimal: no persistence, no email,
// scrypt from node:crypto for speed, a fixed admin password. It is not a reference implementation.
//
// BREAK=<a,b,...> injects named defects so tests can assert the matching checks fail.
// MODE=session|token selects the credential style. PORT=0 picks a free port; the chosen port is
// printed as `listening <port>` on stdout.
import http from 'node:http';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

const BREAK = new Set((process.env.BREAK ?? '').split(',').filter(Boolean));
const PORT = Number(process.env.PORT ?? 0);
let ORIGIN = 'http://localhost';
const users = new Map(); // email -> user
const sessions = new Map(); // sha256(id) -> { userId, kind }
const fails = new Map(); // email -> { count, until }
let nextId = 1;
const MODE = process.env.MODE ?? 'session';
const access = new Map(); // sha(token) -> userId
const accessFamily = new Map(); // sha(token) -> family
const refresh = new Map(); // sha(token) -> { userId, family, used }
const revokedFamilies = new Set();
function issueTokens(userId, family = randomBytes(8).toString('hex')) {
  const a = randomBytes(32).toString('base64url');
  const r = randomBytes(32).toString('base64url');
  access.set(sha(a), userId);
  accessFamily.set(sha(a), family);
  refresh.set(sha(r), { userId, family, used: false });
  return { access_token: a, token_type: 'Bearer', expires_in: 600, refresh_token: r };
}
function revokeUser(userId) {
  for (const [k, v] of access) if (v === userId) access.delete(k);
  for (const v of refresh.values()) if (v.userId === userId) revokedFamilies.add(v.family);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const hashPw = (pw) => { const salt = randomBytes(16); return { salt, h: scryptSync(pw, salt, 32) }; };
const DUMMY = hashPw('dummy-password-for-timing');
const checkPw = (pw, rec) => timingSafeEqual(scryptSync(pw, rec.salt, 32), rec.h);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': BREAK.has('cache') ? 'private' : 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const err = (res, status, code, message, h) => send(res, status, { error: { code, message } }, h);
const userView = (u) => ({ id: String(u.id), email: u.email, email_verified: u.verified, roles: u.roles, created_at: u.created, ...(BREAK.has('leak') ? { password_hash: '$argon2id$x' } : {}) });

function cookieFor(id) {
  const parts = [`session=${id}`, 'Path=/', BREAK.has('httponly') ? '' : 'HttpOnly', BREAK.has('samesite') ? '' : 'SameSite=Lax'];
  return parts.filter(Boolean).join('; ');
}
const clearCookie = 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

function newSession(userId) {
  const id = randomBytes(32).toString('base64url');
  sessions.set(sha(id), { userId });
  return id;
}
function currentSession(req) {
  if (MODE === 'token') {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const uid = m && access.get(sha(m[1]));
    return uid ? { key: null, userId: uid } : null;
  }
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie ?? '');
  if (!m) return null;
  const key = sha(m[1]);
  const s = sessions.get(key);
  return s ? { key, ...s } : null;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const ct = req.headers['content-type'] ?? '';
  if (BREAK.has('ctype') && ct.startsWith('application/x-www-form-urlencoded')) return { body: Object.fromEntries(new URLSearchParams(raw)) };
  if (BREAK.has('ctype') && ct.startsWith('text/plain')) { try { return { body: JSON.parse(raw) }; } catch { /* fall through to 415 */ } }
  if (!ct.startsWith('application/json')) return { bad: 415 };
  try { return { body: JSON.parse(raw || '{}') }; } catch { return { bad: 400 }; }
}

const norm = (e) => String(e ?? '').trim().toLowerCase();
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname;
  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  if (unsafe && !BREAK.has('csrf')) {
    const site = req.headers['sec-fetch-site'];
    if ((site && site !== 'same-origin' && site !== 'none') || (req.headers.origin && req.headers.origin !== ORIGIN)) {
      return err(res, 403, 'csrf_failed', 'Cross-site request rejected.');
    }
  }
  let body = {};
  if (unsafe) {
    const r = await readJson(req);
    if (r.bad && !BREAK.has('ctype')) return err(res, r.bad, 'validation_failed', 'Expected application/json.');
    body = r.body ?? {};
  }
  const s = currentSession(req);
  const me = s ? [...users.values()].find((u) => u.id === s.userId) : null;

  if (req.method === 'POST' && path === '/auth/register') {
    const email = norm(body.email);
    const pw = body.password;
    if (!validEmail(email) || typeof pw !== 'string' || pw.length < 15 || pw.length > 128) return err(res, 400, 'validation_failed', 'Invalid email or password.');
    if (!users.has(email) || BREAK.has('regenum')) {
      if (users.has(email)) return err(res, 409, 'conflict', 'exists');
      const roles = BREAK.has('massassign') && Array.isArray(body.roles) ? body.roles : ['user'];
      users.set(email, { id: nextId++, email, pw: hashPw(BREAK.has('trunc') ? pw.slice(0, 72) : pw), verified: false, roles, created: new Date().toISOString() });
    }
    return send(res, 202, { status: 'accepted' });
  }
  if (req.method === 'POST' && path === '/auth/login') {
    const email = norm(body.email);
    const f = fails.get(email);
    if (!BREAK.has('ratelimit') && f && f.count >= 5 && f.until > Date.now()) return err(res, 429, 'rate_limited', 'Too many attempts.', { 'retry-after': '900' });
    const u = users.get(email);
    const ok = u ? checkPw(BREAK.has('trunc') ? String(body.password).slice(0, 72) : String(body.password), u.pw) : (checkPw('x', DUMMY), false);
    if (!ok) {
      const n = (f?.count ?? 0) + 1;
      fails.set(email, { count: n, until: Date.now() + 900_000 });
      if (BREAK.has('loginenum') && !u) return err(res, 404, 'not_found', 'No such user.');
      return err(res, 401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    fails.delete(email);
    if (MODE === 'token') return send(res, 200, { user: userView(u), ...issueTokens(u.id) });
    if (s && !BREAK.has('fixation')) sessions.delete(s.key);
    const id = BREAK.has('fixation') && s ? /session=([^;]+)/.exec(req.headers.cookie)[1] : newSession(u.id);
    if (BREAK.has('fixation')) sessions.set(sha(id), { userId: u.id });
    return send(res, 200, { user: userView(u) }, { 'set-cookie': cookieFor(id) });
  }
  if (MODE === 'token' && req.method === 'POST' && path === '/auth/logout') {
    const r = refresh.get(sha(String(body.refresh_token)));
    if (r) { revokedFamilies.add(r.family); if (!BREAK.has('logout')) for (const [k, f] of accessFamily) if (f === r.family) access.delete(k); }
    return send(res, 204);
  }
  if (MODE === 'token' && req.method === 'POST' && path === '/auth/refresh') {
    const r = refresh.get(sha(String(body.refresh_token)));
    if (!r || revokedFamilies.has(r.family)) return err(res, 401, 'invalid_token', 'Sign in again.');
    if (r.used) { if (!BREAK.has('reuse')) revokedFamilies.add(r.family); return err(res, 401, 'invalid_token', 'Sign in again.'); }
    r.used = true;
    const u = [...users.values()].find((x) => x.id === r.userId);
    return send(res, 200, { user: userView(u), ...issueTokens(u.id, r.family) });
  }
  if (req.method === 'POST' && path === '/auth/logout') {
    if (s && !BREAK.has('logout')) sessions.delete(s.key);
    return send(res, 204, undefined, { 'set-cookie': clearCookie });
  }
  if (req.method === 'POST' && path === '/auth/refresh') {
    if (!me) return err(res, 401, 'unauthenticated', 'Sign in required.');
    sessions.delete(s.key);
    return send(res, 200, { user: userView(me) }, { 'set-cookie': cookieFor(newSession(me.id)) });
  }
  if (req.method === 'GET' && path === '/auth/me') {
    if (!me) return err(res, 401, 'unauthenticated', 'Sign in required.');
    return send(res, 200, { user: userView(me) });
  }
  if (req.method === 'POST' && path === '/auth/password/change') {
    if (!me) return err(res, 401, 'unauthenticated', 'Sign in required.');
    if (typeof body.current_password !== 'string' || !checkPw(body.current_password, me.pw)) return err(res, 400, 'invalid_credentials', 'Current password is incorrect.');
    if (typeof body.new_password !== 'string' || body.new_password.length < 15) return err(res, 400, 'validation_failed', 'Weak password.');
    me.pw = hashPw(body.new_password);
    if (!BREAK.has('pwchange')) { for (const [k, v] of sessions) if (v.userId === me.id) sessions.delete(k); revokeUser(me.id); }
    if (MODE === 'token') return send(res, 204);
    return send(res, 204, undefined, { 'set-cookie': cookieFor(newSession(me.id)) });
  }
  if (req.method === 'POST' && (path === '/auth/password/forgot' || path === '/auth/email/resend')) {
    return send(res, 202, { status: 'accepted' });
  }
  if (req.method === 'POST' && (path === '/auth/password/reset' || path === '/auth/email/verify')) {
    return err(res, 400, 'invalid_token', 'The link is invalid or has expired.');
  }
  if (req.method === 'GET' && path === '/admin/ping') {
    if (!me) return err(res, 401, 'unauthenticated', 'Sign in required.');
    if (!me.roles.includes('admin') && !BREAK.has('authz')) return err(res, 403, 'forbidden', 'Not allowed.');
    return send(res, 200, { ok: true });
  }
  return err(res, 404, 'not_found', 'Not found.');
});
server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address();
  ORIGIN = `http://127.0.0.1:${port}`;
  users.set('admin@example.com', { id: nextId++, email: 'admin@example.com', pw: hashPw('admin-password-long-enough'), verified: true, roles: ['admin'], created: new Date().toISOString() });
  console.log(`listening ${port}`);
});
