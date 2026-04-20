/**
 * Meta-test — verifies the `guardedPage` fixture actually *fails* tests when
 * the browser issues a request the fixture is designed to catch.
 *
 * Playwright fixtures tear down after the test body, so we cannot observe the
 * fixture's `expect()` failure from inside the test. Instead, we structure
 * this spec so the meta-test harness flips Playwright's `test.fail()` state:
 *
 *   - The test body intentionally triggers a condition the fixture should
 *     catch.
 *   - Because the fixture's teardown-time assertion will raise, the test is
 *     expected to fail.
 *   - We use Playwright's `test.fail()` annotation to invert that
 *     expectation — the spec passes when the body-plus-teardown combined
 *     result is a failure.
 *
 * If someone breaks the fixture (e.g. removes the expect() call, drops the
 * request/response listeners) these tests flip to "passed when they should
 * have failed" and the spec goes red. That is the signal we want.
 *
 * Covered triggers
 * ----------------
 *   1. A `/ui/ui/` XHR — the double-prefix pattern (request-time check).
 *   2. A fetch that receives an HTTP 404 — the status-based check.
 */

import { test } from "../../fixtures/guarded-page";
import * as http from "http";
import type { AddressInfo } from "net";

test.describe("guardedPage fixture — regression trigger", () => {
  // A tiny server shared across the triggers. It returns 200 for any path
  // unless the path starts with /404, in which case it returns 404. That
  // lets a single server drive both the URL-pattern trigger and the
  // status-based trigger without coupling the tests.
  let server: http.Server;
  let port: number;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url && req.url.startsWith("/404")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"not found"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  test.afterAll(() => {
    server.close();
  });

  test("fires when a /ui/ui/ XHR is made", async ({ page }) => {
    test.fail(true, "intentionally triggers the request-URL guard");
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(async (p) => {
      await fetch(`http://127.0.0.1:${p}/ui/ui/project/list`);
    }, port);
  });

  test("fires when an XHR receives a 4xx response", async ({ page }) => {
    test.fail(true, "intentionally triggers the response-status guard");
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(async (p) => {
      await fetch(`http://127.0.0.1:${p}/404/some/api`);
    }, port);
  });
});
