/**
 * Meta-test: proves the `guardedPage` fixture is wired correctly.
 *
 * Exercises:
 *   - The `request` listener actually fires on real HTTP navigation.
 *   - The pure classifiers (`isForbiddenRequestUrl`, `isAllowedErrorResponse`)
 *     return the expected verdicts at runtime — a sanity check independent
 *     of the vitest unit suite.
 *
 * The rich classification coverage lives in `tests/e2e_guard.test.ts`
 * (vitest). This meta-test complements it by exercising the Playwright
 * wiring itself, which the unit tests cannot.
 */

import {
  test,
  expect,
  isAllowedErrorResponse,
  isForbiddenRequestUrl,
} from "../../fixtures/guarded-page";
import * as http from "http";
import type { AddressInfo } from "net";

test.describe("guardedPage fixture — liveness", () => {
  test("should fire request listeners on real HTTP navigation", async ({ page }) => {
    // Start a tiny one-shot server on an ephemeral port.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>ok</body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const observed: string[] = [];
    page.on("request", (req) => observed.push(req.url()));

    try {
      await page.goto(`http://127.0.0.1:${port}/ok`);
      expect(observed.length).toBeGreaterThan(0);
      expect(observed.some((u) => u.includes("/ok"))).toBe(true);
    } finally {
      server.close();
    }
  });

  test("should classify URLs at runtime", async () => {
    expect(isForbiddenRequestUrl("http://localhost:4000/ui/ui/project/list").forbidden).toBe(true);
    expect(isForbiddenRequestUrl("http://localhost:4000/ui/key/info").forbidden).toBe(false);
    expect(isForbiddenRequestUrl("http://localhost:4000/ui/guardrails").forbidden).toBe(false);
    expect(isForbiddenRequestUrl("http://localhost:4000/project/list").forbidden).toBe(false);

    // Empty allow-list invariant.
    expect(isAllowedErrorResponse("http://localhost:4000/anything")).toBe(false);
  });
});
