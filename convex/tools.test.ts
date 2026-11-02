import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { MAX_PAGE_SIZE } from "./tools";
import { day, setupWorld } from "./test.helpers";

const firstPage = { numItems: 20, cursor: null };
const publicPage = async (t: Awaited<ReturnType<typeof setupWorld>>["t"], category?: string) =>
  (await t.query(api.tools.listPublic, { category, paginationOpts: firstPage })).page;

const drill = {
  name: "Hammer",
  category: "Hand tools",
  condition: "Good",
  description: "",
};

describe("tools", () => {
  test("public listing exposes only name and category", async () => {
    const { t } = await setupWorld();
    const tools = await publicPage(t);
    expect(tools).toHaveLength(1);
    expect(Object.keys(tools[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  test("public listing is paginated newest first and caps the page size", async () => {
    const { t, alice } = await setupWorld();
    for (let i = 0; i < 4; i++) await alice.mutation(api.tools.create, { ...drill, name: `T${i}` });
    const first = await t.query(api.tools.listPublic, {
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(first.page.map((x) => x.name)).toEqual(["T3", "T2", "T1"]);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.tools.listPublic, {
      paginationOpts: { numItems: 3, cursor: first.continueCursor },
    });
    expect(second.page.map((x) => x.name)).toEqual(["T0", "Cordless drill"]);
    expect(second.isDone).toBe(true);

    const huge = await t.query(api.tools.listPublic, {
      paginationOpts: { numItems: 10_000, cursor: null },
    });
    expect(huge.page.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  test("detailed listing is paginated", async () => {
    const { alice, bob } = await setupWorld();
    for (let i = 0; i < 3; i++) await alice.mutation(api.tools.create, { ...drill, name: `T${i}` });
    const first = await bob.query(api.tools.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((x) => x.name)).toEqual(["T2", "T1"]);
    expect(first.page[0].owner).toEqual({ name: "alice", trustedLender: false });
    const rest = await bob.query(api.tools.list, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(rest.page.map((x) => x.name)).toEqual(["T0", "Cordless drill"]);
  });

  test("anonymous users cannot see the detailed listing", async () => {
    const { t } = await setupWorld();
    await expect(t.query(api.tools.list, { paginationOpts: firstPage })).rejects.toThrow(/Sign in/);
  });

  test("category filter", async () => {
    const { alice, t } = await setupWorld();
    await alice.mutation(api.tools.create, drill);
    expect(await publicPage(t, "Hand tools")).toHaveLength(1);
    expect(await publicPage(t, "Garden")).toHaveLength(0);
  });

  test("input is validated server-side", async () => {
    const { alice } = await setupWorld();
    await expect(alice.mutation(api.tools.create, { ...drill, name: "   " })).rejects.toThrow(
      /Name is required/,
    );
    await expect(
      alice.mutation(api.tools.create, { ...drill, category: "Weapons" }),
    ).rejects.toThrow(/Invalid category/);
    await expect(
      alice.mutation(api.tools.create, { ...drill, name: "x".repeat(200) }),
    ).rejects.toThrow(/at most/);
  });

  test("only the owner can edit a tool, not even an admin", async () => {
    const { bob, root, aliceDrill } = await setupWorld();
    await expect(bob.mutation(api.tools.update, { toolId: aliceDrill, ...drill })).rejects.toThrow(
      /Not your tool/,
    );
    await expect(root.mutation(api.tools.update, { toolId: aliceDrill, ...drill })).rejects.toThrow(
      /Not your tool/,
    );
  });

  test("a user cannot delete someone else's tool", async () => {
    const { bob, aliceDrill } = await setupWorld();
    await expect(bob.mutation(api.tools.remove, { toolId: aliceDrill })).rejects.toThrow(
      /Not your tool/,
    );
  });

  test("an admin can delete any tool and it is audited", async () => {
    const { t, root, aliceDrill } = await setupWorld();
    await root.mutation(api.tools.remove, { toolId: aliceDrill });
    expect(await publicPage(t)).toHaveLength(0);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toContain("tool.delete");
  });

  test("deleting a tool rejects its pending requests", async () => {
    const { t, alice, bob, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
    });
    await alice.mutation(api.tools.remove, { toolId: aliceDrill });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.status).toBe("rejected");
  });
});
