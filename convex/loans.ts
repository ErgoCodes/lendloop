import { ConvexError, v } from "convex/values";
import { paginationOptsValidator, type FilterBuilder, type NamedTableInfo } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";
import { LIMITS, RATE_LIMITS } from "./lib/constants";
import { assertValidRange, rangesOverlap, resolveToday } from "./lib/dates";
import { onLoanStatusChange } from "./lib/loanEvents";
import { cleanText, rateLimited } from "./lib/validation";

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

/** Caps open and recent requests per borrower (each one emails an owner). */
async function assertCanRequest(ctx: QueryCtx, borrowerId: Id<"users">) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_borrower_status", (q) =>
      q.eq("borrowerId", borrowerId).eq("status", "requested"),
    )
    .take(RATE_LIMITS.maxPendingRequests);
  if (pending.length >= RATE_LIMITS.maxPendingRequests) {
    rateLimited(
      `You can have at most ${RATE_LIMITS.maxPendingRequests} pending requests. Wait for answers or cancel some.`,
    );
  }
  const recent = await ctx.db
    .query("loans")
    .withIndex("by_borrower", (q) =>
      q.eq("borrowerId", borrowerId).gt("_creationTime", Date.now() - RATE_LIMITS.windowMs),
    )
    .take(RATE_LIMITS.requestsPerHour);
  if (recent.length >= RATE_LIMITS.requestsPerHour) {
    rateLimited("Too many requests in the last hour. Please try again later.");
  }
}

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    today: v.optional(v.string()),
  },
  handler: async (ctx, { toolId, startDate, endDate, message, today }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tool not found." });
    }
    if (tool.ownerId === me._id) conflict("You cannot borrow your own tool.");

    assertValidRange(startDate, endDate, {
      today: resolveToday(today),
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
    await assertCanRequest(ctx, me._id);

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
  args: { loanId: v.id("loans"), today: v.optional(v.string()) },
  handler: async (ctx, { loanId, today }) => {
    const { loan } = await requireLoanOwner(ctx, loanId);
    if (loan.status !== "requested") conflict("This request was already decided.");
    if (loan.endDate < resolveToday(today)) conflict("This request's dates have already passed.");
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
  args: { loanId: v.id("loans"), today: v.optional(v.string()) },
  handler: async (ctx, { loanId, today }) => {
    const { user, loan } = await requireLoanOwner(ctx, loanId, true);
    if (loan.status !== "approved") conflict("Only active loans can be marked as returned.");
    if (loan.startDate > resolveToday(today)) conflict("This loan hasn't started yet.");
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

/** Statuses that need attention; everything else is history. */
const ACTIVE_STATUSES = ["requested", "approved"] as const;
/** Max page size a client may ask for (paginationOpts comes from the caller). */
export const MAX_PAGE_SIZE = 50;

function clampPage<T extends { numItems: number }>(opts: T): T {
  return { ...opts, numItems: Math.min(Math.max(opts.numItems, 1), MAX_PAGE_SIZE) };
}

/**
 * Presents loans for the UI. Tools and users repeat across a list (same
 * tool, same counterpart), so each doc is read once per query run.
 */
function loanPresenter(ctx: QueryCtx, today: string) {
  const tools = new Map<Id<"tools">, Promise<Doc<"tools"> | null>>();
  const users = new Map<Id<"users">, Promise<Doc<"users"> | null>>();
  const tool = (id: Id<"tools">) => {
    if (!tools.has(id)) tools.set(id, ctx.db.get(id));
    return tools.get(id)!;
  };
  const user = (id: Id<"users">) => {
    if (!users.has(id)) users.set(id, ctx.db.get(id));
    return users.get(id)!;
  };

  async function party(userId: Id<"users">): Promise<Party> {
    const u = await user(userId);
    return { name: u?.name ?? "Unknown", trustedLender: u?.trustedLender ?? false };
  }

  async function present(loan: Doc<"loans">) {
    const [t, events] = await Promise.all([
      tool(loan.toolId),
      ctx.db
        .query("automationEvents")
        .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
        .collect(),
    ]);
    return {
      _id: loan._id,
      _creationTime: loan._creationTime,
      tool: {
        _id: loan.toolId,
        name: t?.name ?? "Deleted tool",
        category: t?.category ?? "",
        deleted: !t || t.deletedAt !== undefined,
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

  return {
    asBorrower: async (l: Doc<"loans">) => ({
      ...(await present(l)),
      owner: await party(l.ownerId),
    }),
    asOwner: async (l: Doc<"loans">) => ({
      ...(await present(l)),
      borrower: await party(l.borrowerId),
    }),
    asAdmin: async (l: Doc<"loans">) => ({
      ...(await present(l)),
      owner: await party(l.ownerId),
      borrower: await party(l.borrowerId),
    }),
  };
}

const newestFirst = (a: { _creationTime: number }, b: { _creationTime: number }) =>
  b._creationTime - a._creationTime;

/** Pending and approved loans on one side; small by nature (and rate limited). */
async function activeLoans(ctx: QueryCtx, side: "borrower" | "owner", userId: Id<"users">) {
  const lists = await Promise.all(
    ACTIVE_STATUSES.map((status) =>
      side === "borrower"
        ? ctx.db
            .query("loans")
            .withIndex("by_borrower_status", (q) => q.eq("borrowerId", userId).eq("status", status))
            .collect()
        : ctx.db
            .query("loans")
            .withIndex("by_owner_status", (q) => q.eq("ownerId", userId).eq("status", status))
            .collect(),
    ),
  );
  return lists.flat().sort(newestFirst);
}

/** Loans I asked for that are still pending or ongoing. History is paginated separately. */
export const myRequests = query({
  args: { today: v.optional(v.string()) },
  handler: async (ctx, { today }) => {
    const me = await requireUser(ctx);
    const p = loanPresenter(ctx, resolveToday(today));
    return await Promise.all((await activeLoans(ctx, "borrower", me._id)).map(p.asBorrower));
  },
});

/** Pending requests and ongoing loans on my tools. History is paginated separately. */
export const incoming = query({
  args: { today: v.optional(v.string()) },
  handler: async (ctx, { today }) => {
    const me = await requireUser(ctx);
    const p = loanPresenter(ctx, resolveToday(today));
    return await Promise.all((await activeLoans(ctx, "owner", me._id)).map(p.asOwner));
  },
});

/** How long a decided loan stays in the live feed, so open tabs can toast it. */
export const FEED_RECENT_MS = 24 * 60 * 60 * 1000;
/** Upper bound per list; the badge and toasts never need more. */
export const FEED_LIMIT = 50;
/** Finished loans (rejected, cancelled, returned), newest first, one page at a time. */
export const myRequestsHistory = query({
  args: { paginationOpts: paginationOptsValidator, today: v.optional(v.string()) },
  handler: async (ctx, { paginationOpts, today }) => {
    const me = await requireUser(ctx);
    const p = loanPresenter(ctx, resolveToday(today));
    const result = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .filter(isFinished)
      .paginate(clampPage(paginationOpts));
    return { ...result, page: await Promise.all(result.page.map(p.asBorrower)) };
  },
});

export const incomingHistory = query({
  args: { paginationOpts: paginationOptsValidator, today: v.optional(v.string()) },
  handler: async (ctx, { paginationOpts, today }) => {
    const me = await requireUser(ctx);
    const p = loanPresenter(ctx, resolveToday(today));
    const result = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .filter(isFinished)
      .paginate(clampPage(paginationOpts));
    return { ...result, page: await Promise.all(result.page.map(p.asOwner)) };
  },
});

function isFinished(q: FilterBuilder<NamedTableInfo<DataModel, "loans">>) {
  return q.and(...ACTIVE_STATUSES.map((s) => q.neq(q.field("status"), s)));
}

/**
 * Lightweight live feed for the header: a badge with pending requests on my
 * tools, and enough data for the client to toast status changes on any page.
 *
 * Mounted on every page, so it reads only pending loans plus those decided
 * in the last day (never the whole history), each list capped at FEED_LIMIT.
 */
export const notifications = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    // The cutoff only needs to be roughly current: re-runs happen whenever
    // one of these loans changes, which is exactly when a fresh window matters.
    const cutoff = Date.now() - FEED_RECENT_MS;

    const [ownedPending, ownedRecent, borrowedPending, borrowedRecent] = await Promise.all([
      ctx.db
        .query("loans")
        .withIndex("by_owner_decidedAt", (q) => q.eq("ownerId", me._id).eq("decidedAt", undefined))
        .order("desc")
        .take(FEED_LIMIT),
      ctx.db
        .query("loans")
        .withIndex("by_owner_decidedAt", (q) => q.eq("ownerId", me._id).gt("decidedAt", cutoff))
        .order("desc")
        .take(FEED_LIMIT),
      ctx.db
        .query("loans")
        .withIndex("by_borrower_decidedAt", (q) =>
          q.eq("borrowerId", me._id).eq("decidedAt", undefined),
        )
        .order("desc")
        .take(FEED_LIMIT),
      ctx.db
        .query("loans")
        .withIndex("by_borrower_decidedAt", (q) =>
          q.eq("borrowerId", me._id).gt("decidedAt", cutoff),
        )
        .order("desc")
        .take(FEED_LIMIT),
    ]);

    // The same tool and counterpart show up repeatedly; read each doc once.
    const toolNames = new Map<Id<"tools">, Promise<string>>();
    const userNames = new Map<Id<"users">, Promise<string>>();
    const toolName = (id: Id<"tools">) => {
      if (!toolNames.has(id)) {
        toolNames.set(
          id,
          ctx.db.get(id).then((t) => t?.name ?? "Deleted tool"),
        );
      }
      return toolNames.get(id)!;
    };
    const userName = (id: Id<"users">) => {
      if (!userNames.has(id)) {
        userNames.set(
          id,
          ctx.db.get(id).then((u) => u?.name ?? "Unknown"),
        );
      }
      return userNames.get(id)!;
    };
    const item = async (loan: Doc<"loans">, otherId: Id<"users">) => ({
      _id: loan._id,
      status: loan.status,
      toolName: await toolName(loan.toolId),
      otherParty: await userName(otherId),
    });

    const owned = [...ownedPending, ...ownedRecent];
    const borrowed = [...borrowedPending, ...borrowedRecent];
    return {
      pendingIncoming: ownedPending.length,
      incoming: await Promise.all(owned.map((l) => item(l, l.borrowerId))),
      mine: await Promise.all(borrowed.map((l) => item(l, l.ownerId))),
    };
  },
});

/** Admin: every loan in the system, newest first, one page at a time. */
export const all = query({
  args: { paginationOpts: paginationOptsValidator, today: v.optional(v.string()) },
  handler: async (ctx, { paginationOpts, today }) => {
    await requireAdmin(ctx);
    const p = loanPresenter(ctx, resolveToday(today));
    const result = await ctx.db.query("loans").order("desc").paginate(clampPage(paginationOpts));
    return { ...result, page: await Promise.all(result.page.map(p.asAdmin)) };
  },
});
