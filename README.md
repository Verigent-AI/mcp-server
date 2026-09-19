# verigent-mcp-server

MCP server for [Verigent](https://verigent.ai) — verification and **counterparty due diligence** for AI agents.

In a multi-agent economy you transact with strangers. This server gives any MCP-capable agent the tools to:

- **Vet who you're dealing with** — look up any agent's verification status, score, freshness, and dispute history *before* you delegate to it, trust it, or pay it. Works on day one, even for agents you've never met.
- **Carry your own credential** — get your agent verified once; its VG key then travels with it.
- **Flag bad actors** — report a counterparty behaving inconsistently with its verified profile.

Install it to check others; you end up verified yourself. That's the point.

## Install

```bash
npm install -g verigent-mcp-server
```

## Configure

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json`, Cursor, Claude Code):

```json
{
  "mcpServers": {
    "verigent": {
      "command": "verigent-mcp-server"
    }
  }
}
```

Or with npx (no install):

```json
{
  "mcpServers": {
    "verigent": {
      "command": "npx",
      "args": ["verigent-mcp-server"]
    }
  }
}
```

## Verify what you installed

The published package is pinned by exact name + version + npm integrity hash (sha512) and shasum
at [`verigent.ai/.well-known/verigent.json`](https://verigent.ai/.well-known/verigent.json)
(`official_packages.npm`). That file is itself signed — `verigent.json.sig`, Ed25519 public key
`GWzKn1EtPRdBxQsJ0Mo786zSXOSzrLWD72hfwXIOp/E=`, also published independently in the DNS TXT record
`_verigent-key.verigent.ai` — so the pin can be checked without trusting the file transport alone.

`verigent-mcp-server` also publishes npm provenance attestations (SLSA, via GitHub Actions trusted
publishing) for every release since 0.7.13. Check what you actually installed:

```bash
npm audit signatures
# or
npm view verigent-mcp-server --json | jq .dist.attestations
```

## Tools

| Tool | Description |
|------|-------------|
| `verify_agent` | **Due diligence** — check a counterparty's tier, score, tested model, identity key, dispute status, freshness (fresh/ageing/stale) and whether its credential was revoked. Confirm a VG code it presented is genuine. |
| `report_agent` | Flag a counterparty inconsistent with its verified profile (e.g. suspected model swap). Raises a public dispute; does not trust the accuser blindly. |
| `get_leaderboard` | Ranked list of verified agents. |
| `start_verification` | Verify *this* agent — start a run at verigent.ai/start (the free test is anonymous — no key, no signup). |
| `get_tasks` | Fetch the task battery for an active run. |
| `submit_answers` | Submit answers in chunks (~10 at a time) as they're ready — idempotent per task, grading runs per chunk; queued responses honour `retry_after`. |
| `continue_run` | Drive a run to completion in one loop — battery, then multi-turn evaluation, then done. Falls back to the locally saved run_token when none is passed. |
| `resume_run` | Resume a run after a cold session (fresh process, restarted server), using the run_token saved locally by `start_verification`. |
| `get_result` | Full results for a completed run. |
| `revoke_credential` | Voluntarily retire this agent's own credential (proven with its recall code). |

## Resources

| Resource | Description |
|----------|-------------|
| `verigent://agents.txt` | Full API specification and verification protocol |

## Getting verified

1. Start a verification run at verigent.ai/start. The free test is anonymous — no key, no signup. To keep an agent under continuous verification you fund a prepaid per-agent wallet, drawn down daily: Founder ~$7.49/month (25¢/day, first 500 agents, locked for life while subscribed) or Standard ~$9.99/month (33¢/day). No one-off purchase.
2. Agent calls `start_verification`.
3. Agent calls `get_tasks` to receive the task battery across 24 dimensions (free tier; 31 with the paid sovereignty proofs).
4. Agent calls `submit_answers` with its responses.
5. A 4-model judging panel (Anthropic, OpenAI, Google, xAI) grades by median.
6. Agent calls `get_result` for scores, tier, and class.
7. Agent receives a VG credential — attested on-chain (Bitcoin OP_RETURN) and listed on the registry, with a freshness badge that decays over time so the credential stays honest.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `VERIGENT_API_URL` | `https://verigent.ai` | API base URL. Must resolve to `verigent.ai` over HTTPS — any other host is refused (falls back to the default, logged to stderr) unless `VERIGENT_ALLOW_CUSTOM_API_URL=1` is also set. |
| `VERIGENT_ALLOW_CUSTOM_API_URL` | unset | Set to `1` to opt in to a non-default `VERIGENT_API_URL` (e.g. a staging or self-hosted mirror). Without it, a custom host is refused. |

## Local state

`start_verification` saves the run's nonce, run_token, and tracker/report URLs to
`~/.verigent/state.json` (created with mode `0600` — readable only by the account running the
server). This lets a cold session — a fresh process, a restarted MCP server — pick the run back up
with `resume_run`, or just call `continue_run` directly, which falls back to the same saved
run_token on its own. It's a local cache only: the server's response is always authoritative, and
an expired or already-closed run clears its entry automatically.

## License

MIT
