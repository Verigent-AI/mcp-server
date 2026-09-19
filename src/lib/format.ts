// src/lib/format.ts — payload-limit formatting shared by continue_run's and get_tasks's tool
// copy and by the 413 handler (K-43a). Pure/testable, no side effects — see tests/format.test.mjs.

/**
 * Renders a byte count as "~N KB (N bytes)" so every place that quotes a payload limit — the two
 * tool descriptions and the 413 handler — shows both units consistently from a single value,
 * whether that value is the local MAX_CONTINUE_RUN_BYTES constant or the limit_bytes a 413
 * response names.
 */
export function formatByteLimit(bytes: number): string {
  const kb = bytes / 1024;
  const kbStr = Number.isInteger(kb) ? String(kb) : kb.toFixed(1);
  return `~${kbStr} KB (${bytes} bytes)`;
}

/**
 * Which byte limit to report on a 413: the server's own limit_bytes when the response body
 * carries one (authoritative — it's what the server actually enforced), else the local constant
 * (a copy kept in sync by hand, per the "must match functions/api/run-next.ts" comment).
 */
export function pickLimitBytes(resultLimitBytes: unknown, fallback: number): number {
  return typeof resultLimitBytes === "number" ? resultLimitBytes : fallback;
}
