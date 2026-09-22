// tests/content.test.mjs — MCP tool-result content-block helpers (K-43a root-cause fix).
// Run: node --experimental-strip-types --no-warnings tests/content.test.mjs

import assert from 'node:assert/strict';
import { chunkTasksByDimension, guardBlockSize, SAFE_BLOCK_CHARS, renderTaskBlocks } from '../src/lib/content.ts';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\ncontent.test.mjs\n');

// ── chunkTasksByDimension ────────────────────────────────────────────

test('groups tasks by dimension into one block per dimension', () => {
  const tasks = [
    { task_id: 'a1', dimension: 'coding', prompt: 'x' },
    { task_id: 'a2', dimension: 'coding', prompt: 'y' },
    { task_id: 'b1', dimension: 'reasoning', prompt: 'z' },
  ];
  const blocks = chunkTasksByDimension(tasks);
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((b) => b.type === 'text'));
  const coding = blocks.find((b) => b.text.startsWith('## coding'));
  assert.ok(coding);
  assert.match(coding.text, /## coding \(2 tasks\)/);
  const parsed = JSON.parse(coding.text.slice(coding.text.indexOf('\n') + 1));
  assert.deepEqual(parsed.map((t) => t.task_id), ['a1', 'a2']);
});

test('a task with no dimension field falls back to an "unknown" group instead of being dropped', () => {
  const blocks = chunkTasksByDimension([{ task_id: 'x1' }]);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].text, /## unknown \(1 tasks\)/);
});

test('preserves every task across all dimensions — none silently dropped', () => {
  const tasks = Array.from({ length: 87 }, (_, i) => ({ task_id: `t${i}`, dimension: `dim${i % 29}` }));
  const blocks = chunkTasksByDimension(tasks);
  const totalInBlocks = blocks.reduce((sum, b) => {
    const json = b.text.slice(b.text.indexOf('\n') + 1);
    return sum + JSON.parse(json).length;
  }, 0);
  assert.equal(totalInBlocks, 87);
  assert.equal(blocks.length, 29);
});

test('empty task array produces no blocks (nothing to chunk)', () => {
  assert.deepEqual(chunkTasksByDimension([]), []);
});

// ── guardBlockSize ───────────────────────────────────────────────────

test('a block under the limit is returned unchanged', () => {
  const block = { type: 'text', text: 'short and fine' };
  assert.deepEqual(guardBlockSize(block, 1000), block);
});

test('a block exactly at the limit is returned unchanged', () => {
  const text = 'x'.repeat(100);
  const block = { type: 'text', text };
  assert.deepEqual(guardBlockSize(block, 100), block);
});

test('a block over the limit is cut and a visible truncation notice is appended', () => {
  const text = 'x'.repeat(150);
  const block = { type: 'text', text };
  const out = guardBlockSize(block, 100);
  assert.notEqual(out.text, block.text);
  assert.ok(out.text.startsWith('x'.repeat(100)));
  assert.match(out.text, /STATED TRUNCATION/);
  assert.match(out.text, /cut at 100 characters \(was 150\)/);
});

test('the default limit is SAFE_BLOCK_CHARS (20,000)', () => {
  assert.equal(SAFE_BLOCK_CHARS, 20_000);
  const block = { type: 'text', text: 'y'.repeat(SAFE_BLOCK_CHARS + 1) };
  const out = guardBlockSize(block);
  assert.match(out.text, /cut at 20000 characters/);
});

// ── renderTaskBlocks (Kit walk 2026-09-22: no task is ever cut) ──────────────────

test('a dimension larger than the limit is paged into several blocks, every task present once', () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({ task_id: `d${i}`, dimension: 'degradation_resistance', prompt: 'p'.repeat(900) }));
  const blocks = renderTaskBlocks('degradation_resistance', tasks, 2500);
  assert.ok(blocks.length > 1, 'more than one block');
  assert.ok(blocks.every((b) => b.text.length <= 2500), 'every block within the limit');
  const ids = blocks.flatMap((b) => JSON.parse(b.text.slice(b.text.indexOf('\n') + 1)).map((t) => t.task_id));
  assert.deepEqual(ids, tasks.map((t) => t.task_id));
  assert.match(blocks[0].text, /block 1 of \d+/);
});

test('a single task larger than the limit is served as ordered PARTS that concatenate back to the full prompt', () => {
  const prompt = Array.from({ length: 5000 }, (_, i) => String(i % 10)).join('');
  const blocks = renderTaskBlocks('degradation_resistance', [{ task_id: 'big', dimension: 'degradation_resistance', prompt }], 2500);
  assert.ok(blocks.length >= 2, 'split into parts');
  assert.ok(blocks.every((b) => b.text.length <= 2500), 'each part within the limit');
  const parts = blocks.map((b) => JSON.parse(b.text.slice(b.text.indexOf('\n') + 1)));
  assert.equal(parts[0].part, 1);
  assert.equal(parts[0].parts, blocks.length);
  assert.match(parts[0].notice, /PART-SPLIT TASK/);
  assert.equal(parts.map((p) => p.prompt_part).join(''), prompt, 'parts concatenate to the original prompt exactly');
  assert.ok(parts.every((p) => p.task_id === 'big'), 'every part carries the task_id');
});

test('chunkTasksByDimension never emits a block guardBlockSize would cut', () => {
  const tasks = [
    ...Array.from({ length: 4 }, (_, i) => ({ task_id: `x${i}`, dimension: 'degradation_resistance', prompt: 'z'.repeat(9000) })),
    { task_id: 'y0', dimension: 'tools', prompt: 'small' },
  ];
  const blocks = chunkTasksByDimension(tasks, SAFE_BLOCK_CHARS);
  assert.ok(blocks.every((b) => guardBlockSize(b).text === b.text), 'guard is a no-op on every block');
});

console.log(`\n✅ content.test.mjs — ${n} assertions passed.\n`);
