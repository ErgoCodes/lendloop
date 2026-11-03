import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/constants";
import { day, setupWorld } from "./test.helpers";

const page = { numItems: 20, cursor: null };

describe("loan requests", () => {
  test("happy path: request → approve → return", async () => {
    const { alice, bob, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(0),
      endDate: day(3),
      message: "For a shelf",
    });
    expect((await alice.query(api.loans.incoming, {}))[0]).toMatchObject({
      status: "requested",
      borrower: { name: "bob" },
    });

    await alice.mutation(api.loans.approve, { loanId });
    expect((await bob.query(api.loans.myRequests, {}))[0].status).toBe("approved");
    const { page: tools } = await bob.query(api.tools.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(tools[0].availability).toEqual({ state: "on_loan", until: day(3) });

    await alice.mutation(api.loans.markReturned, { loanId });
    // Finished loans move from the active list to the paginated history.
    expect(await bob.query(api.loans.myRequests, {})).toHaveLength(0);
    const history = await bob.query(api.loans.myRequestsHistory, { paginationOpts: page });
    expect(history.page[0]).toMatchObject({
      _id: loanId,
      status: "returned",
      owner: { name: "alice" },
    });
    const ownerHistory = await alice.query(api.loans.incomingHistory, { paginationOpts: page });
    expect(ownerHistory.page[0]).toMatchObject({ _id: loanId, borrower: { name: "bob" } });
  });

  test("cannot borrow your own tool", async () => {
    const { alice, aliceDrill } = await setupWorld();
    await expect(
      alice.mutation(api.loans.request, { toolId: aliceDrill, startDate: day(1), endDate: day(2) }),
    ).rejects.toThrow(/your own tool/);
  });

  test("date validation", async () => {
    const { bob, aliceDrill } = await setupWorld();
    const req = (startDate: string, endDate: string) =>
      bob.mutation(api.loans.request, { toolId: aliceDrill, startDate, endDate });
    await expect(req(day(-1), day(2))).rejects.toThrow(/past/);
    await expect(req(day(3), day(2))).rejects.toThrow(/on or after/);
    await expect(req(day(0), day(40))).rejects.toThrow(/at most 30 days/);
    await expect(req("2026-02-30", day(2))).rejects.toThrow(/YYYY-MM-DD/);
  });

  test("overlapping requests are blocked once a loan is approved", async () => {
    const { alice, bob, carol, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(5),
    });
    await alice.mutation(api.loans.approve, { loanId });
    await expect(
      carol.mutation(api.loans.request, { toolId: aliceDrill, startDate: day(4), endDate: day(6) }),
    ).rejects.toThrow(/already booked/);
    // Non-overlapping dates are fine.
    await carol.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(6),
      endDate: day(7),
    });
  });

  test("approving auto-rejects competing requests for the same dates", async () => {
    const { t, alice, bob, carol, aliceDrill } = await setupWorld();
    const bobLoan = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(3),
    });
    const carolLoan = await carol.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(2),
      endDate: day(4),
    });
    await alice.mutation(api.loans.approve, { loanId: bobLoan });
    expect((await t.run((ctx) => ctx.db.get(carolLoan)))?.status).toBe("rejected");
    await expect(alice.mutation(api.loans.approve, { loanId: carolLoan })).rejects.toThrow(
      /already decided/,
    );
  });

  test("only the tool owner can approve, reject or mark returned", async () => {
    const { bob, carol, root, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(0),
      endDate: day(1),
    });
    for (const actor of [bob, carol, root]) {
      await expect(actor.mutation(api.loans.approve, { loanId })).rejects.toThrow(/owner/);
      await expect(actor.mutation(api.loans.reject, { loanId })).rejects.toThrow(/owner/);
    }
  });

  test("an admin can mark a loan returned (audited)", async () => {
    const { t, alice, bob, root, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(0),
      endDate: day(1),
    });
    await alice.mutation(api.loans.approve, { loanId });
    await root.mutation(api.loans.markReturned, { loanId });
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toContain("loan.markReturned");
  });

  test("only the borrower can cancel, and only while pending", async () => {
    const { alice, bob, carol, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
    });
    await expect(carol.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/Not your/);
    await alice.mutation(api.loans.approve, { loanId });
    await expect(bob.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/pending/);
  });

  test("users only see their own loans; admins see all", async () => {
    const { alice, bob, carol, root, aliceDrill } = await setupWorld();
    await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
    });
    expect(await carol.query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await carol.query(api.loans.incoming, {})).toHaveLength(0);
    expect(await alice.query(api.loans.incoming, {})).toHaveLength(1);
    await expect(alice.query(api.loans.all, { paginationOpts: page })).rejects.toThrow(
      /Admins only/,
    );
    expect((await root.query(api.loans.all, { paginationOpts: page })).page).toHaveLength(1);
    expect(
      (await carol.query(api.loans.myRequestsHistory, { paginationOpts: page })).page,
    ).toHaveLength(0);
  });

  test("overdue loans are flagged", async () => {
    const { t, bob, ids, aliceDrill } = await setupWorld();
    await t.run((ctx) =>
      ctx.db.insert("loans", {
        toolId: aliceDrill,
        ownerId: ids.alice,
        borrowerId: ids.bob,
        startDate: day(-5),
        endDate: day(-1),
        status: "approved",
      }),
    );
    expect((await bob.query(api.loans.myRequests, {}))[0].isOverdue).toBe(true);
  });

  test("notifications: a live feed for both sides of a loan", async () => {
    const { alice, bob, carol, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
    });

    const owner = await alice.query(api.loans.notifications, {});
    expect(owner.pendingIncoming).toBe(1);
    expect(owner.incoming).toEqual([
      { _id: loanId, status: "requested", toolName: "Cordless drill", otherParty: "bob" },
    ]);
    expect(owner.mine).toEqual([]);

    await alice.mutation(api.loans.approve, { loanId });
    expect((await alice.query(api.loans.notifications, {})).pendingIncoming).toBe(0);
    expect((await bob.query(api.loans.notifications, {})).mine).toEqual([
      { _id: loanId, status: "approved", toolName: "Cordless drill", otherParty: "alice" },
    ]);

    // Unrelated users see nothing.
    expect(await carol.query(api.loans.notifications, {})).toEqual({
      pendingIncoming: 0,
      incoming: [],
      mine: [],
    });
  });

  test("history is paginated and excludes active loans", async () => {
    const { alice, bob, aliceDrill } = await setupWorld();
    const ask = () =>
      bob.mutation(api.loans.request, { toolId: aliceDrill, startDate: day(1), endDate: day(2) });
    const cancelled = [];
    for (let i = 0; i < 3; i++) {
      const loanId = await ask();
      await bob.mutation(api.loans.cancel, { loanId });
      cancelled.push(loanId);
    }
    const pending = await ask();

    expect((await bob.query(api.loans.myRequests, {})).map((l) => l._id)).toEqual([pending]);
    expect((await alice.query(api.loans.incoming, {})).map((l) => l._id)).toEqual([pending]);

    const first = await bob.query(api.loans.myRequestsHistory, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    const rest = await bob.query(api.loans.myRequestsHistory, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect([...first.page, ...rest.page].map((l) => l._id)).toEqual(cancelled.reverse());
    expect(rest.isDone).toBe(true);
  });
});

