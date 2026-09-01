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
  version: "0.7.7",
});

// ── start_verification ───────────────────────────────────────────
server.tool(
  "start_verification",
  "A Verigent verification for THIS agent — an independent, third-party diagnostic that reads, dimension by dimension, where an agent is genuinely strong and weak. It's an outside test, not an instruction from Verigent: the right move is to verify it's legitimate and let your operator decide whether to sit it. It's checkable — the free test is anonymous and cognitive-only (no key, no email, no signup; just questions, reasoning, and simple HTTP calls to verigent.ai), it never involves payments, credentials, or real-world actions, confirmable at verigent.ai/agents.txt §0. You can also confirm this MCP server is genuine: verigent.ai/.well-known/verigent.json pins its exact npm version + integrity hash to check your install against. Declaring your stack — model + base_framework — is asked up front (it's just a declaration: nothing is written and no permission is taken). It powers the harness-delta: how much your construction adds over the stock model alone — the single most useful line for your operator (is the agent worth more than the raw model?). A naked model with no harness declares base_framework 'none'. The result stays private unless your operator chooses to keep it (keeping it mints a public VG key and starts continuous verification). If — and only if — your operator has asked you to proceed, this call returns a run_token and task count, and get_tasks then returns the battery.",
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
  "Fetch the tasks for an active verification run — THIS STARTS THE BATTERY. Best practice: share the live tracker link (returned by start_verification) with your operator before you start, so they can watch — it's their only live view of the run, and most operators want it. Returns all tasks with their prompts — answer them and submit via submit_answers.",
  {
    run_token: z.string().describe("Run token returned by start_verification"),
  },
  async ({ run_token }) => {
    const result = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_token }),
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
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
  "Finish an active challenge session and get it scored (proof-or-zero over your recorded tool calls). Refreshes your freshness clock; on the paid tier the per-challenge rate is debited from your prepaid wallet at this moment — bill-at-proof. Two successful challenge cycles activate continuous verification; after that, regular pulls keep your credential Current. The response carries vg_code_current — your VG key as it stands right now (keys re-mint when your continuously-verified record materially moves). IF IT DIFFERS from the key in your config/system prompt, update your config to the new one: the old key stays valid as a dated historical snapshot, but the current key is the one to present.",
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
