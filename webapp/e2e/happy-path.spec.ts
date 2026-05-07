import { test, expect } from "@playwright/test";

// Behaviour-pinned E2E (plan §18 Phase 3 → 4 stability gate). The
// selectors avoid CSS / specific text where possible — the visual
// layer gets a full rewrite in Phase 2.8 and these tests should
// survive that rewrite. data-testid is the contract.

// Mobile viewport — BottomTabs is `lg:hidden`, so the chromium
// project's default desktop viewport hides them. The Sidebar
// (lg+) carries the same nav, but using a fixed mobile viewport
// here keeps the test surface small and matches the primary
// target (the SPA is mobile-first per the design handoff).
test.use({ viewport: { width: 390, height: 844 } });

test.describe("happy path", () => {
  test("API health via Pages proxy", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("login screen renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("login-screen")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("quick-setup → dashboard → create task → see task", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("login-screen").waitFor();

    await page.getByRole("button", { name: /get started/i }).click();
    await expect(page.getByTestId("dashboard")).toBeVisible({
      timeout: 15_000,
    });

    // The create-task form lives on the All-tasks tab now (post-
    // BottomTabs split) and is collapsed behind a "+ Add task"
    // CTA. Tap the tab, then expand the form before filling it.
    await page.getByTestId("tab-all").click();
    await expect(
      page.getByTestId("dashboard"),
    ).toHaveAttribute("data-view", "all");
    await page.getByTestId("add-task-cta").click();

    const title = `e2e-${Date.now()}`;
    await page.getByPlaceholder(/what do you want to remember/i).fill(title);
    await page.getByRole("button", { name: /one-time/i }).click();
    await page.getByRole("button", { name: /^add$/i }).click();

    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  });
});
