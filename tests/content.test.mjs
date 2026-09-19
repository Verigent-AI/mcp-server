// tests/content.test.mjs — MCP tool-result content-block helpers (K-43a root-cause fix).
// Run: node --experimental-strip-types --no-warnings tests/content.test.mjs

import assert from 'node:assert/strict';
import { chunkTasksByDimension, guardBlockSize, SAFE_BLOCK_CHARS } from '../src/lib/content.ts';

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

console.log(`\n✅ content.test.mjs — ${n} assertions passed.\n`);
