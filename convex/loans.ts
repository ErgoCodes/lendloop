import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { assertValidRange, rangesOverlap, todayIso } from "./lib/dates";
import { onLoanStatusChange } from "./lib/loanEvents";
import { cleanText } from "./lib/validation";

function conflict(message: string): never {
  throw new ConvexError({ code: "CONFLICT", message });
}

async function loadLoan(ctx: QueryCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError({ code: "NOT_FOUND", message: "Loan not found." });
  return loan;
}

/** The owner of the lent tool may act on the loan (admins only where stated). */
async function requireLoanOwner(ctx: MutationCtx, loanId: Id<"loans">, allowAdmin = false) {
  const user = await requireUser(ctx);
  const loan = await loadLoan(ctx, loanId);
  if (loan.ownerId !== user._id && !(allowAdmin && user.role === "admin")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Only the tool owner can do this." });
  }
  return { user, loan };
}

async function approvedOverlapping(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  startDate: string,
  endDate: string,
) {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  return approved.filter((l) => rangesOverlap(l.startDate, l.endDate, startDate, endDate));
}

async function setStatus(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  status: Doc<"loans">["status"],
  extra: Partial<Doc<"loans">> = {},
) {
  await ctx.db.patch(loan._id, { status, ...extra });
  await onLoanStatusChange(ctx, loan._id, status);
}

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { toolId, startDate, endDate, message }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tool not found." });
    }
    if (tool.ownerId === me._id) conflict("You cannot borrow your own tool.");

    assertValidRange(startDate, endDate, {
      today: todayIso(),
      maxDays: LIMITS.maxLoanDays,
      maxLeadDays: LIMITS.maxLeadDays,
    });

    if ((await approvedOverlapping(ctx, toolId, startDate, endDate)).length > 0) {
      conflict("The tool is already booked for some of those dates.");
    }

    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
      .collect();
    if (myPending.some((l) => l.borrowerId === me._id)) {
      conflict("You already have a pending request for this tool.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      message: message
        ? cleanText(message, "Message", {
            max: LIMITS.requestMessage,
            required: false,
            multiline: true,
          })
        : undefined,
      status: "requested",
    });
    await onLoanStatusChange(ctx, loanId, "requested");
    return loanId;
  },
});

/** Borrower withdraws a request that hasn't been decided yet. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (loan.borrowerId !== me._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your request." });
    }
    if (loan.status !== "requested") conflict("Only pending requests can be cancelled.");
    await setStatus(ctx, loan, "cancelled", { decidedAt: Date.now() });
  },
});

/**
 * Owner approves a request. Re-checks availability inside the transaction
 * (Convex mutations are serializable, so two approvals can't both win) and
 * auto-rejects other pending requests for the same dates.
 */
export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanOwner(ctx, loanId);
    if (loan.status !== "requested") conflict("This request was already decided.");
    if (loan.endDate < todayIso()) conflict("This request's dates have already passed.");
    if ((await approvedOverlapping(ctx, loan.toolId, loan.startDate, loan.endDate)).length > 0) {
      conflict("Another loan was already approved for those dates.");
    }

    const now = Date.now();
    await setStatus(ctx, loan, "approved", { decidedAt: now });

    const competing = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "requested"))
      .collect();
    for (const other of competing) {
      if (rangesOverlap(other.startDate, other.endDate, loan.startDate, loan.endDate)) {
        await setStatus(ctx, other, "rejected", { decidedAt: now });
      }
    }
  },
});

export const reject = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanOwner(ctx, loanId);
    if (loan.status !== "requested") conflict("This request was already decided.");
    await setStatus(ctx, loan, "rejected", { decidedAt: Date.now() });
  },
});

/** Owner (or an admin) confirms the tool came back. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { user, loan } = await requireLoanOwner(ctx, loanId, true);
    if (loan.status !== "approved") conflict("Only active loans can be marked as returned.");
    if (loan.startDate > todayIso()) conflict("This loan hasn't started yet.");
    await setStatus(ctx, loan, "returned", { returnedAt: Date.now() });
    if (loan.ownerId !== user._id) {
      await ctx.db.insert("auditLog", {
        actorId: user._id,
        action: "loan.markReturned",
        targetTable: "loans",
        targetId: loanId,
      });
    }
  },
});

// ---------- Views ----------

type Party = { name: string; trustedLender: boolean };

async function party(ctx: QueryCtx, userId: Id<"users">): Promise<Party> {
  const u = await ctx.db.get(userId);
  return { name: u?.name ?? "Unknown", trustedLender: u?.trustedLender ?? false };
}

async function present(ctx: QueryCtx, loan: Doc<"loans">, today: string) {
  const tool = await ctx.db.get(loan.toolId);
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
    .collect();
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    tool: {
      _id: loan.toolId,
      name: tool?.name ?? "Deleted tool",
      category: tool?.category ?? "",
      deleted: !tool || tool.deletedAt !== undefined,
    },
    startDate: loan.startDate,
    endDate: loan.endDate,
    message: loan.message,
    status: loan.status,
    isOverdue: loan.status === "approved" && loan.endDate < today,
    /** The loan period has begun, so the tool can be marked returned. */
    hasStarted: loan.startDate <= today,
    decidedAt: loan.decidedAt,
    returnedAt: loan.returnedAt,
    // Automation activity shown in the UI ("Reminder sent 2 days ago").
    activity: events
      .filter((e) => e.status === "sent" && e.completedAt !== undefined)
      .sort((a, b) => b.completedAt! - a.completedAt!)
      .map((e) => ({ kind: e.kind, loanStatus: e.loanStatus, at: e.completedAt! })),
  };
}

const newestFirst = (a: { _creationTime: number }, b: { _creationTime: number }) =>
  b._creationTime - a._creationTime;

/** Loans I asked for. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayIso();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .collect();
    return await Promise.all(
      loans.sort(newestFirst).map(async (l) => ({
        ...(await present(ctx, l, today)),
        owner: await party(ctx, l.ownerId),
      })),
    );
  },
});

/** Requests and loans on my tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayIso();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    return await Promise.all(
      loans.sort(newestFirst).map(async (l) => ({
        ...(await present(ctx, l, today)),
        borrower: await party(ctx, l.borrowerId),
      })),
    );
  },
});

/**
 * Lightweight live feed for the header: a badge with pending requests on my
 * tools, and enough data for the client to toast status changes on any page.
 */
export const notifications = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const [owned, borrowed] = await Promise.all([
      ctx.db
        .query("loans")
        .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
        .collect(),
      ctx.db
        .query("loans")
        .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
        .collect(),
    ]);
    const item = async (loan: Doc<"loans">, otherId: Id<"users">) => ({
      _id: loan._id,
      status: loan.status,
      toolName: (await ctx.db.get(loan.toolId))?.name ?? "Deleted tool",
      otherParty: (await party(ctx, otherId)).name,
    });
    return {
      pendingIncoming: owned.filter((l) => l.status === "requested").length,
      incoming: await Promise.all(owned.map((l) => item(l, l.borrowerId))),
      mine: await Promise.all(borrowed.map((l) => item(l, l.ownerId))),
    };
  },
});

/** Admin: every loan in the system. */
export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = todayIso();
    const loans = await ctx.db.query("loans").order("desc").take(500);
    return await Promise.all(
      loans.map(async (l) => ({
        ...(await present(ctx, l, today)),
        owner: await party(ctx, l.ownerId),
        borrower: await party(ctx, l.borrowerId),
      })),
    );
  },
});
