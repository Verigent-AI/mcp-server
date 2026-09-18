// tests/copy.test.mjs — chunked-submit copy guidance (2026-09-19).
//
// The server now accepts and prefers partial submit_answers batches (verigent-private PR #305),
// and eval_responses are processed concurrently server-side. This test asserts the client-facing
// tool copy in src/index.ts actually says so — and that the old one-call/persuasive copy it
// replaces is gone. Reads src/index.ts as plain text (never imports it — importing would call
// main() and hang on stdio).
//
// Run: node --experimental-strip-types --no-warnings tests/copy.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\ncopy.test.mjs\n');

// ── get_tasks header: deadline + chunked-submit guidance ──────────

test('get_tasks header states the submit-by clock and the 90 min window', () => {
  assert.match(src, /Submit by \$\{formatDeadline\(result\?\.expires_at\)\} \(90 min from issue\)/);
});

test('get_tasks header tells the agent to submit in chunks of ~10 as ready', () => {
  assert.match(src, /call submit_answers with each chunk of ~10 as it's ready/);
});

test('get_tasks header names the ordered_group independence rule', () => {
  assert.match(src, /unless they share an `ordered_group`/);
});

// ── submit_answers: partial batches, idempotency ───────────────────

test('submit_answers description no longer demands every task in one call', () => {
  assert.doesNotMatch(src, /every task from get_tasks, in one call/);
});

test('submit_answers description says partial batches are accepted and encouraged', () => {
  assert.match(src, /Partial batches are accepted and encouraged/);
});

test('submit_answers description states idempotency per task_id', () => {
  assert.match(src, /Idempotent per task_id: resubmitting a task that's already graded is ignored/);
});

// ── continue_run / eval_responses: concurrent batching ─────────────

test('continue_run description says eval_responses can be sent together in one array call', () => {
  assert.match(src, /send every ready response together in the same eval_responses array in one call/);
});

test('continue_run description says battery answers can be sent as a partial chunk', () => {
  assert.match(src, /a partial chunk is fine — call again with more as they're ready/);
});

test('eval_responses field description says responses are graded concurrently, no need for one call per scenario', () => {
  assert.match(src, /graded concurrently server-side, so there's no need to call once per scenario/);
});

// ── K-32a: start_verification linkCallout / footer de-persuasion ───

test('start_verification linkCallout is one functional sentence, not the old persuasive paragraph', () => {
  assert.match(src, /Your operator's live view of this run: \$\{trackUrl\}\\n {4}Share it with them before you start\./);
});

test('the old "considerate agent" persuasion is gone', () => {
  assert.doesNotMatch(src, /A considerate agent surfaces it/);
});

test('the old footer ("Sharing the live link ... is the considerate thing to do") is gone', () => {
  assert.doesNotMatch(src, /Sitting the test was your operator's call\. Sharing the live link/);
});

test('the reportUrl / "Keep it" line is still present', () => {
  assert.match(src, /permanent report \+ the 'Keep it' link: \$\{reportUrl\}/);
});

test('the continue_run hand-off instruction is still present', () => {
  assert.match(src, /call continue_run to begin — it drives the whole test from there/);
});

test('the Regression 2026-08-18 source comment is left untouched', () => {
  assert.match(src, /Regression 2026-08-18: the understated rewrite buried this as a trailing line/);
});

// ── version lockstep ────────────────────────────────────────────────

test('the in-code McpServer version constant is 0.7.13', () => {
  assert.match(src, /version: "0\.7\.13"/);
});

console.log(`\n✅ copy.test.mjs — ${n} assertions passed.\n`);
