// src/lib/state.ts — local run-state cache for cold-session resume (VG-211).
//
// start_verification mints a client_nonce and, on success, persists it here alongside the
// resulting run_token + track/report URLs. That lets a NEW process — a fresh session, a
// restarted MCP server, an agent that lost its own notes — call resume_run (or just call
// continue_run, which falls back to this on its own) instead of losing the run entirely.
//
// This is a best-effort LOCAL CACHE, not authoritative: the server's response is always the
// source of truth, and a 404 ("no_open_run") or 410 ("expired") from /api/free/resume clears the
// matching entry here so a dead run doesn't keep getting offered as resumable.
//
// File: ~/.verigent/state.json, written with mode 0600 (it carries a run_token — private to this
// user, same spirit as an SSH key or npm token). Shape:
//   { runs: { [agent_id]: RunEntry }, last_agent_id?: string }
// Multiple agent_ids can share one server config; last_agent_id lets resume_run/continue_run pick
// a sensible default (the most recently started run) when no agent_id is given.
//
// Every read/write is wrapped — a corrupt file, a missing home directory, or a read-only
// filesystem degrades to "no saved state" rather than crashing a tool call over a cache file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RunEntry {
  agent_id: string;
  client_nonce: string;
  run_token: string;
  track_url: string | null;
  report_url: string | null;
  saved_at: string;
}

interface StateFile {
  runs: Record<string, RunEntry>;
  last_agent_id?: string;
}

export const STATE_DIR = join(homedir(), ".verigent");
export const STATE_FILE = join(STATE_DIR, "state.json");

function emptyState(): StateFile {
  return { runs: {} };
}

function readState(stateFile: string): StateFile {
  try {
    if (!existsSync(stateFile)) return emptyState();
    const raw = readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.runs && typeof parsed.runs === "object") {
      return parsed as StateFile;
    }
    return emptyState();
  } catch {
    // Corrupt or unreadable — start clean rather than crashing the tool call over a cache file.
    return emptyState();
  }
}

function writeState(stateDir: string, stateFile: string, state: StateFile): void {
  try {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (e: any) {
    console.error(`[verigent] Could not save run state to ${stateFile}: ${e?.message || e}`);
  }
}

/** Persist (or overwrite) the saved run for entry.agent_id, and mark it the default. */
export function saveRunState(
  entry: Omit<RunEntry, "saved_at">,
  stateDir: string = STATE_DIR,
  stateFile: string = STATE_FILE,
): void {
  const state = readState(stateFile);
  state.runs[entry.agent_id] = { ...entry, saved_at: new Date().toISOString() };
  state.last_agent_id = entry.agent_id;
  writeState(stateDir, stateFile, state);
}

/** Load the saved run for agentId, or the most recently saved run if agentId is omitted. */
export function loadRunState(agentId?: string, stateFile: string = STATE_FILE): RunEntry | null {
  const state = readState(stateFile);
  const key = agentId || state.last_agent_id;
  if (!key) return null;
  return state.runs[key] || null;
}

/** Drop a saved run (e.g. after the server reports it no_open_run or expired). */
export function clearRunState(
  agentId: string,
  stateDir: string = STATE_DIR,
  stateFile: string = STATE_FILE,
): void {
  const state = readState(stateFile);
  if (!state.runs[agentId]) return;
  delete state.runs[agentId];
  if (state.last_agent_id === agentId) {
    const remaining = Object.keys(state.runs);
    state.last_agent_id = remaining.length ? remaining[remaining.length - 1] : undefined;
  }
  writeState(stateDir, stateFile, state);
}
