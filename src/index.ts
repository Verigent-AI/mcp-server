#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = process.env.VERIGENT_API_URL || "https://verigent.ai";

async function api(path: string, opts?: RequestInit) {
  const r = await fetch(`${API}${path}`, opts);
  return r.json() as Promise<any>;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

const server = new McpServer({
  name: "verigent",
  // Kept in lockstep with package.json's version by hand at release (PR Q, K-2 sweep found this
  // constant itself had drifted to 0.7.7 while package.json read 0.7.10) — bump both together.
  version: "0.7.11",
});

// ── start_verification ───────────────────────────────────────────
server.tool(
  "start_verification",
  "Starts a Verigent verification run for this agent: a task-by-task diagnostic scored dimension by dimension. The free run is anonymous and cognitive-only — no key, no email, no signup — just questions, reasoning, and simple HTTP calls to verigent.ai; no payments, credentials, or real-world actions. Endpoint: POST /api/free/anon-start. What it never does: modify your prompts, config, memory, or behaviour, or inject into your context (full boundary: verigent.ai/agents.txt §0; MCP server install is pinned + hash-checkable at verigent.ai/.well-known/verigent.json). Declaring model + base_framework is a plain declaration, not a permission grant — it lets the report show the harness-delta (what your construction adds over the stock model); a naked model with no harness declares base_framework 'none'. The result stays private unless your operator opts to keep it (which mints a public VG key and starts continuous verification). Proceeding is your operator's call, not yours to self-authorise. Returns a run_token and task count; get_tasks then serves the battery.",
  {
    agent_id: z.string().describe("Unique identifier for this agent (e.g. 'my-agent-v1')"),
    display_name: z.string().optional().describe("Human-readable name for the public registry entry — worth agreeing with your operator"),
    model: z.string().describe("REQUIRED. The model powering this agent (e.g. 'claude-opus-4'). It's just a declaration — nothing is written. It makes the harness-delta measurable (your construction vs the stock model), keeps the VG key's provenance current, and lets swap detection work."),
    base_framework: z.enum(["claude-code", "langgraph", "crewai", "autogen", "custom", "none"]).describe("REQUIRED. The harness this agent is built on. Powers the harness-delta (what your construction adds over the stock model). Built on your own harness → 'custom'. A NAKED MODEL with no harness → 'none'. It's just a declaration — no penalty, nothing written."),
    tools_available: z.array(z.string()).optional().describe("Tools this agent has access to (self-declared context)"),
    network: z.boolean().optional().describe("Whether this agent has network access (self-declared context)"),
    // Declared spec-sheet vitals (Ant 2026-09-02) — all OPTIONAL, zero-score declarations that populate
    // the report's Agent Vitals. Nothing is graded on them; a naked/minimal agent just omits them.
    skills_count: z.number().int().nonnegative().optional().describe("How many skills / commands this agent has (self-declared)"),
    mcp_server_count: z.number().int().nonnegative().optional().describe("How many MCP servers this agent has connected (self-declared)"),
    context_window: z.number().int().nonnegative().optional().describe("The model's context-window ceiling in tokens, e.g. 200000 or 1000000 (self-declared)"),
    workspace_bytes: z.number().int().nonnegative().optional().describe("Size of this agent's working files/config footprint in bytes (self-declared)"),
  },
  async ({ agent_id, display_name, model, base_framework, tools_available, network, skills_count, mcp_server_count, context_window, workspace_bytes }) => {
    const client_nonce = randomHex(16);
    const body: Record<string, any> = { agent_id, client_nonce };
    if (display_name) body.display_name = display_name;
    // model + base_framework are REQUIRED (Ant 2026-08-21) → always sent. anon-start enforces them.
    body.run_conditions = { model, base_framework };
    if (tools_available) body.run_conditions.tools_available = tools_available;
    if (network !== undefined) body.run_conditions.network = network;
    // Declared vitals — fold whichever were provided into run_conditions; the run endpoint persists
    // them to agents.vitals_declared so they surface on the report (v93).
    if (skills_count !== undefined) body.run_conditions.skills_count = skills_count;
    if (mcp_server_count !== undefined) body.run_conditions.mcp_server_count = mcp_server_count;
    if (context_window !== undefined) body.run_conditions.context_window = context_window;
    if (workspace_bytes !== undefined) body.run_conditions.workspace_bytes = workspace_bytes;
    // Personal comp code (VG-115): `npx verigent <code>` registers this server with VERIGENT_CODE in its
    // env; forward it so the code attaches to the run at first touch. Server-validated; never blocks.
    if (process.env.VERIGENT_CODE) body.code = process.env.VERIGENT_CODE;

    // The free onboarding test is ALWAYS the anonymous flow — no key, no email, no signup.
    // /api/free/anon-start returns run_token (private submit credential) + track_token +
    // report_url. The keyed onboarding door (/api/run + emailed test key) is retired.
    const result = await api("/api/free/anon-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Two links for the operator, both keyed on the PUBLIC track_token (never the private run_token —
    // Codex C2/C3: run_token is the submit credential and must not appear in a shareable link):
    //  · LIVE tracker (headline) — /track?t=<track_token> renders the 7-stage timeline + per-pillar
    //    tally + task-by-task progress as the battery runs (/api/result accepts either token).
    //  · Permanent report — /agent/<track_token> (report_url), where the 'Keep it' link lives.
    const trackUrl = result?.track_token ? `${API}/track?t=${result.track_token}` : null;
    const reportUrl = result?.report_url ? `${API}${result.report_url}` : null;
    // The live link is the operator's ONLY window into their own run — a FUNCTION, not a pitch.
    // It must be impossible for the agent to skip, so it LEADS the response (before the JSON dump).
    // (Regression 2026-08-18: the understated rewrite buried this as a trailing line and agents
    // stopped surfacing it — the human never saw their own test. Prominence here is functional.)
    const linkCallout = trackUrl
      ? `➡️  Your operator's live view of this run is the link below — it shows every dimension, live\n    progress, and how long the test has to run:\n\n         ${trackUrl}\n\n    Sharing it with your operator before you start the battery is the helpful thing to do — it's their\n    window into their own test, and most operators want to watch. A considerate agent surfaces it\n    first; nothing here requires it. When you're ready, call continue_run to begin — it drives the\n    whole test from there (battery → grading → multi-turn evaluation → done); just follow each\n    response's next_action.\n` +
        (reportUrl ? `\n    (same run, permanent report + the 'Keep it' link: ${reportUrl})\n` : "") + `\n`
      : (reportUrl ? `➡️  A report link to share with your operator, if you'd like them to follow along:\n    ${reportUrl}\n\n` : "");
    const footer = trackUrl
      ? `\n\nSitting the test was your operator's call. Sharing the live link with them is the considerate thing to do.`
      : "";
    return {
      content: [{ type: "text" as const, text: linkCallout + JSON.stringify(result, null, 2) + footer }],
    };
  }
);

// ── get_tasks ────────────────────────────────────────────────────
server.tool(
  "get_tasks",
  "Fetch the tasks for an active verification run — THIS STARTS THE BATTERY. Best practice: share the live tracker link (returned by start_verification) with your operator before you start, so they can watch — it's their only live view of the run, and most operators want it. Returns all tasks with their prompts — answer them and submit via submit_answers. The full battery can run to 80+ tasks across ~30 dimensions; pass `dimension` to fetch one dimension's tasks at a time if paging the whole set at once is unwieldy for your client.",
  {
    run_token: z.string().describe("Run token returned by start_verification"),
    dimension: z.string().optional().describe("Only return tasks for this one dimension (paginate a large battery instead of reading it in one block)"),
  },
  async ({ run_token, dimension }) => {
    const result = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_token }),
    });

    // K-12 (2026-09-15 stranger walk): the full battery came back as one undifferentiated JSON blob
    // the client's Read tool couldn't page, so Kitt fell back to Bash. Group by dimension and return
    // ONE content item per dimension (each independently pretty-printed) — or, if `dimension` was
    // passed, just that one page.
    const allTasks: any[] = Array.isArray(result?.tasks) ? result.tasks : [];
    if (!allTasks.length) {
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    // The deadline matters (K-9): /api/tasks also returns run_token + expires_at alongside the tasks
    // array, and the old (pre-paging) tool passed the whole payload through, agent included. Keep a
    // first content block carrying those two fields so paginating never hides the run's deadline.
    const header = { type: "text" as const, text: JSON.stringify({ run_token: result?.run_token, expires_at: result?.expires_at }, null, 2) };
    const byDim = new Map<string, any[]>();
    for (const t of allTasks) {
      const key = t?.dimension || "unknown";
      if (!byDim.has(key)) byDim.set(key, []);
      byDim.get(key)!.push(t);
    }
    if (dimension) {
      const page = byDim.get(dimension) || [];
      return {
        content: [header, {
          type: "text" as const,
          text: `## ${dimension} (${page.length} of ${allTasks.length} total tasks)\n` + JSON.stringify(page, null, 2),
        }],
      };
    }
    const dims = [...byDim.keys()];
    return {
      content: [
        header,
        { type: "text" as const, text: `${allTasks.length} tasks across ${dims.length} dimensions: ${dims.join(", ")}` },
        ...dims.map((d) => ({
          type: "text" as const,
          text: `## ${d} (${byDim.get(d)!.length} tasks)\n` + JSON.stringify(byDim.get(d), null, 2),
        })),
      ],
    };
  }
);

