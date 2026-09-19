// src/lib/resume.ts — pure decision logic for resume_run and continue_run's cold-start fallback
// (VG-211). Kept separate from src/index.ts (and free of any fetch/fs calls) so it's directly
// unit-testable — see tests/resume.test.mjs — without importing src/index.ts, which would call
// main() and hang on stdio.

import type { RunEntry } from "./state.js";

/** Pick which run_token continue_run should use: the caller's, or the persisted fallback. */
export function resolveRunToken(explicit: string | undefined, saved: RunEntry | null): string | null {
  if (explicit) return explicit;
  return saved?.run_token || null;
}

export interface ResumeOutcome {
  /** Tool response text — a short lead line (if any) followed by the raw JSON body. */
  text: string;
  /** True if the saved local state for this agent_id should now be cleared. */
  shouldClear: boolean;
}

/**
 * Turn the /api/free/resume response (status + parsed JSON body) into the resume_run tool's
 * output, given the locally saved entry the request was built from. Mirrors start_verification's
 * style: a short functional lead line ahead of the JSON dump, never persuasive copy (Constitution
 * §2.7).
 */
export function buildResumeOutcome(status: number, result: any, saved: RunEntry): ResumeOutcome {
  const dump = JSON.stringify(result, null, 2);

  if (status === 404) {
    return {
      shouldClear: true,
      text: `No open run to resume for agent_id "${saved.agent_id}" — call start_verification to begin a new run.\n\n${dump}`,
    };
  }

  if (status === 410) {
    const trackLine = result?.track_url ? `Its tracker (for reference): ${result.track_url}\n\n` : "";
    return {
      shouldClear: true,
      text: `The resume window for this run has closed. ${trackLine}Call start_verification to begin a new run.\n\n${dump}`,
    };
  }

  const trackLine = result?.track_url ? `➡️  Tracker for this run: ${result.track_url}\n\n` : "";
  const nextLine = result?.next_action === "get_result"
    ? "    This run is complete — call get_result to fetch the finished scores.\n\n"
    : "    Call continue_run to keep driving the run (it also picks up this same run_token on its own).\n\n";
  return {
    shouldClear: false,
    text: `${trackLine}${nextLine}${dump}`,
  };
}
