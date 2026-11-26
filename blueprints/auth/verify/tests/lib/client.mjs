// Minimal HTTP client for black-box testing: a cookie jar, optional bearer token, and CSRF handling.
// Uses only Node's built-in fetch (Node 20+), so the suite has no dependencies.
import { randomBytes, randomUUID } from 'node:crypto';
import { config, p } from './config.mjs';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Parse one Set-Cookie header into { name, value, attrs } with lowercased attribute keys. */
export function parseSetCookie(header) {
  const [pair, ...rest] = header.split(';');
  const eq = pair.indexOf('=');
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const attrs = {};
  for (const part of rest) {
    const i = part.indexOf('=');
    const key = (i === -1 ? part : part.slice(0, i)).trim().toLowerCase();
    if (!key) continue;
    attrs[key] = i === -1 ? true : part.slice(i + 1).trim();
  }
  return { name, value, attrs };
}

/** True when a Set-Cookie deletes the cookie (empty value, Max-Age<=0, or an Expires in the past). */
export function isDeletion(cookie) {
  if (cookie.value === '' || cookie.value === '""') return true;
  if (cookie.attrs['max-age'] !== undefined && Number(cookie.attrs['max-age']) <= 0) return true;
  if (typeof cookie.attrs.expires === 'string') {
    const t = Date.parse(cookie.attrs.expires);
    if (!Number.isNaN(t) && t <= Date.now()) return true;
  }
  return false;
}

export class Client {
  constructor() {
    this.cookies = new Map();
    this.accessToken = null;
    this.refreshToken = null;
    this.csrfToken = undefined; // undefined = not fetched yet, null = app does not use tokens
  }

  /** Cookie header value for the current jar. */
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Copy credentials so a test can replay them later from a "stolen" snapshot. */
  snapshot() {
    const c = new Client();
    c.cookies = new Map(this.cookies);
    c.accessToken = this.accessToken;
    c.refreshToken = this.refreshToken;
    c.csrfToken = this.csrfToken;
    return c;
  }

  async ensureCsrf() {
    if (config.mode !== 'session' || this.csrfToken !== undefined) return;
    const res = await this.request('GET', p('/csrf'), { csrf: false });
    this.csrfToken = res.status === 200 && res.json && typeof res.json.csrf_token === 'string'
      ? res.json.csrf_token
      : null;
  }

  /**
   * Send a request. Options:
   *   body       JSON-serialisable body (sets Content-Type: application/json)
   *   rawBody    string body sent as-is (use with headers['content-type'])
   *   headers    extra headers
   *   origin     Origin header for unsafe methods (default: the app's own origin; null to omit)
   *   csrf       attach the CSRF token on unsafe methods (default true)
   *   auth       attach cookies / bearer token (default true)
   */
  async request(method, path, opts = {}) {
    const { body, rawBody, headers = {}, origin = config.origin, csrf = true, auth = true } = opts;
    if (csrf && UNSAFE.has(method)) await this.ensureCsrf();

    const h = { accept: 'application/json', ...lower(headers) };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (UNSAFE.has(method) && origin && !h.origin) h.origin = origin;
    if (UNSAFE.has(method) && origin === config.origin && !h['sec-fetch-site']) h['sec-fetch-site'] = 'same-origin';
    if (auth && this.cookies.size && !h.cookie) h.cookie = this.cookieHeader();
    if (auth && this.accessToken && !h.authorization) h.authorization = `Bearer ${this.accessToken}`;
    if (csrf && UNSAFE.has(method) && this.csrfToken) h[config.csrfHeader.toLowerCase()] = this.csrfToken;

    const res = await fetch(config.baseUrl + path, {
      method,
      headers: h,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const setCookies = res.headers.getSetCookie().map(parseSetCookie);
    if (auth) {
      for (const c of setCookies) {
        if (isDeletion(c)) this.cookies.delete(c.name);
        else this.cookies.set(c.name, c.value);
      }
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, setCookies, text, json };
  }

  get(path, opts) {
    return this.request('GET', path, opts);
  }

  post(path, body, opts = {}) {
    return this.request('POST', path, { ...opts, body });
  }

  async register(email, password, extra = {}) {
    return this.post(p('/register'), { email, password, ...extra });
  }

  /** Log in and keep the resulting credentials. Session credentials rotate, so refetch CSRF next time. */
  async login(email, password) {
    const res = await this.post(p('/login'), { email, password });
    this.csrfToken = undefined;
    if (res.status === 200 && config.mode === 'token' && res.json) {
      this.accessToken = res.json.access_token ?? null;
      this.refreshToken = res.json.refresh_token ?? null;
    }
    return res;
  }

  async logout() {
    const body = config.mode === 'token' ? { refresh_token: this.refreshToken } : {};
    const res = await this.request('POST', p('/logout'), { body });
    this.csrfToken = undefined;
    return res;
  }

  async refresh() {
    const body = config.mode === 'token' ? { refresh_token: this.refreshToken } : {};
    const res = await this.request('POST', p('/refresh'), { body });
    this.csrfToken = undefined;
    if (res.status === 200 && config.mode === 'token' && res.json) {
      this.accessToken = res.json.access_token ?? null;
      this.refreshToken = res.json.refresh_token ?? null;
    }
    return res;
  }

  me() {
    return this.get(p('/me'));
  }
}

function lower(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
}

/** A unique address on the configured test domain. Mixed case on purpose is opt-in via the caller. */
export function uniqueEmail(tag = 'user') {
  return `bp-${tag}-${randomUUID().slice(0, 8)}@${config.emailDomain}`;
}

/** A password that satisfies any sane policy: 24 random chars plus every character class. */
export function strongPassword() {
  return `${randomBytes(18).toString('base64url')}aA1!`;
}

/**
 * Register a fresh user and log in. Returns { client, email, password, loginRes }.
 * Fails loudly if the app rejects the flow, because every other check depends on it.
 */
export async function freshUser(tag) {
  const client = new Client();
  const email = uniqueEmail(tag);
  const password = strongPassword();
  const reg = await client.register(email, password);
  if (reg.status !== 202 && reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register ${email} returned ${reg.status}: ${reg.text.slice(0, 200)}`);
  }
  const loginRes = await client.login(email, password);
  if (loginRes.status !== 200) {
    throw new Error(
      `login after register returned ${loginRes.status}: ${loginRes.text.slice(0, 200)}. ` +
        'The suite expects unverified accounts to be able to sign in (the blueprint default).',
    );
  }
  return { client, email, password, loginRes };
}

/** The cookies a login response set that count as session cookies for flag checks. */
export function sessionCookies(loginRes) {
  const set = loginRes.setCookies.filter((c) => !isDeletion(c));
  if (config.sessionCookieName) return set.filter((c) => c.name === config.sessionCookieName);
  return set;
}
