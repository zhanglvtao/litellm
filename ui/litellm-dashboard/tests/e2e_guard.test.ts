/**
 * Unit coverage for the Playwright `guardedPage` fixture classifiers.
 *
 * The fixture itself needs a running Playwright test to exercise end-to-end
 * (see `e2e_tests/tests/meta/*.spec.ts`). This file covers the two pure
 * helpers:
 *
 *   - `isForbiddenRequestUrl(url)` — pattern-matches the URL path against
 *     known-bad shapes (currently: the `/ui/ui/` double-prefix signature).
 *   - `isAllowedErrorResponse(url)` — explicit allow-list for URLs where a
 *     4xx/5xx is legitimate.
 *
 * The response-status detection (any 4xx/5xx on an XHR/fetch) is not a pure
 * function — it reads `Response.status()` — so it is covered by the
 * Playwright meta-tests, not here.
 */

import { describe, it, expect } from "vitest";
import {
  isAllowedErrorResponse,
  isForbiddenRequestUrl,
} from "../e2e_tests/fixtures/guarded-page";

const ORIGIN = "http://localhost:4000";

describe("isForbiddenRequestUrl", () => {
  describe("double-prefix /ui/ui/", () => {
    it.each([
      ["/ui/ui/project/list", "xhr payload"],
      ["/ui/ui/", "document navigation"],
      ["/ui/ui/foo.js", "script load"],
      ["/ui/ui/key/info?a=1", "query string"],
      ["/ui/ui/organization/list", "the exact path from the original bug report"],
    ])("should flag %s (%s)", (path) => {
      const r = isForbiddenRequestUrl(`${ORIGIN}${path}`);
      expect(r.forbidden).toBe(true);
      expect(r.reason).toMatch(/double-prefix/);
    });

    it("should flag /ui/ui/ even when behind a server_root_path prefix", () => {
      // Simulates a proxy deployed under server_root_path="/llmproxy". If the
      // same regression fires here, the double-prefix signature is still
      // `/ui/ui/` somewhere in the path — root-path-agnostic.
      const r = isForbiddenRequestUrl(`${ORIGIN}/llmproxy/ui/ui/key/list`);
      expect(r.forbidden).toBe(true);
    });
  });

  describe("legitimate traffic (never flagged at request time)", () => {
    it.each([
      "/",
      "/ui",
      "/ui/",
      "/ui/login",
      "/ui/virtual-keys",
      "/ui/guardrails", // API-verb-named UI route
      "/ui/usage", // API-verb-named UI route
      "/ui/prompts", // API-verb-named UI route
      "/ui/_next/static/chunks/abc.js",
      "/ui/assets/logos/openai.svg",
      "/ui/favicon.ico",
      // Legit API paths at the root — these are expected XHR destinations
      // with the correct routing.
      "/key/info",
      "/team/list",
      "/user/info",
      "/global/spend/logs",
      "/health",
      "/sso/key/generate",
      // Legit API paths under a server_root_path.
      "/llmproxy/key/info",
      "/llmproxy/ui", // dashboard root under custom root path
      "/llmproxy/ui/_next/static/chunks/abc.js",
    ])("should allow %s", (path) => {
      const r = isForbiddenRequestUrl(`${ORIGIN}${path}`);
      expect(r.forbidden).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should allow cross-origin requests", () => {
      const r = isForbiddenRequestUrl("https://api.example.com/project/list");
      expect(r.forbidden).toBe(false);
    });

    it("should not throw on a malformed URL", () => {
      const r = isForbiddenRequestUrl("not a url");
      expect(r.forbidden).toBe(false);
    });
  });
});

describe("isAllowedErrorResponse", () => {
  // The allow-list starts empty by design — each entry is a potential place
  // for real regressions to hide. These tests pin that invariant so that
  // anyone adding an entry has to update the tests alongside.
  it("rejects all URLs when the allow-list is empty", () => {
    expect(isAllowedErrorResponse(`${ORIGIN}/key/info`)).toBe(false);
    expect(isAllowedErrorResponse(`${ORIGIN}/v2/login`)).toBe(false);
    expect(isAllowedErrorResponse("https://example.com/anything")).toBe(false);
  });
});
