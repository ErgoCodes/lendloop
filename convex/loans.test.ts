import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { day, setupWorld } from "./test.helpers";

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
    expect((await bob.query(api.loans.myRequests, {}))[0].status).toBe("returned");
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
    await expect(alice.query(api.loans.all, {})).rejects.toThrow(/Admins only/);
    expect(await root.query(api.loans.all, {})).toHaveLength(1);
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
});
