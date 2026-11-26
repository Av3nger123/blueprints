import assert from 'node:assert/strict';

const SECRET_KEY = /password|passwd|(^|_)hash(ed)?$|(^|_)salt$|secret/i;
const HASH_VALUE = /^\$(argon2(id|i|d)|2[aby]|scrypt|pbkdf2)/;

/** Fail if a response body contains a secret-looking key, a password hash, or the given plaintext. */
export function assertNoSecrets(res, ...plaintexts) {
  for (const pt of plaintexts) {
    if (pt) assert.ok(!res.text.includes(pt), 'response body contains the plaintext password');
  }
  walk(res.json, '$');

  function walk(node, path) {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      assert.ok(!HASH_VALUE.test(node), `${path} looks like a password hash`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        assert.ok(!SECRET_KEY.test(k), `response exposes field ${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    }
  }
}

/** Assert the contract's error envelope: { error: { code, message } } with the expected status/code. */
export function assertError(res, status, code) {
  const statuses = Array.isArray(status) ? status : [status];
  assert.ok(statuses.includes(res.status), `expected HTTP ${statuses.join(' or ')}, got ${res.status}: ${res.text.slice(0, 200)}`);
  assert.ok(res.json && typeof res.json.error === 'object', `expected an { error } body, got: ${res.text.slice(0, 200)}`);
  assert.equal(typeof res.json.error.code, 'string', 'error.code must be a string');
  assert.equal(typeof res.json.error.message, 'string', 'error.message must be a string');
  if (code) assert.equal(res.json.error.code, code);
}

/**
 * Assert two responses are indistinguishable to a client: same status and same body once
 * per-request noise (request ids, timestamps) is removed.
 */
export function assertIndistinguishable(a, b, what) {
  assert.equal(a.status, b.status, `${what}: status differs (${a.status} vs ${b.status})`);
  assert.deepEqual(scrub(a.json), scrub(b.json), `${what}: response bodies differ`);
  if (a.json === null || b.json === null) assert.equal(a.text, b.text, `${what}: response bodies differ`);
}

const NOISE = /^(request_?id|trace_?id|timestamp|time|date)$/i;
function scrub(node) {
  if (Array.isArray(node)) return node.map(scrub);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).filter(([k]) => !NOISE.test(k)).map(([k, v]) => [k, scrub(v)]));
  }
  return node;
}

export function assertNoStore(res, what) {
  const cc = res.headers.get('cache-control') ?? '';
  assert.match(cc, /no-store/i, `${what}: Cache-Control must include no-store, got "${cc}"`);
}

export { assert };
