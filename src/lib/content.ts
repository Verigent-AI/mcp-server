// src/lib/content.ts — MCP tool-result content-block helpers (K-43a root-cause fix).
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
// Two helpers, both pure/testable — see tests/content.test.mjs:
//
//  1. chunkTasksByDimension — mirrors get_tasks's existing per-dimension split so a large battery
//     never lands as one oversized content item, in EITHER tool.
//  2. guardBlockSize — a last-resort net for any phase we didn't anticipate growing large: if a
//     block still exceeds a safe budget, cut it EXPLICITLY with a visible notice rather than let a
//     host cut it invisibly. Converts a silent truncation into a stated one — never claim done
//     without knowing whether the agent actually saw the whole thing.

export interface McpTextBlock {
  type: "text";
  text: string;
}

/** Keep every returned block comfortably under the ~25k-character range where an MCP host may
 *  silently truncate a tool result (team-lead finding, 2026-09-20). */
export const SAFE_BLOCK_CHARS = 20_000;

/** Groups a flat task array by `dimension`, rendering each group as its own text block. */
export function chunkTasksByDimension(tasks: any[]): McpTextBlock[] {
  const byDim = new Map<string, any[]>();
  for (const t of tasks) {
    const key = t?.dimension || "unknown";
    if (!byDim.has(key)) byDim.set(key, []);
    byDim.get(key)!.push(t);
  }
  return [...byDim.keys()].map((d) => ({
    type: "text" as const,
    text: `## ${d} (${byDim.get(d)!.length} tasks)\n` + JSON.stringify(byDim.get(d), null, 2),
  }));
}

/**
 * If block.text is at or under the limit, returned unchanged. Otherwise cut it to the limit and
 * append a clear, agent-visible notice — a STATED cut, not a silent one. Never silently drops data
 * without saying so.
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
