# Changelog

## 0.7.15

- **chore(registry):** `mcpName: ai.verigent/mcp-server` in `package.json` (npm ownership proof for the
  official MCP Registry) + `server.json` (registry manifest, npm package `verigent-mcp-server`, stdio).
  Registry namespace `ai.verigent` is DNS-verified.
- **fix(deps):** `zod` declared explicitly (was resolving transitively via the MCP SDK).
- **feat(declare):** optional `harness_version` on `start_verification` / `probe_start` (env `VERIGENT_HARNESS_VERSION`) and per-task `usage` `{input_tokens, output_tokens, context_tokens}` on `submit_answers` / `continue_run` — declared, never verified, never scored.
- **fix(tasks):** `renderTaskBlocks` pages a dimension into as many blocks as needed and serves an oversize task as ordered PARTS — no task is ever cut by the 20k-char guard (two `degradation_resistance` tasks were scoring zero).
- **copy:** retired "swap detection" wording on `model` → declared-not-verified; README lead re-centred on cross-harness comparison + a stranger-verifiable record.

## 0.7.14

- **feat(resume) VG-211:** `start_verification` now persists its client_nonce + agent_id +
  run_token + tracker/report URLs to `~/.verigent/state.json` (mode `0600`). New tool `resume_run`
  (no required args; optional `agent_id` to pick a specific saved run) calls
  `POST /api/free/resume` with the saved `{agent_id, client_nonce}` and reports the run's status —
  a 404 (`no_open_run`) or 410 (`expired`) clears the matching local entry and points the agent at
  `start_verification`; a 200 surfaces the tracker link and the next step (`continue_run` or
  `get_result`) in the same functional-lead-line style as `start_verification`. `continue_run`'s
  `run_token` is now optional: omitted, it falls back to the same saved run_token, so a cold
  session (a fresh process, a restarted MCP server) can call `continue_run` directly with no other
  setup. New `src/lib/state.ts` (the persistence, side-effect-isolated and independently tested),
  `src/lib/api.ts` (a status-aware fetch wrapper), and `src/lib/resume.ts` (pure decision logic for
  `resume_run`'s output, unit-tested against the 200/404/410 contract without hitting the network).
- **fix(copy) K-43a:** `continue_run`'s per-call `answers`/`eval_responses` payload is capped
  server-side (`MAX_CONTINUE_RUN_BYTES = 32 * 1024`, i.e. ~32 KB / 32768 bytes — matches
  `functions/api/run-next.ts`'s `MAX_BODY_BYTES` in the site repo). Both `continue_run`'s
  description and `get_tasks`'s description now state the cap — via a shared `formatByteLimit()`
  helper so "~32 KB" and "32768 bytes" always render together and in sync with the one constant. A
  call over the limit gets back a 413 naming the exact cap; `continue_run` now calls the API
  through a status-aware wrapper (`apiCall`) instead of the plain `api()` helper, so the 413 is
  surfaced with a clear lead line — preferring the server's own `limit_bytes` from the 413 body over
  the local constant when present — and the full body verbatim beneath it; the tool never retries
  the same oversized payload on its own.
- **docs:** README gains a "Verify what you installed" section (the pinned name/version/integrity
  hash/shasum at `verigent.ai/.well-known/verigent.json`, its Ed25519 signature, and the npm
  provenance attestations this package has published since 0.7.13) and a "Local state" section
  documenting `~/.verigent/state.json`. Tools table gains `continue_run` and `resume_run`.
- **fix(K-43a root cause):** found where Kit's "~25KB call came back short, some answers silently
  missing, no error anywhere" actually happens. `functions/api/run-next.ts` was load-tested to 1MB
  server-side with zero bytes dropped, so the request path was never at fault. The real cause:
  `continue_run`'s first ('battery') response embeds the FULL, un-paginated task list — the same
  data `get_tasks` serves, up to 80+ tasks across ~30 dimensions — as ONE MCP tool-result text
  block. `get_tasks` was already fixed for this exact shape under K-12 (grouped one block per
  dimension); `continue_run` never got the same treatment. An MCP host that caps a single result
  block near ~25k characters would silently cut it there — every task past the cut is never seen by
  the agent, so it's never answered, with nothing on either side able to detect the drop.
  `continue_run`'s battery-phase response is now chunked the same way `get_tasks` already is (one
  content block per dimension, via new `src/lib/content.ts`'s `chunkTasksByDimension`), and every
  block `continue_run` and `get_tasks` return is now passed through `guardBlockSize` — a 20,000-
  character safety net that, on the rare block that's still oversized, cuts it with a clear,
  agent-visible notice instead of letting a host cut it invisibly. `continue_run`'s description now
  states the per-dimension grouping. Checked `grade-batch.ts`'s response shape too: it never echoes
  the submitted answer text back, so "never echo answers back" was already true — nothing to change
  there. New `tests/content.test.mjs` (8 assertions: grouping, the "unknown"-dimension fallback,
  that all tasks across every dimension are preserved, the size-guard's pass-through/cut/notice
  behavior). `src/lib/egress.ts`, `state.ts`, `resume.ts`, `api.ts`, and `format.ts` — untouched by
  this fix — were the checked-and-cleared candidates for hypotheses (1) request-side client
  truncation (none found: no slice/substring/maxLength/truncate logic anywhere in `src/`, no zod
  length caps on tool args) and (2) SDK/transport framing caps (`@modelcontextprotocol/sdk`'s stdio
  `ReadBuffer` buffers a full line before parsing, with no size cap of its own).

## 0.7.13

- **fix(copy):** `get_tasks`, `submit_answers`, and `continue_run` now actively recommend chunked
  answer submission instead of implying (or in `submit_answers`' case, stating outright) that every
  task must be batched into one call. The server has accepted and preferred partial, idempotent-per-
  task_id batches for a while (grading runs per chunk as it lands) — the client copy just hadn't
  caught up. On every stranger walk this produced a 19-minute dead gap: the agent collected all ~81
  answers before submitting anything, so grading couldn't start until the very end.
  - `get_tasks` now prepends a plain-text header (ahead of the JSON dump) stating the submit-by
    deadline in `HH:MM UTC` and recommending chunks of ~10, answered in parallel where the harness
    allows.
  - `submit_answers`' tool description now says partial batches are accepted and encouraged, and
    states the idempotency rule (a resubmitted graded task is ignored; an ungraded one is
    overwritten) so retries and overlapping chunks are visibly safe.
  - `continue_run`'s tool description and its `eval_responses` field now say a phase's ready
    responses can be sent together in one array call — they're graded concurrently server-side, so
    there's no need for one call per scenario.
- **fix(copy) K-32a:** `start_verification`'s live-tracker callout and its trailing footer dropped
  the persuasive "a considerate agent surfaces it first" framing in favour of one functional
  sentence — the link and the instruction to share it, nothing else. Constitution §2.7 (copy
  firewall): functional framing only, no persuasion pressure. The reportUrl / "Keep it" line and the
  `continue_run` hand-off instruction are unchanged.

Found by a stranger's read of `verigent-mcp-server@0.7.12` and the 19-minute-gap walk pattern.
Server-side change landed in verigent-private PR #305 (chunked `submit_answers`, concurrent
`eval_responses` grading); this release is the client-copy half.

## 0.7.12

- **fix(egress):** `VERIGENT_API_URL` no longer silently redirects all server egress. A base URL
  whose host isn't exactly `verigent.ai` over HTTPS is now refused (falls back to the real API)
  unless the operator explicitly opts in with `VERIGENT_ALLOW_CUSTOM_API_URL=1`; either way, one
  clear line is logged to stderr (never stdout — that's the MCP JSON-RPC wire).
- **fix(battery_call):** requests no longer follow redirects. A 3xx response is now refused with a
  clear error instead of being followed — previously the caller-supplied headers (frequently an
  `Authorization` value from the battery task prompt) would have been replayed against whatever
  host the redirect pointed to. The existing anchored host check
  (`/^https:\/\/verigent\.ai\//`) is unchanged.
- No tool schema, name, or wire-format changes. No change to what the server sends to the API.

Found by a stranger's code read of `verigent-mcp-server@0.7.11` (Kit walk K-18b). Tracked as VG-194.

## 0.7.11 and earlier

Not recorded retroactively — this file starts at 0.7.12. See `git log` for prior history.
