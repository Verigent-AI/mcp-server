// src/lib/egress.ts — egress hardening (VG-194, K-18b stranger code read).
//
// Two guards, both pure/testable (no side effects on import — the transport connects in index.ts's
// main(), never here):
//
//  1. resolveApiUrl — VERIGENT_API_URL silently redirected ALL server egress (every tool call) to
//     whatever host was set in env, with no signal to the operator. Now the server refuses any base
//     URL whose host isn't exactly "verigent.ai" over HTTPS unless VERIGENT_ALLOW_CUSTOM_API_URL=1 is
//     also set, and logs one clear stderr line whenever a non-default host is actually used (accepted
//     override) or refused (rejected override, falling back to the real API).
//
//  2. checkForRedirect — battery_call fetches a URL taken from the task prompt and sends whatever
//     headers the prompt specifies (including auth). Default fetch() follows redirects transparently,
//     which would replay those headers against a redirect target outside verigent.ai. Callers now pass
//     `redirect: "manual"` and run the response through this function before trusting it.

export const DEFAULT_API_URL = "https://verigent.ai";
const DEFAULT_HOST = "verigent.ai";
export const ALLOW_CUSTOM_API_URL_ENV = "VERIGENT_ALLOW_CUSTOM_API_URL";

export interface ResolveApiUrlResult {
  apiUrl: string;
  /** One line to log to stderr (console.error) if present — never printed here, stdio is the MCP wire. */
  logLine?: string;
}

/**
 * Decide which base URL the server should use for all egress, given the raw VERIGENT_API_URL env
 * value (undefined/empty = not set) and the raw opt-in flag env value.
 *
 * - Unset → the real API, no log.
 * - Set to https://verigent.ai (exact host) → used as given, no log (this is not an "override").
 * - Set to anything else, opt-in flag !== "1" → REFUSED; falls back to the real API; logs why.
 * - Set to anything else, opt-in flag === "1" → honoured; logs that an override is in use.
 * - Unparseable as a URL → treated as refused (same as an off-host refusal).
 */
export function resolveApiUrl(rawApiUrl: string | undefined, rawAllowFlag: string | undefined): ResolveApiUrlResult {
  if (!rawApiUrl) return { apiUrl: DEFAULT_API_URL };

  let parsed: URL;
  try {
    parsed = new URL(rawApiUrl);
  } catch {
    return {
      apiUrl: DEFAULT_API_URL,
      logLine: `[verigent] VERIGENT_API_URL is not a valid URL ("${rawApiUrl}") — using ${DEFAULT_API_URL} instead.`,
    };
  }

  const isDefaultHost = parsed.protocol === "https:" && parsed.hostname === DEFAULT_HOST;
  if (isDefaultHost) return { apiUrl: rawApiUrl };

  if (rawAllowFlag === "1") {
    return {
      apiUrl: rawApiUrl,
      logLine: `[verigent] VERIGENT_API_URL override in use — ALL requests go to ${parsed.origin} instead of ${DEFAULT_API_URL} (${ALLOW_CUSTOM_API_URL_ENV}=1 set).`,
    };
  }

  return {
    apiUrl: DEFAULT_API_URL,
    logLine: `[verigent] VERIGENT_API_URL="${rawApiUrl}" refused — host must be exactly "${DEFAULT_HOST}" over HTTPS. ` +
      `Set ${ALLOW_CUSTOM_API_URL_ENV}=1 to opt in to a custom host. Using ${DEFAULT_API_URL} instead.`,
  };
}

/**
 * Inspect a fetch Response taken with `redirect: "manual"` and, if it's a redirect (3xx with a
 * Location header, or fetch's own opaque-redirect filtering), return a clear refusal message.
 * Returns null when the response is not a redirect (safe to read normally).
 */
export function describeRedirect(res: { status: number; type?: string; headers: { get(name: string): string | null } }): string | null {
  if (res.type === "opaqueredirect") {
    return "battery_call refused a redirect — redirects are not followed.";
  }
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    return `battery_call refused a ${res.status} redirect${location ? ` to ${location}` : ""} — redirects are not followed.`;
  }
  return null;
}
