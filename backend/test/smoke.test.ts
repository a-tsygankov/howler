import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("/api/health", () => {
  it("returns ok", async () => {
    const res = await SELF.fetch("https://localhost/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
