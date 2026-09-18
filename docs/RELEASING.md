# Releasing `verigent-mcp-server`

Publishing to npm goes through GitHub Actions using **npm trusted publishing (OIDC)** —
no `NPM_TOKEN`, no security key, no 2FA prompt. The old manual formula (security-key dance
in a browser) is retired; see `~/.claude-chunk/memory/persistent/20260817_reference_verigent_npm_publish_formula.md`
for the history of why this exists.

## One-time setup (done once, on npmjs.com)

Before the first trusted-publish run, someone with publish rights on the `verigent-mcp-server`
package must bind the workflow on npmjs.com — see the parent repo's `docs/RELEASING.md` (or ask
whoever ran this setup) for the exact click list. In short: package Settings → Trusted Publisher →
GitHub Actions → org `Verigent-AI`, repo `mcp-server`, workflow filename `publish.yml`, **and tick
"Allow direct `npm publish`"** (new trusted-publisher configs default to staged-only, which needs a
manual promote click on npmjs.com — ticking this avoids that).

## Cutting a release

1. Bump `version` in `package.json`.
2. Commit the bump (conventional: `chore(release): vX.Y.Z`).
3. Tag it and push the tag:
   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. GitHub Actions (`.github/workflows/publish.yml`) picks up the tag push, runs typecheck + build +
   test, then publishes via trusted publishing. Watch the run under the repo's Actions tab.
5. The workflow is idempotent — if `vX.Y.Z` is already live on npm (e.g. the tag push re-ran), it
   skips the publish step instead of erroring.
6. You can also trigger a release manually from the Actions tab (`workflow_dispatch`) against
   whatever `version` is currently in `package.json` on that ref — useful for a re-run without
   needing a new tag.

## After a server publish — update the pins

A new `verigent-mcp-server` version does nothing for CLI users until the parent repo's bindings are
re-pinned and the CLI itself is republished:

- `cli/index.js` — the `MCP_PKG` constant (pins the exact `verigent-mcp-server` version the CLI installs).
- `public/.well-known/verigent.json` — version / install / integrity / shasum fields.
- Run `professor/binding-check.mjs --online` in the parent repo to confirm the pins are consistent
  with what's actually live on npm before shipping the CLI release.

See the parent repo's `cli/RELEASING.md` for the CLI's own publish flow.
