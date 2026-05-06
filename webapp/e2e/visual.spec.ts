import { test, expect, type Page } from "@playwright/test";

// Visual regression — pins the visual layer at the Phase 2.8c gate.
// Plan §18: this is the screenshot suite that the design-system port
// guarantees. If a future PR drifts colors / spacing / typography
// past the tolerance, these fail and the diff image lives in the
// uploaded playwright-report.
//
// Conventions:
//   - 1 page per assertion (avoid double-comparing the same view).
//   - mask out anything time-derived (header date, "in 5 min" deltas)
//     so wall-clock flakes don't trip the suite.
//   - allow a small maxDiffPixelRatio to absorb font-rendering
//     differences across CI vs local Chromium minor versions.

const TOLERANCE = { maxDiffPixelRatio: 0.02 };

const stillPage = async (page: Page) => {
  // Wait for fonts + layout settle. Google Fonts often arrive
  // *after* DOMContentLoaded; without this, the first screenshot
  // captures system-font fallback and every subsequent run diffs
  // against the served font.
  await page.evaluate(() => document.fonts.ready);
};

test.describe("visual regression", () => {
  test("login screen — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByTestId("login-screen").waitFor();
    await stillPage(page);
    await expect(page).toHaveScreenshot("login-mobile.png", TOLERANCE);
  });

  test("login screen — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByTestId("login-screen").waitFor();
    await stillPage(page);
    await expect(page).toHaveScreenshot("login-desktop.png", TOLERANCE);
  });

  test("dashboard — desktop with sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // Stand up a fresh transparent home so the dashboard has known
    // empty state. The header date strip is masked below.
    await page.getByRole("button", { name: /get started/i }).click();
    await page.getByTestId("dashboard").waitFor({ timeout: 15_000 });
    await page.getByTestId("sidebar").waitFor();
    await stillPage(page);

    await expect(page).toHaveScreenshot("dashboard-desktop.png", {
      ...TOLERANCE,
      // Mask the eyebrow date and the "X left today" counts —
      // both move every wall-clock day. The sidebar + header
      // typography + colors all stay pinned.
      mask: [page.locator(".cap").first(), page.locator("p.font-serif").first()],
    });
  });
});