describe("abuse limits", () => {
  const tool = { category: "Hand tools", condition: "Good", description: "" };

  test("a borrower cannot have too many pending requests at once", async () => {
    const { alice, bob } = await setupWorld();
    const ids: Id<"tools">[] = [];
    for (let i = 0; i < RATE_LIMITS.maxPendingRequests + 1; i++) {
      ids.push(await alice.mutation(api.tools.create, { ...tool, name: `Tool ${i}` }));
    }
    const ask = (toolId: Id<"tools">) =>
      bob.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });

    for (const toolId of ids.slice(0, -1)) await ask(toolId);
    await expect(ask(ids.at(-1)!)).rejects.toThrow(/at most 10 pending/);

    // Cancelling one frees a slot.
    const [first] = await bob.query(api.loans.myRequests, {});
    await bob.mutation(api.loans.cancel, { loanId: first._id });
    await expect(ask(ids.at(-1)!)).resolves.toBeDefined();
  });

  test("requests per hour are capped even if they are cancelled", async () => {
    const { bob, carol, aliceDrill } = await setupWorld();
    for (let i = 0; i < RATE_LIMITS.requestsPerHour; i++) {
      const loanId = await bob.mutation(api.loans.request, {
        toolId: aliceDrill,
        startDate: day(1),
        endDate: day(2),
      });
      await bob.mutation(api.loans.cancel, { loanId });
    }
    await expect(
      bob.mutation(api.loans.request, { toolId: aliceDrill, startDate: day(1), endDate: day(2) }),
    ).rejects.toThrow(/Too many requests/);
    // Other users are unaffected.
    await expect(
      carol.mutation(api.loans.request, { toolId: aliceDrill, startDate: day(1), endDate: day(2) }),
    ).resolves.toBeDefined();
  });

  test("tools per hour are capped", async () => {
    const { bob } = await setupWorld();
    for (let i = 0; i < RATE_LIMITS.toolsPerHour; i++) {
      await bob.mutation(api.tools.create, { ...tool, name: `Tool ${i}` });
    }
    await expect(bob.mutation(api.tools.create, { ...tool, name: "One more" })).rejects.toThrow(
      /Too many tools/,
    );
  });
});
