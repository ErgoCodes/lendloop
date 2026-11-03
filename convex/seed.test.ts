import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { FunctionReturnType } from "convex/server";
import { api, internal } from "./_generated/api";
import { setupWorld } from "./test.helpers";

const page = (numItems: number, cursor: string | null = null) => ({ numItems, cursor });

beforeEach(() => {
  process.env.SEED_ENABLED = "true";
});
afterEach(() => {
  delete process.env.SEED_ENABLED;
});

describe("seed", () => {
  test("refuses to run unless SEED_ENABLED is set", async () => {
    const { t } = await setupWorld();
    delete process.env.SEED_ENABLED;
    await expect(t.action(internal.seed.run, { users: 1 })).rejects.toThrow(/disabled/);
  });

  test("creates paginable users, tools and loans, and clears them", async () => {
    const { t, root, bob } = await setupWorld();
    const res = await t.action(internal.seed.run, {
      users: 120,
      toolsPerUser: 3,
      email: "bob@example.com",
      history: 30,
    });
    expect(res.users).toBe(120);
    expect(res.tools).toBeGreaterThan(100);
    expect(res.loans).toBeGreaterThan(60);

    // Pages through the whole public board.
    let cursor: string | null = null;
    let seen = 0;
    for (;;) {
      const r: FunctionReturnType<typeof api.tools.listPublic> = await t.query(
        api.tools.listPublic,
        { paginationOpts: page(50, cursor) },
      );
      seen += r.page.length;
      if (r.isDone) break;
      cursor = r.continueCursor;
    }
    expect(seen).toBe(res.tools + 1); // + alice's drill from setupWorld

    // Bob gets history on both sides, active loans and a pending badge.
    const history = await bob.query(api.loans.myRequestsHistory, { paginationOpts: page(20) });
    expect(history.page).toHaveLength(20);
    expect(history.isDone).toBe(false);
    const active = await bob.query(api.loans.myRequests, {});
    expect(active.some((l) => l.isOverdue)).toBe(true);
    const feed = await bob.query(api.loans.notifications, {});
    expect(feed.pendingIncoming).toBe(4);

    const users = await root.query(api.users.list, { paginationOpts: page(50) });
    expect(users.isDone).toBe(false);

    // A second run adds new users instead of colliding with the first.
    await t.action(internal.seed.run, { users: 5, toolsPerUser: 0 });

    const cleared = await t.action(internal.seed.clear, {});
    expect(cleared.users).toBe(125);
    expect(cleared.markedTools).toBe(4);
    const left = await t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).length,
      tools: (await ctx.db.query("tools").collect()).length,
      loans: (await ctx.db.query("loans").collect()).length,
    }));
    expect(left).toEqual({ users: 4, tools: 1, loans: 0 });
  });

  test("seeding loans needs an existing user", async () => {
    const { t } = await setupWorld();
    await expect(
      t.action(internal.seed.run, { users: 2, email: "nobody@example.com" }),
    ).rejects.toThrow(/Sign in to the app once/);
  });
});
