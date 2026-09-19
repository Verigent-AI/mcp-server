// tests/state.test.mjs — local run-state cache (VG-211).
// Covers save/load/clear, multi-agent last_agent_id fallback, and graceful handling of a corrupt
// or missing state file. Every call passes explicit stateDir/stateFile args so this never touches
// the real ~/.verigent directory.
// Run: node --experimental-strip-types --no-warnings tests/state.test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRunState, loadRunState, clearRunState } from '../src/lib/state.ts';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\nstate.test.mjs\n');

function freshDirs() {
  const dir = mkdtempSync(join(tmpdir(), 'verigent-state-test-'));
  return { dir, file: join(dir, 'state.json') };
}

test('loadRunState on a missing file returns null', () => {
  const { file } = freshDirs();
  assert.equal(loadRunState(undefined, file), null);
  assert.equal(loadRunState('some-agent', file), null);
});

test('saveRunState then loadRunState round-trips the entry', () => {
  const { dir, file } = freshDirs();
  saveRunState({ agent_id: 'agent-a', client_nonce: 'nonce-a', run_token: 'tok-a', track_url: 'https://verigent.ai/track?t=a', report_url: 'https://verigent.ai/agent/a' }, dir, file);
  const loaded = loadRunState('agent-a', file);
  assert.ok(loaded);
  assert.equal(loaded.agent_id, 'agent-a');
  assert.equal(loaded.run_token, 'tok-a');
  assert.equal(loaded.track_url, 'https://verigent.ai/track?t=a');
  assert.ok(typeof loaded.saved_at === 'string' && !Number.isNaN(Date.parse(loaded.saved_at)));
});

test('loadRunState with no agentId falls back to the most recently saved agent', () => {
  const { dir, file } = freshDirs();
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n-a', run_token: 't-a', track_url: null, report_url: null }, dir, file);
  saveRunState({ agent_id: 'agent-b', client_nonce: 'n-b', run_token: 't-b', track_url: null, report_url: null }, dir, file);
  const loaded = loadRunState(undefined, file);
  assert.equal(loaded.agent_id, 'agent-b');
});

test('saveRunState overwrites an existing entry for the same agent_id', () => {
  const { dir, file } = freshDirs();
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n1', run_token: 't1', track_url: null, report_url: null }, dir, file);
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n2', run_token: 't2', track_url: null, report_url: null }, dir, file);
  const loaded = loadRunState('agent-a', file);
  assert.equal(loaded.run_token, 't2');
  assert.equal(loaded.client_nonce, 'n2');
});

test('clearRunState removes just that agent, leaving others intact', () => {
  const { dir, file } = freshDirs();
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n-a', run_token: 't-a', track_url: null, report_url: null }, dir, file);
  saveRunState({ agent_id: 'agent-b', client_nonce: 'n-b', run_token: 't-b', track_url: null, report_url: null }, dir, file);
  clearRunState('agent-a', dir, file);
  assert.equal(loadRunState('agent-a', file), null);
  assert.ok(loadRunState('agent-b', file));
});

test('clearRunState on the last_agent_id falls back last_agent_id to a remaining agent', () => {
  const { dir, file } = freshDirs();
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n-a', run_token: 't-a', track_url: null, report_url: null }, dir, file);
  saveRunState({ agent_id: 'agent-b', client_nonce: 'n-b', run_token: 't-b', track_url: null, report_url: null }, dir, file);
  clearRunState('agent-b', dir, file); // agent-b was last_agent_id
  const loaded = loadRunState(undefined, file);
  assert.equal(loaded.agent_id, 'agent-a');
});

test('clearRunState on an unknown agent_id is a no-op (no throw)', () => {
  const { dir, file } = freshDirs();
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n-a', run_token: 't-a', track_url: null, report_url: null }, dir, file);
  assert.doesNotThrow(() => clearRunState('nobody', dir, file));
  assert.ok(loadRunState('agent-a', file));
});

test('a corrupt state file is treated as empty, not a crash', () => {
  const { dir, file } = freshDirs();
  writeFileSync(file, '{ not json', 'utf8');
  assert.equal(loadRunState(undefined, file), null);
  // saving after a corrupt read should recover cleanly
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n-a', run_token: 't-a', track_url: null, report_url: null }, dir, file);
  assert.ok(loadRunState('agent-a', file));
});

test('the state file is written with mode 0600 (owner read/write only)', () => {
  const { dir, file } = freshDirs();
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n-a', run_token: 't-a', track_url: null, report_url: null }, dir, file);
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('saveRunState creates the state directory if it does not exist', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'verigent-state-test-')), 'nested', 'deeper');
  const file = join(dir, 'state.json');
  assert.equal(existsSync(dir), false);
  saveRunState({ agent_id: 'agent-a', client_nonce: 'n-a', run_token: 't-a', track_url: null, report_url: null }, dir, file);
  assert.ok(existsSync(file));
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(parsed.runs['agent-a']);
});

console.log(`\n✅ state.test.mjs — ${n} assertions passed.\n`);
