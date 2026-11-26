// Configuration for the auth verification suite. Everything comes from environment variables so the
// same suite runs against any stack. The variables are documented in BLUEPRINT.md, section Verification.

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function loadConfig() {
  const baseUrl = env('BASE_URL');
  if (!baseUrl) {
    throw new Error('BASE_URL is required, e.g. BASE_URL=http://localhost:3000');
  }
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`BASE_URL is not a valid URL: ${baseUrl}`);
  }
  const mode = env('AUTH_MODE', 'session');
  if (mode !== 'session' && mode !== 'token') {
    throw new Error(`AUTH_MODE must be "session" or "token", got "${mode}"`);
  }
  const prefix = env('AUTH_PREFIX', '/auth').replace(/\/$/, '');
  return Object.freeze({
    baseUrl: url.origin + url.pathname.replace(/\/$/, ''),
    origin: url.origin,
    https: url.protocol === 'https:',
    prefix,
    mode,
    sessionCookieName: env('SESSION_COOKIE_NAME'),
    csrfHeader: env('CSRF_HEADER', 'X-CSRF-Token'),
    protectedPath: env('PROTECTED_PATH'),
    adminEmail: env('ADMIN_EMAIL'),
    adminPassword: env('ADMIN_PASSWORD'),
    rateLimitMaxAttempts: Number.parseInt(env('RATE_LIMIT_MAX_ATTEMPTS', '10'), 10),
    emailDomain: env('TEST_EMAIL_DOMAIN', 'example.com'),
    timeoutMs: Number.parseInt(env('REQUEST_TIMEOUT_MS', '10000'), 10),
  });
}

export const config = loadConfig();

/** Path under the auth prefix, e.g. p('/login') -> '/auth/login'. */
export function p(path) {
  return `${config.prefix}${path}`;
}
