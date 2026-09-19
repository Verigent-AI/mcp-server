// tests/resume.test.mjs — resume_run + continue_run's cold-start fallback, and the 413 chunk-size
// surfacing (VG-211, K-43a).
//
// apiCall is exercised against a real local HTTP server (same pattern as the live-302 test in
// egress.test.mjs) standing in for verigent.ai's API — it returns exactly the 200/404/410/413
// shapes the resume/run-next contract specifies. resolveRunToken and buildResumeOutcome are pure
// and tested directly with no I/O at all.
//
// Run: node --experimental-strip-types --no-warnings tests/resume.test.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { apiCall } from '../src/lib/api.ts';
import { resolveRunToken, buildResumeOutcome } from '../src/lib/resume.ts';
import { formatByteLimit, pickLimitBytes } from '../src/lib/format.ts';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

console.log('\nresume.test.mjs\n');

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

// ── apiCall: status + body surfaced faithfully ──────────────────────

await test('apiCall surfaces a 200 JSON body with its status', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, run_token: 'tok-1', track_url: 'https://verigent.ai/track?t=x', status: 'open', next_action: 'continue_run' }));
  }, async (base) => {
    const { status, json } = await apiCall(base, '/api/free/resume', { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(json.run_token, 'tok-1');
    assert.equal(json.next_action, 'continue_run');
  });
});

await test('apiCall surfaces a 404 no_open_run body verbatim', async () => {
  await withServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_open_run' }));
  }, async (base) => {
    const { status, json } = await apiCall(base, '/api/free/resume', { method: 'POST' });
    assert.equal(status, 404);
    assert.equal(json.error, 'no_open_run');
  });
});

await test('apiCall surfaces a 410 expired body with its track_url', async () => {
  await withServer((req, res) => {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'expired', track_url: 'https://verigent.ai/track?t=y' }));
  }, async (base) => {
    const { status, json } = await apiCall(base, '/api/free/resume', { method: 'POST' });
    assert.equal(status, 410);
    assert.equal(json.error, 'expired');
    assert.equal(json.track_url, 'https://verigent.ai/track?t=y');
  });
});

await test('apiCall surfaces a 413 chunk-too-large body verbatim, unmodified', async () => {
  const body413 = { error: 'payload_too_large', limit_bytes: 32768, detail: 'split your batch and resend only the remainder' };
  await withServer((req, res) => {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body413));
  }, async (base) => {
    const { status, json } = await apiCall(base, '/api/run-next', { method: 'POST', body: '{}' });
    assert.equal(status, 413);
    assert.deepEqual(json, body413);
  });
});

await test('K-43a end-to-end: a live 413 with limit_bytes drives the exact lead line continue_run produces', async () => {
  const MAX_CONTINUE_RUN_BYTES = 32 * 1024;
  await withServer((req, res) => {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'payload_too_large', limit_bytes: 40960 }));
  }, async (base) => {
    const { status, json: result } = await apiCall(base, '/api/run-next', { method: 'POST', body: '{}' });
    assert.equal(status, 413);
    // Mirrors continue_run's own 413 branch in src/index.ts exactly.
    const limit = pickLimitBytes(result?.limit_bytes, MAX_CONTINUE_RUN_BYTES);
    const lead = `This call's payload was too large — the limit is ${formatByteLimit(limit)}. Split it into smaller chunks and resend only what didn't go through, never the same oversized payload unmodified.\n\n`;
    assert.equal(limit, 40960); // the server's limit_bytes, NOT the local constant
    assert.match(lead, /the limit is ~40 KB \(40960 bytes\)/);
  });
});

await test('K-43a: when a 413 body carries no limit_bytes, the local MAX_CONTINUE_RUN_BYTES constant is used', async () => {
  const MAX_CONTINUE_RUN_BYTES = 32 * 1024;
  await withServer((req, res) => {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'payload_too_large' })); // no limit_bytes
  }, async (base) => {
    const { status, json: result } = await apiCall(base, '/api/run-next', { method: 'POST', body: '{}' });
    const limit = pickLimitBytes(result?.limit_bytes, MAX_CONTINUE_RUN_BYTES);
    assert.equal(status, 413);
    assert.equal(limit, MAX_CONTINUE_RUN_BYTES);
    assert.equal(formatByteLimit(limit), '~32 KB (32768 bytes)');
  });
});

await test('apiCall never throws on a non-JSON body — surfaces the raw text instead of dropping it', async () => {
  await withServer((req, res) => {
    res.writeHead(413, { 'Content-Type': 'text/plain' });
    res.end('request entity too large');
  }, async (base) => {
    const { status, json } = await apiCall(base, '/api/run-next', { method: 'POST' });
    assert.equal(status, 413);
    assert.equal(json.error, 'non_json_response');
    assert.match(json.body, /request entity too large/);
  });
});

// ── resolveRunToken ──────────────────────────────────────────────────

await test('resolveRunToken prefers the explicit run_token when given', () => {
  assert.equal(resolveRunToken('explicit-token', { run_token: 'saved-token' }), 'explicit-token');
});

await test('resolveRunToken falls back to the saved entry when no explicit token is given', () => {
  assert.equal(resolveRunToken(undefined, { run_token: 'saved-token' }), 'saved-token');
});

await test('resolveRunToken returns null when nothing is available', () => {
  assert.equal(resolveRunToken(undefined, null), null);
});

// ── buildResumeOutcome ───────────────────────────────────────────────

const saved = { agent_id: 'agent-a', client_nonce: 'nonce-a', run_token: 'old-token', track_url: 'https://verigent.ai/track?t=old', report_url: null, saved_at: '2026-09-20T00:00:00.000Z' };

await test('buildResumeOutcome on 200/open: shows the tracker + tells the agent to call continue_run, does not clear', () => {
  const result = { run_token: 'old-token', track_url: 'https://verigent.ai/track?t=old', status: 'open', next_action: 'continue_run' };
  const outcome = buildResumeOutcome(200, result, saved);
  assert.equal(outcome.shouldClear, false);
  assert.match(outcome.text, /Tracker for this run: https:\/\/verigent\.ai\/track\?t=old/);
  assert.match(outcome.text, /Call continue_run/);
  assert.match(outcome.text, /"status": "open"/);
});

await test('buildResumeOutcome on 200/complete: tells the agent to call get_result instead of continue_run', () => {
  const result = { run_token: 'old-token', status: 'complete', next_action: 'get_result' };
  const outcome = buildResumeOutcome(200, result, saved);
  assert.equal(outcome.shouldClear, false);
  assert.match(outcome.text, /call get_result/);
  assert.doesNotMatch(outcome.text, /Call continue_run to keep driving/);
});

await test('buildResumeOutcome on 404: no_open_run, names the agent_id, tells it to start_verification, and clears', () => {
  const outcome = buildResumeOutcome(404, { error: 'no_open_run' }, saved);
  assert.equal(outcome.shouldClear, true);
  assert.match(outcome.text, /No open run to resume for agent_id "agent-a"/);
  assert.match(outcome.text, /start_verification/);
});

await test('buildResumeOutcome on 410: expired, surfaces the track_url, tells it to start a new run, and clears', () => {
  const outcome = buildResumeOutcome(410, { error: 'expired', track_url: 'https://verigent.ai/track?t=old' }, saved);
  assert.equal(outcome.shouldClear, true);
  assert.match(outcome.text, /resume window for this run has closed/);
  assert.match(outcome.text, /https:\/\/verigent\.ai\/track\?t=old/);
});

console.log(`\n✅ resume.test.mjs — ${n} assertions passed.\n`);
