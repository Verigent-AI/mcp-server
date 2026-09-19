// src/lib/api.ts — small fetch wrapper shared by tools that need to branch on HTTP status (VG-211).
//
// Kept import-safe (no side effects) so it's independently unit-testable, like egress.ts, without
// needing to import src/index.ts (which would call main() and hang on stdio — see
// tests/copy.test.mjs). Most tools don't need this — they just want the JSON body and can keep
// using index.ts's existing `api()` helper unchanged. This one is for continue_run and resume_run,
// which both need to see the raw status code (a 413 from continue_run naming its payload limit; a
// 404/410 from resume_run) rather than just the parsed body.

export interface ApiResult<T = any> {
  status: number;
  json: T;
}

/**
 * fetch() against `${baseUrl}${path}`, returning both the HTTP status and the parsed JSON body.
 * Never throws on a non-2xx status — callers branch on `status` themselves. If the body isn't
 * valid JSON (e.g. a proxy-level error page ahead of the API), `json` becomes
 * `{ error: "non_json_response", status, body: <raw text> }` so the raw response is surfaced
 * verbatim instead of silently dropped or truncated.
 */
export async function apiCall<T = any>(baseUrl: string, path: string, opts?: RequestInit): Promise<ApiResult<T>> {
  const r = await fetch(`${baseUrl}${path}`, opts);
  const text = await r.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: "non_json_response", status: r.status, body: text };
  }
  return { status: r.status, json };
}
