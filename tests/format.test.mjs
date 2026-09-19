// tests/format.test.mjs — payload-limit formatting (K-43a).
// Run: node --experimental-strip-types --no-warnings tests/format.test.mjs

import assert from 'node:assert/strict';
import { formatByteLimit, pickLimitBytes } from '../src/lib/format.ts';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\nformat.test.mjs\n');

// ── formatByteLimit ──────────────────────────────────────────────────

test('formatByteLimit renders the current 32 KB cap as "~32 KB (32768 bytes)"', () => {
  assert.equal(formatByteLimit(32 * 1024), '~32 KB (32768 bytes)');
});

test('formatByteLimit renders a non-round KB value with one decimal place', () => {
  assert.equal(formatByteLimit(25000), '~24.4 KB (25000 bytes)');
});

test('formatByteLimit renders a whole-number KB value with no decimal', () => {
  assert.equal(formatByteLimit(1024), '~1 KB (1024 bytes)');
});

test('formatByteLimit renders zero', () => {
  assert.equal(formatByteLimit(0), '~0 KB (0 bytes)');
});

// ── pickLimitBytes ───────────────────────────────────────────────────

test('pickLimitBytes prefers a numeric limit_bytes from the response over the fallback', () => {
  assert.equal(pickLimitBytes(40960, 32 * 1024), 40960);
});

test('pickLimitBytes falls back when limit_bytes is absent (undefined)', () => {
  assert.equal(pickLimitBytes(undefined, 32 * 1024), 32 * 1024);
});

test('pickLimitBytes falls back when limit_bytes is present but not a number (defensive)', () => {
  assert.equal(pickLimitBytes('32768', 32 * 1024), 32 * 1024);
  assert.equal(pickLimitBytes(null, 32 * 1024), 32 * 1024);
});

test('pickLimitBytes accepts zero as a valid explicit limit_bytes (not falsy-coerced to the fallback)', () => {
  assert.equal(pickLimitBytes(0, 32 * 1024), 0);
});

console.log(`\n✅ format.test.mjs — ${n} assertions passed.\n`);