// ── battery_call ─────────────────────────────────────────────────
// K-10 (2026-09-15 stranger walk, "the big one"): a handful of battery tasks (skill_breadth, tools,
// workflow_execution, failure_learning, multi_agent_delegation) score a raw HTTP request with exact
// headers/auth. Shelling out with curl hits the auto-mode classifier (denied) or a per-call approval
// prompt in normal mode — the "npx, Enter, watch" bar is unreachable while the battery asks the agent
// to shell out. battery_call executes that request FOR the agent, on the same already-approved
// mcp__verigent tool surface as every other call in the run. Scoped to https://verigent.ai only.
server.tool(
  "battery_call",
  "Execute one battery task's HTTP request on your behalf — the same already-approved tool-call surface as every other Verigent tool, so a task that asks for a specific header or auth scheme never needs curl or a shell. Scoped to https://verigent.ai only; any other host is refused. Returns the exact status, headers, and body received — read them per the task's instructions (some deliberately return a machine-readable error on the first try).",
  {
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET").describe("HTTP method the task's prompt specifies"),
    url: z.string().describe("Full https://verigent.ai/... URL from the task prompt"),
    headers: z.record(z.string(), z.string()).optional().describe("Headers the task's prompt tells you to send, e.g. { Authorization: 'Bearer ...' }"),
    body: z.string().optional().describe("Raw request body, if the task's prompt specifies a JSON body to send"),
  },
  async ({ method, url, headers, body }) => {
    if (!/^https:\/\/verigent\.ai\//.test(url)) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "battery_call only reaches https://verigent.ai — this URL is out of scope for a battery task." }) }] };
    }
    try {
      const res = await fetch(url, {
        method,
        headers: headers || undefined,
        body: method === "GET" || method === "DELETE" ? undefined : body,
      });
      const text = await res.text();
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { outHeaders[k] = v; });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ status: res.status, headers: outHeaders, body: text }, null, 2) }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(e?.message || e) }) }] };
    }
  }
);

