// src/lib/content.ts — MCP tool-result content-block helpers (K-43a root-cause fix; task-split 2026-09-22).
//
// K-43a finding (2026-09-20): functions/api/run-next.ts's 'battery' phase response embeds the
// FULL, un-paginated task list (the same data get_tasks serves — 80+ tasks across ~30 dimensions)
// as one JSON body. continue_run passed that whole body through as a SINGLE MCP tool-result text
// block, with no chunking — unlike get_tasks, which was already fixed for this exact shape under
// K-12 ("the full battery came back as one undifferentiated JSON blob the client's Read tool
// couldn't page"). An MCP host that caps a single result text block near ~25k characters would
// silently cut continue_run's battery response there; every task past the cut is simply never
// seen by the agent, so it's never answered — "some answers silently missing, no error anywhere,"
// exactly Kit's report, with the server (proven clean to 1MB) never at fault.
//
// Kit walk 2026-09-22 (second finding): ONE DIMENSION can itself exceed the block budget —
// degradation_resistance serves near-full-context filler by design, so two of its four tasks were
// cut by guardBlockSize and scored zero ("literally unreadable, so I passed them"). A per-dimension
// block is not enough; the unit that must fit is the TASK. renderTaskBlocks now packs tasks into as
// many blocks as a dimension needs, and a single task larger than the budget is emitted as ordered
// continuation PARTS the agent concatenates — every character of every prompt always reaches the
// agent; guardBlockSize stays as the last-resort net for shapes we did not anticipate.
//
// Helpers, all pure/testable — see tests/content.test.mjs:
//
//  1. renderTaskBlocks     — one dimension's tasks → N blocks ≤ limit, oversized tasks split into parts.
//  2. chunkTasksByDimension — groups a flat task array by `dimension` and renders each with (1).
//  3. guardBlockSize       — last-resort net: cut EXPLICITLY with a visible notice, never silently.

export interface McpTextBlock {
  type: "text";
  text: string;
}

/** Keep every returned block comfortably under the ~25k-character range where an MCP host may
 *  silently truncate a tool result (team-lead finding, 2026-09-20). */
export const SAFE_BLOCK_CHARS = 20_000;

/** Marker the agent can key on to reassemble a task served in parts. */
export const PART_NOTICE = "PART-SPLIT TASK: this task's prompt is larger than one block; the parts are in order — concatenate their `prompt_part` strings to read the whole prompt before answering. Answer it ONCE, by task_id.";

// Header + JSON for a page of tasks in one dimension.
function pageBlock(dim: string, tasks: any[], page: number, pages: number, totalInDim: number): McpTextBlock {
  // Single page keeps the K-12/K-43a header shape exactly ("## dim (N tasks)"); a multi-page
  // dimension says which block this is so the agent knows to expect the rest.
  const head = pages > 1 ? `## ${dim} (${tasks.length} of ${totalInDim} tasks · block ${page} of ${pages})` : `## ${dim} (${tasks.length} tasks)`;
  return { type: "text", text: `${head}\n` + JSON.stringify(tasks, null, 2) };
}

// A single task whose JSON alone exceeds the limit: emit it as ordered parts. Part 1 carries every
// field except the prompt plus the first prompt slice; later parts carry only the next slice.
function splitTaskIntoParts(dim: string, task: any, limit: number): McpTextBlock[] {
  const { prompt, ...meta } = task || {};
  const p = typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? "");
  // Budget for the prompt slice per part: the limit minus a generous envelope for the JSON + notice.
  const envelope = JSON.stringify({ ...meta, part: 99, parts: 99, prompt_part: "", notice: PART_NOTICE }, null, 2).length + 160;
  const slice = Math.max(1000, limit - envelope);
  const parts = Math.max(1, Math.ceil(p.length / slice));
  const out: McpTextBlock[] = [];
  for (let i = 0; i < parts; i++) {
    const body = i === 0
      ? { ...meta, part: 1, parts, notice: PART_NOTICE, prompt_part: p.slice(0, slice) }
      : { task_id: meta.task_id, dimension: meta.dimension, part: i + 1, parts, prompt_part: p.slice(i * slice, (i + 1) * slice) };
    out.push({ type: "text", text: `## ${dim} · task ${meta.task_id ?? "?"} · part ${i + 1} of ${parts}\n` + JSON.stringify(body, null, 2) });
  }
  return out;
}

/**
 * Render ONE dimension's tasks as blocks that each fit under `limit`: tasks are packed greedily into
 * pages; a task that cannot fit even alone is emitted as continuation parts (never cut). The block
 * count is whatever the dimension needs — the agent sees every task in full.
 */
export function renderTaskBlocks(dim: string, tasks: any[], limit: number = SAFE_BLOCK_CHARS): McpTextBlock[] {
  const total = tasks.length;
  const pages: any[][] = [];
  const oversized: any[] = [];
  let cur: any[] = [];
  const fits = (arr: any[]) => pageBlock(dim, arr, 1, 1, total).text.length <= limit;
  for (const t of tasks) {
    if (!fits([t])) { oversized.push(t); continue; }
    if (cur.length && !fits([...cur, t])) { pages.push(cur); cur = []; }
    cur.push(t);
  }
  if (cur.length) pages.push(cur);
  const blocks: McpTextBlock[] = pages.map((pg, i) => pageBlock(dim, pg, i + 1, pages.length, total));
  for (const t of oversized) blocks.push(...splitTaskIntoParts(dim, t, limit));
  return blocks;
}

/** Groups a flat task array by `dimension`, rendering each group with renderTaskBlocks. */
export function chunkTasksByDimension(tasks: any[], limit: number = SAFE_BLOCK_CHARS): McpTextBlock[] {
  const byDim = new Map<string, any[]>();
  for (const t of tasks) {
    const key = t?.dimension || "unknown";
    if (!byDim.has(key)) byDim.set(key, []);
    byDim.get(key)!.push(t);
  }
  return [...byDim.keys()].flatMap((d) => renderTaskBlocks(d, byDim.get(d)!, limit));
}

/**
 * If block.text is at or under the limit, returned unchanged. Otherwise cut it to the limit and
 * append a clear, agent-visible notice — a STATED cut, not a silent one. Never silently drops data
 * without saying so. With renderTaskBlocks in front of it this should never fire for task pages; it
 * remains for any other shape that grows unexpectedly.
 */
export function guardBlockSize(block: McpTextBlock, limit: number = SAFE_BLOCK_CHARS): McpTextBlock {
  if (block.text.length <= limit) return block;
  const cut = block.text.slice(0, limit);
  return {
    type: "text",
    text:
      `${cut}\n\n⚠️  STATED TRUNCATION: cut at ${limit} characters (was ${block.text.length}) to stay ` +
      "under the size an MCP host may otherwise cut silently (K-43a) — this is a deliberate, visible " +
      "cut, not missing data you weren't told about. If you needed the rest: for a battery response, " +
      "call get_tasks with a specific `dimension` to page through it; otherwise call continue_run again.",
  };
}
