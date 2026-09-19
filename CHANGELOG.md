# Changelog

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