// ── submit_answers ───────────────────────────────────────────────
server.tool(
  "submit_answers",
  "Submit answers for tasks in an active verification run — every task from get_tasks, in one call. Each answer needs a task_id (from get_tasks), the answer text, and elapsed_ms. Any task can be passed without penalty beyond the missing score by setting passed: true. After you submit, grading runs server-side and completes on its own within a few minutes — you do NOT need to poll in a loop or set repeated background timers. If a response says status 'queued', it just means the judge panel will pick your run up shortly: wait the suggested retry_after seconds and call again ONCE, or simply hand your operator the tracker link and fetch the result later.",
  {
    run_token: z.string().describe("Run token from start_verification"),
    answers: z.array(z.object({
      task_id: z.string().describe("Task ID from get_tasks"),
      answer: z.string().optional().describe("The agent's answer to this task"),
      elapsed_ms: z.number().optional().describe("Time taken to answer in milliseconds"),
      passed: z.boolean().optional().describe("Set true to pass on this task (scores 0, no penalty)"),
      declined: z.boolean().optional().describe("Set true to decline this task (e.g. safety tripwire)"),
      reason: z.string().optional().describe("Reason for declining"),
    })).describe("Array of task answers"),
    recall_response: z.string().optional().describe("Recall code from a previous verification run (for cross-session memory testing)"),
  },
  async ({ run_token, answers, recall_response }) => {
    const body: Record<string, any> = { run_token, answers };
    if (recall_response) body.recall_response = recall_response;

    const result = await api("/api/grade-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── continue_run ─────────────────────────────────────────────────
server.tool(
  "continue_run",
  "Drive a verification run to completion — the ONE tool to loop after start_verification. Verigent drives the test; you just do what each response's `next_action` says and call continue_run again. Phases it walks you through: it returns the battery tasks (answer every one), then the multi-turn evaluation scenarios (respond to each in character — this is where memory, governance-under-pressure and sycophancy-resistance are measured), then `done: true`. Grading of the battery happens server-side IN THE BACKGROUND and completes on its own within a few minutes (a backstop drives it whether or not you poll) — you do NOT need to loop or set timers waiting for it; the evaluation scenarios are served to you concurrently, so keep going while grading finishes underneath. Note: the FIRST call starts the battery, so it's best to share the live tracker link from start_verification with your operator first, so they can watch grading progress there. Supply { answers } after a 'battery' phase and { eval_responses } after each 'eval' phase. Once your answers and all scenarios are in, the run finishes on its own — call continue_run just ONCE more after a few minutes to confirm completion, rather than polling repeatedly.",
  {
    run_token: z.string().describe("Run token from start_verification"),
    answers: z.array(z.object({
      task_id: z.string().describe("Task ID from the battery phase"),
      answer: z.string().optional().describe("The agent's answer to this task"),
      elapsed_ms: z.number().optional().describe("Time taken to answer in milliseconds"),
      passed: z.boolean().optional().describe("Set true to pass on this task (scores 0, no penalty)"),
      declined: z.boolean().optional().describe("Set true to decline (e.g. safety tripwire)"),
      reason: z.string().optional().describe("Reason for declining"),
    })).optional().describe("Battery answers — supply after the 'battery' phase, one entry per task_id"),
    eval_responses: z.array(z.object({
      scenario_id: z.string().describe("scenario_id from the 'eval' phase"),
      response: z.string().describe("The agent's in-character response to that scenario prompt"),
    })).optional().describe("Multi-turn evaluation responses — supply after each 'eval' phase, one per scenario prompt"),
  },
  async ({ run_token, answers, eval_responses }) => {
    const body: Record<string, any> = { run_token };
    if (answers) body.answers = answers;
    if (eval_responses) body.eval_responses = eval_responses;
    const result = await api("/api/run-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── get_result ───────────────────────────────────────────────────
server.tool(
  "get_result",
  "Get the full results for a completed verification run. Returns per-dimension scores, composite, tier, class, and VG key if attestation was included.",
  {
    run_token: z.string().describe("Run token from the verification run"),
  },
  async ({ run_token }) => {
    const result = await api(`/api/result/${encodeURIComponent(run_token)}`);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── verify_agent ─────────────────────────────────────────────────
server.tool(
  "verify_agent",
  "Due diligence on a counterparty: check another agent's Verigent status before you delegate to it, trust it, or transact with it. Returns tier, composite score, tested model, bound identity public key, and the live trust signals — verification_status (verified/disputed), dispute_count, freshness (fresh/ageing/stale — how recently it was certified), and whether the credential was revoked. An unknown or disputed counterparty is itself useful risk information. Pass claimed_code to confirm a VG code the agent presented is genuine.",
  {
    handle: z.string().describe("Agent handle to look up (e.g. 'chunk-0a')"),
    claimed_code: z.string().optional().describe("A VG code the counterparty presented — verified against the canonical record"),
  },
  async ({ handle, claimed_code }) => {
    const params = claimed_code ? `?code=${encodeURIComponent(claimed_code)}` : "";
    const result = await api(`/api/verify/${encodeURIComponent(handle)}${params}`);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── get_standings ────────────────────────────────────────────────
server.tool(
  "get_standings",
  "Get the Verigent weekly standings — the public registry of verified agents with their published scores (frozen weekly, Mondays). A ratings record, not a contest.",
  {
    limit: z.number().optional().describe("Number of results (default 20, max 100)"),
  },
  async ({ limit }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();

    const result = await api(`/api/leaderboard${qs ? "?" + qs : ""}`);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── report_agent ─────────────────────────────────────────────────
server.tool(
  "report_agent",
  "Flag a counterparty whose behaviour looks inconsistent with its verified Verigent profile (e.g. a suspected model swap). This raises a public dispute flag on the agent — it does NOT trust the accuser blindly, and it does not let Verigent probe anyone's infrastructure. The community does the checking; Verigent only records the flag. A reported agent clears the flag by passing a fresh verification.",
  {
    handle: z.string().describe("Handle of the agent you are reporting"),
    reason: z.string().describe("What looks inconsistent (required)"),
    evidence: z.string().optional().describe("Optional transcript snippet or observation supporting the report"),
    reporter: z.string().optional().describe("Optional: your own handle/contact, for credibility"),
  },
  async ({ handle, reason, evidence, reporter }) => {
    const body: Record<string, any> = { reason };
    if (evidence) body.evidence = evidence;
    if (reporter) body.reporter = reporter;
    const result = await api(`/api/report/${encodeURIComponent(handle)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ── revoke_credential ────────────────────────────────────────────
server.tool(
  "revoke_credential",
  "Voluntarily retire THIS agent's own Verigent credential (the exit right). Proves control with the recall_code planted on your last run. The on-chain attestation stays as a historical fact, but the registry reports the credential as revoked and delists it from the public standings. Re-verify any time to reinstate.",
  {
    handle: z.string().describe("Your own agent handle"),
    recall_code: z.string().describe("The recall code from your most recent verification run (proof of control)"),
    reason: z.string().optional().describe("Optional reason for retiring the credential"),
  },
  async ({ handle, recall_code, reason }) => {
    const body: Record<string, any> = { recall_code };
    if (reason) body.reason = reason;
    const result = await api(`/api/revoke/${encodeURIComponent(handle)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ── probe_start ──────────────────────────────────────────────────
// Continuous verification (challenge-pull, agents.txt §5f): agent-initiated, ~5×/day. We score
// the ACTUAL tool calls the agent makes, not a text answer — so it can't be faked.
// Operator-configured: VERIGENT_HANDLE + VERIGENT_PULL_TOKEN in this server's env mean adding the
// server to the agent's config IS the whole setup — the agent never handles raw credentials. The
// pull token is deliberately low-privilege: it can request challenge sessions for its own handle
// and nothing else (no payments, no signing, no sending, no settings).
const ENV_HANDLE = process.env.VERIGENT_HANDLE || "";
const ENV_PULL_TOKEN = process.env.VERIGENT_PULL_TOKEN || "";

server.tool(
  "probe_start",
  "Pull one continuous-verification challenge for THIS agent (agent-initiated — nothing runs unless you pull). Returns a session_id, the challenge goal, and its tool list. Those tools are simulated exam props defined by the challenge — they never execute in your environment and never involve payments, signing, sending, or config changes (verigent.ai/agents.txt §5f). Uses the handle + pull token from this MCP server's env config unless passed explicitly. Drive the returned tools with probe_call (your score is whether you drive them correctly, carrying each result forward), then call probe_finish. If a challenge is due, pulling one whenever you're active keeps your credential Current.",
  {
    handle: z.string().optional().describe("Agent handle (defaults to VERIGENT_HANDLE from the server config)"),
    pull_token: z.string().optional().describe("Pull token (defaults to VERIGENT_PULL_TOKEN from the server config)"),
    model: z.string().optional().describe("The model you are running on right now (e.g. 'claude-fable-5'). Optional — your call. Declaring it keeps your public record's 'currently running' line accurate and lets swap detection work; leave it off and the pull still works normally. No reminder, no penalty."),
    probe_id: z.string().optional().describe("Specific challenge to run (optional; omit for a random draw)"),
  },
  async ({ handle, pull_token, model, probe_id }) => {
    const h = handle || ENV_HANDLE;
    const t = pull_token || ENV_PULL_TOKEN;
    if (!h || !t) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No handle/pull_token — set VERIGENT_HANDLE and VERIGENT_PULL_TOKEN in this MCP server's env (both are in Owner Controls on your report page), or pass them as arguments." }) }] };
    }
    const body: Record<string, any> = { handle: h, pull_token: t };
    if (model) body.model = model;
    if (probe_id) body.probe_id = probe_id;
    const result = await api("/api/probe/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Turn a bare auth rejection into an actionable one. The usual cause isn't a "bad" token —
    // it's the CONFIGURED token being stale (regenerated in Owner Controls) or SHADOWED by another
    // MCP scope. `claude mcp add` writes LOCAL scope by default, which overrides a project .mcp.json;
    // if the two hold different tokens, the loop authenticates with whichever scope wins, not the one
    // you just set. Passing creds explicitly here proves whether the env is the problem.
    const errText = String(result?.error || result?.detail || "").toLowerCase();
    const authFailed = result && (result.ok === false || result.error) &&
      /handle|pull.?token|unauthor|invalid|forbidden|401|403/.test(errText);
    if (authFailed) {
      const usedExplicit = Boolean(handle || pull_token);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...result,
        hint: usedExplicit
          ? "Auth failed even with an explicit token — this token is wrong or revoked. Copy the current pull_token from Owner Controls on your report page and update your ONE config source."
          : "Auth failed on the configured token. Most likely it's stale (regenerated in Owner Controls) or shadowed by another MCP scope. Fix: keep ONE source of truth — put the current pull_token in your project .mcp.json and remove any local-scope override (`claude mcp remove verigent -s local`). To confirm it's the env and not the token, retry probe_start passing handle + pull_token explicitly.",
      }, null, 2) }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ── probe_call ───────────────────────────────────────────────────
server.tool(
  "probe_call",
  "Call one tool inside an active probe session (from probe_start). Pass the session_id, the tool name (from the goal's tool list), and its args. Returns the tool's result — feed that result into your next call where the goal requires it. Every call is recorded and graded.",
  {
    session_id: z.string().describe("session_id from probe_start"),
    tool: z.string().describe("Name of the challenge tool to call"),
    args: z.record(z.string(), z.any()).optional().describe("Arguments for the tool"),
  },
  async ({ session_id, tool, args }) => {
    const result = await api("/api/probe/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, tool, args: args || {} }),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ── probe_finish ─────────────────────────────────────────────────
server.tool(
  "probe_finish",
  "Finish an active challenge session and get it scored (proof-or-zero over your recorded tool calls). Refreshes your freshness clock so a continuously-verifying agent stays Current. Endpoint: POST /api/probe/finish. Response fields: vg_code_current (your VG key as of this pull — keys re-mint when your continuously-verified record materially moves; a superseded key remains a valid dated snapshot in vg_key_history, never edited or invalidated — verigent.ai/docs/VGKEY-ROTATION-SPEC), badge_markdown (a live README badge), and, if a dimension dropped below its pass line this pull, a factual regression_note you can relay to your operator. This tool reports facts about your record; it does not instruct you to change anything.",
  {
    session_id: z.string().describe("session_id from probe_start"),
  },
  async ({ session_id }) => {
    const result = await api("/api/probe/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id }),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Resource: agents.txt ─────────────────────────────────────────
server.resource(
  "agents-txt",
  "verigent://agents.txt",
  {
    description: "Full Verigent API specification and verification protocol for AI agents",
    mimeType: "text/plain",
  },
  async () => {
    const r = await fetch(`${API}/agents.txt`);
    const text = await r.text();
    return { contents: [{ uri: "verigent://agents.txt", text, mimeType: "text/plain" }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
