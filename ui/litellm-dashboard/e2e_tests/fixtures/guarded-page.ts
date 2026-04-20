/**
 * Playwright fixture: `guardedPage`.
 *
 * Re-exports Playwright's `test` with the default `page` fixture wrapped in
 * two lightweight listeners:
 *
 *   1. `page.on("request", ...)` — fails the test on any request whose URL
 *      matches a known-bad path pattern. Kept deliberately narrow (just the
 *      `/ui/ui/` double-prefix signature from PR #25109). Catches the
 *      regression even in the rare case where the server returns a 200
 *      fallback for the broken path.
 *
 *   2. `page.on("response", ...)` — fails the test on any XHR/fetch response
 *      with status >= 400. This is the primary detection mechanism. It is:
 *        - **Zero-maintenance**: no list of API verbs to sync with
 *          `networking.tsx`.
 *        - **Root-path agnostic**: works identically whether the proxy is
 *          deployed at `/` or behind a `server_root_path` like `/llmproxy`
 *          — the pattern doesn't assume any URL shape.
 *        - **Broader than URL matching**: catches any misrouted XHR, not
 *          just the specific double-prefix pattern.
 *
 * Why this exists
 * ---------------
 * The Playwright specs in this suite mostly assert on visible UI text. With
 * client-rendered state, those assertions can pass even when every API call
 * is 404-ing. This fixture bridges that gap by asserting on the wire format
 * directly.
 *
 * Expected-failure traffic
 * ------------------------
 * If a test legitimately exercises a failure path (e.g. an unauthenticated
 * probe), add a narrow entry to `ALLOWED_ERROR_RESPONSES` below with a
 * comment explaining WHY the 4xx/5xx is expected. Keep the list short —
 * every entry is a potential place to hide a real regression.
 *
 * Usage
 * -----
 * Change the import in a spec from
 *
 *     import { test, expect } from "@playwright/test";
 *
 * to
 *
 *     import { test, expect } from "../../fixtures/guarded-page";
 *
 * and every existing `({ page })` callback is automatically checked. No
 * other spec-level changes are required.
 */

import { test as base, expect, Request, Response, TestInfo } from "@playwright/test";

/**
 * Narrow path patterns flagged at REQUEST time — before any response comes
 * back, and regardless of response status. These are for bugs where even a
 * 200 response would still be wrong (e.g. the server serves an HTML fallback
 * under a broken API path).
 *
 * Keep this list small and specific. The status-based guard below is the
 * primary net; these are belt-and-suspenders for regressions whose wire
 * shape is itself a red flag.
 */
const FORBIDDEN_URL_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\/ui\/ui\//,
    reason: "double-prefix (/ui/ui/) — NEXT_PUBLIC_BASE_URL regression (see PR #25109)",
  },
];

/**
 * Allow-list of `{url regex, reason}` for responses where a 4xx/5xx is the
 * expected behavior of the test. Empty by default — add entries only when a
 * specific spec legitimately drives an error response, and document why.
 */
const ALLOWED_ERROR_RESPONSES: Array<{ re: RegExp; reason: string }> = [
  // Example of a future entry:
  // { re: /\/v3\/login\/exchange/, reason: "login.spec tests invalid-code path" },
];

/**
 * Resource types subject to the response-status check. We deliberately scope
 * to xhr/fetch so that, e.g., a missing favicon does not fail the suite —
 * the goal is to catch broken *API* calls, which is the class of bug this
 * fixture exists for.
 */
const DATA_RESOURCE_TYPES: ReadonlySet<string> = new Set(["xhr", "fetch"]);

/** Classify a URL against the forbidden-pattern list (request-time check). */
export function isForbiddenRequestUrl(urlString: string): {
  forbidden: boolean;
  reason?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { forbidden: false };
  }
  for (const { re, reason } of FORBIDDEN_URL_PATTERNS) {
    if (re.test(parsed.pathname)) {
      return { forbidden: true, reason };
    }
  }
  return { forbidden: false };
}

/** Classify an error response URL against the allow-list. */
export function isAllowedErrorResponse(urlString: string): boolean {
  return ALLOWED_ERROR_RESPONSES.some(({ re }) => re.test(urlString));
}

type Violation = { url: string; method: string; reason: string };

function dedupe(violations: Violation[]): Violation[] {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const v of violations) {
    const key = `${v.method} ${v.url} :: ${v.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export const test = base.extend<{}>({
  page: async ({ page }, use, testInfo: TestInfo) => {
    const violations: Violation[] = [];

    const onRequest = (req: Request) => {
      const check = isForbiddenRequestUrl(req.url());
      if (check.forbidden) {
        violations.push({
          url: req.url(),
          method: req.method(),
          reason: check.reason ?? "forbidden URL pattern",
        });
      }
    };

    const onResponse = (resp: Response) => {
      const req = resp.request();
      if (!DATA_RESOURCE_TYPES.has(req.resourceType())) return;
      const status = resp.status();
      if (status < 400) return;
      if (isAllowedErrorResponse(resp.url())) return;
      violations.push({
        url: resp.url(),
        method: req.method(),
        reason: `HTTP ${status} on ${req.resourceType()} — UI routing or endpoint is broken`,
      });
    };

    page.on("request", onRequest);
    page.on("response", onResponse);

    try {
      await use(page);
    } finally {
      page.off("request", onRequest);
      page.off("response", onResponse);
    }

    if (violations.length === 0) return;

    const deduped = dedupe(violations);
    const report = deduped
      .map((v) => `  ${v.method} ${v.url}\n    → ${v.reason}`)
      .join("\n");
    await testInfo.attach("guarded-page-violations.txt", {
      body: report,
      contentType: "text/plain",
    });
    // eslint-disable-next-line playwright/no-standalone-expect
    expect(
      deduped,
      `guardedPage fixture recorded ${deduped.length} violation(s). This usually means the UI ` +
        `bundle has a routing regression (see PR #25109 for the double-prefix incident) or an ` +
        `API endpoint is 404-ing. If an error response is legitimate for this test, allow-list ` +
        `the URL in ALLOWED_ERROR_RESPONSES in fixtures/guarded-page.ts.\n\n` +
        report,
    ).toEqual([]);
  },
});

export { expect };
