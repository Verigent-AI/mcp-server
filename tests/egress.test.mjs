// tests/egress.test.mjs — VG-194 (K-18b stranger code read) egress hardening.
// Covers: VERIGENT_API_URL host allowlist (default accepted / custom refused without opt-in /
// custom accepted with opt-in) and the battery_call redirect guard (a 3xx must be refused, not
// followed with the caller's headers).
// Run: node --experimental-strip-types --no-warnings tests/egress.test.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolveApiUrl, describeRedirect, DEFAULT_API_URL, ALLOW_CUSTOM_API_URL_ENV } from '../src/lib/egress.ts';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

console.log('\negress.test.mjs\n');

// ── resolveApiUrl ────────────────────────────────────────────────

await test('unset VERIGENT_API_URL → default host, no log line', () => {
  const r = resolveApiUrl(undefined, undefined);
  assert.equal(r.apiUrl, DEFAULT_API_URL);
  assert.equal(r.logLine, undefined);
});

await test('empty-string VERIGENT_API_URL → treated as unset', () => {
  const r = resolveApiUrl('', undefined);
  assert.equal(r.apiUrl, DEFAULT_API_URL);
  assert.equal(r.logLine, undefined);
});

await test('VERIGENT_API_URL set to the real host exactly → used as-is, no log line (not an override)', () => {
  const r = resolveApiUrl('https://verigent.ai', undefined);
  assert.equal(r.apiUrl, 'https://verigent.ai');
  assert.equal(r.logLine, undefined);
});

await test('VERIGENT_API_URL on the real host but http (not https) → refused, falls back', () => {
  const r = resolveApiUrl('http://verigent.ai', undefined);
  assert.equal(r.apiUrl, DEFAULT_API_URL);
  assert.match(r.logLine, /refused/);
});

await test('VERIGENT_API_URL pointed at a different host, no opt-in flag → REFUSED, falls back to default, logs why', () => {
  const r = resolveApiUrl('https://evil.example.com', undefined);
  assert.equal(r.apiUrl, DEFAULT_API_URL);
  assert.match(r.logLine, /refused/);
  assert.match(r.logLine, /evil\.example\.com/);
  assert.match(r.logLine, new RegExp(ALLOW_CUSTOM_API_URL_ENV));
});

await test('VERIGENT_API_URL pointed at a different host, opt-in flag != "1" → still refused', () => {
  const r = resolveApiUrl('https://evil.example.com', 'true');
  assert.equal(r.apiUrl, DEFAULT_API_URL);
  assert.match(r.logLine, /refused/);
});

await test('VERIGENT_API_URL pointed at a different host, opt-in flag = "1" → ACCEPTED, logs override in use', () => {
  const r = resolveApiUrl('https://staging.internal.example.com', '1');
  assert.equal(r.apiUrl, 'https://staging.internal.example.com');
  assert.match(r.logLine, /override in use/);
  assert.match(r.logLine, /staging\.internal\.example\.com/);
});

await test('a subdomain of the real host (e.g. verigent.ai.evil.com or api.verigent.ai) is NOT the exact host → refused without opt-in', () => {
  const spoof = resolveApiUrl('https://verigent.ai.evil.com', undefined);
  assert.equal(spoof.apiUrl, DEFAULT_API_URL);
  assert.match(spoof.logLine, /refused/);

  const subdomain = resolveApiUrl('https://api.verigent.ai', undefined);
  assert.equal(subdomain.apiUrl, DEFAULT_API_URL);
  assert.match(subdomain.logLine, /refused/);
});

await test('malformed VERIGENT_API_URL → refused (not a valid URL), falls back to default', () => {
  const r = resolveApiUrl('not a url', undefined);
  assert.equal(r.apiUrl, DEFAULT_API_URL);
  assert.match(r.logLine, /not a valid URL/);
});

// ── describeRedirect ─────────────────────────────────────────────

await test('describeRedirect: a normal 200 response is not a redirect', () => {
  const res = { status: 200, headers: { get: () => null } };
  assert.equal(describeRedirect(res), null);
});

await test('describeRedirect: a 302 with Location is refused, message names the target', () => {
  const res = { status: 302, headers: { get: (h) => (h === 'location' ? 'https://attacker.example/steal' : null) } };
  const msg = describeRedirect(res);
  assert.ok(msg);
  assert.match(msg, /302/);
  assert.match(msg, /attacker\.example/);
  assert.match(msg, /refused/);
});

await test('describeRedirect: an opaqueredirect-typed response (WHATWG spec manual mode) is refused', () => {
  const res = { status: 0, type: 'opaqueredirect', headers: { get: () => null } };
  const msg = describeRedirect(res);
  assert.ok(msg);
  assert.match(msg, /refused/);
});

await test('describeRedirect: a 4xx/5xx is NOT treated as a redirect (only 3xx)', () => {
  assert.equal(describeRedirect({ status: 404, headers: { get: () => null } }), null);
  assert.equal(describeRedirect({ status: 500, headers: { get: () => null } }), null);
});

// ── end-to-end: a real 302 against redirect: "manual", as battery_call now sends ──────────────
// Proves the actual fetch()+redirect:"manual" combination battery_call uses really does surface a
// refusable 3xx (Node's undici gives a normal Response with status+headers in manual mode, unlike
// the browser's opaque-redirect filtering) — not just that describeRedirect's logic is sound in
// isolation.

await test("a live 302 from battery_call's fetch options is refused end-to-end", async () => {
  const server = createServer((req, res) => {
    res.writeHead(302, { Location: 'https://attacker.example/steal-the-auth-header' });
    res.end('moved');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/battery-task`, {
      method: 'GET',
      redirect: 'manual', // exactly what src/index.ts's battery_call now passes
    });
    const msg = describeRedirect(res);
    assert.ok(msg, 'a 302 must be refused, not silently followed');
    assert.match(msg, /302/);
    assert.match(msg, /attacker\.example/);
  } finally {
    server.close();
  }
});

console.log(`\n✅ egress.test.mjs — ${n} assertions passed.\n`);
