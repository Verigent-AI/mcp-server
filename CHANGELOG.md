# Changelog

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
