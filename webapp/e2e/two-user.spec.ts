import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Synthetic Phase 3 → 4 stability gate, second half. Replaces "two
// non-engineer testers complete the happy path" with two
// independent BrowserContexts driving the real SPA against the same
// API at the same time. The real risk this guards against is
// silent cross-home leakage: a session token from home A pulling
// rows from home B, or one user's quick-setup overwriting another's
// state mid-flight.
//
// Each context is isolated (own localStorage, own cookies), so
// running them concurrently is the closest single-process
// approximation to two human testers on two phones.

interface UserSession {
  ctx: BrowserContext;
  page: Page;
  taskTitle: string;
  // Token cached after quick-setup so we can hit the API directly
  // without re-driving the UI for cross-home isolation checks.
  token?: string;
  homeId?: string;
}

const setupUser = async (
  ctx: BrowserContext,
  taskTitle: string,
): Promise<UserSession> => {
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByTestId("login-screen").waitFor();
  await page.getByRole("button", { name: /get started/i }).click();
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 });
  // Pull the session token+homeId out of localStorage so the test
  // can drive the API directly later for isolation checks.
  const session = await page.evaluate(() => {
    const raw = localStorage.getItem("howler.session");
    return raw ? (JSON.parse(raw) as { token: string; homeId: string }) : null;
  });
  expect(session).not.toBeNull();
  return {
    ctx,
    page,
    taskTitle,
    ...(session?.token ? { token: session.token } : {}),
    ...(session?.homeId ? { homeId: session.homeId } : {}),
  };
};

const createTaskViaUI = async (u: UserSession): Promise<void> => {
  // Create-task form lives on the All-tasks tab now and is
  // collapsed behind a CTA — expand before filling.
  await u.page.getByTestId("tab-all").click();
  await expect(
    u.page.getByTestId("dashboard"),
  ).toHaveAttribute("data-view", "all");
  await u.page.getByTestId("add-task-cta").click();
  await u.page
    .getByPlaceholder(/what do you want to remember/i)
    .fill(u.taskTitle);
  await u.page.getByRole("button", { name: /one-time/i }).click();
  await u.page.getByRole("button", { name: /^add$/i }).click();
  await expect(u.page.getByText(u.taskTitle)).toBeVisible({ timeout: 10_000 });
};

// Mobile viewport — see happy-path.spec.ts. BottomTabs is
// lg:hidden so we run these tests on a phone-sized viewport.
test.use({ viewport: { width: 390, height: 844 } });

test.describe("two concurrent users", () => {
  test("each completes quick-setup → create → see own task; no cross-home leakage", async ({
    browser,
    request,
  }) => {
    const stamp = Date.now();
    // Distinct titles so we can detect leakage by searching for the
    // *other* user's title in this user's task list.
    const titleA = `e2e-userA-${stamp}`;
    const titleB = `e2e-userB-${stamp}`;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    try {
      // 1) Both users quick-setup and reach the dashboard in
      // parallel — closest approximation to two phones on two
      // couches at the same moment.
      const [userA, userB] = await Promise.all([
        setupUser(ctxA, titleA),
        setupUser(ctxB, titleB),
      ]);

      // Different homes — quick-setup must not collapse two
      // simultaneous calls into the same home id.
      expect(userA.homeId).toBeDefined();
      expect(userB.homeId).toBeDefined();
      expect(userA.homeId).not.toBe(userB.homeId);

      // 2) Both users create a task in parallel.
      await Promise.all([createTaskViaUI(userA), createTaskViaUI(userB)]);

      // 3) Each dashboard shows its own task and *not* the other's.
      // The locators below run against each user's own page — if
      // one user could see the other's task, this assertion fails.
      await expect(userA.page.getByText(titleA)).toBeVisible();
      await expect(userA.page.getByText(titleB)).toHaveCount(0);
      await expect(userB.page.getByText(titleB)).toBeVisible();
      await expect(userB.page.getByText(titleA)).toHaveCount(0);

      // 4) API-level isolation check: each user's token should
      // only ever return tasks from their own home. Driven via
      // Playwright's `request` fixture so a forged Authorization
      // header is the *only* identity signal in flight.
      const listA = await request.get("/api/tasks", {
        headers: { Authorization: `Bearer ${userA.token!}` },
      });
      expect(listA.status()).toBe(200);
      const bodyA = (await listA.json()) as {
        tasks: Array<{ title: string; homeId: string }>;
      };
      const titlesA = bodyA.tasks.map((t) => t.title);
      expect(titlesA).toContain(titleA);
      expect(titlesA).not.toContain(titleB);
      for (const t of bodyA.tasks) expect(t.homeId).toBe(userA.homeId);

      const listB = await request.get("/api/tasks", {
        headers: { Authorization: `Bearer ${userB.token!}` },
      });
      expect(listB.status()).toBe(200);
      const bodyB = (await listB.json()) as {
        tasks: Array<{ title: string; homeId: string }>;
      };
      const titlesB = bodyB.tasks.map((t) => t.title);
      expect(titlesB).toContain(titleB);
      expect(titlesB).not.toContain(titleA);
      for (const t of bodyB.tasks) expect(t.homeId).toBe(userB.homeId);
    } finally {
      // Best-effort cleanup of the SPA contexts. Created homes
      // remain in the prod D1 — same convention as the existing
      // happy-path spec; the test fixture in CI is a long-lived
      // preview database and rows accumulate with a unique stamp
      // suffix so they're easy to grep.
      await ctxA.close();
      await ctxB.close();
    }
  });
});
