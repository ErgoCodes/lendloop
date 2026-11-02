import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireToolAccess, requireUser } from "./lib/auth";
import { CATEGORIES, CONDITIONS, LIMITS, RATE_LIMITS } from "./lib/constants";
import { todayIso } from "./lib/dates";
import { onLoanStatusChange } from "./lib/loanEvents";
import { cleanText, oneOf, rateLimited } from "./lib/validation";

const toolInput = {
  name: v.string(),
  category: v.string(),
  condition: v.string(),
  description: v.string(),
};

function validateToolInput(input: {
  name: string;
  category: string;
  condition: string;
  description: string;
}) {
  return {
    name: cleanText(input.name, "Name", { max: LIMITS.toolName }),
    category: oneOf(input.category, CATEGORIES, "category"),
    condition: oneOf(input.condition, CONDITIONS, "condition"),
    description: cleanText(input.description, "Description", {
      max: LIMITS.description,
      required: false,
    }),
  };
}

async function activeTools(ctx: QueryCtx, category: string | undefined) {
  const tools = category
    ? await ctx.db
        .query("tools")
        .withIndex("by_category", (q) => q.eq("category", category))
        .collect()
    : await ctx.db.query("tools").collect();
  return tools
    .filter((t) => t.deletedAt === undefined)
    .sort((a, b) => b._creationTime - a._creationTime);
}

/** Approved, not-yet-returned loans that end today or later. */
async function upcomingBookings(ctx: QueryCtx, toolId: Id<"tools">, today: string) {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  return approved
    .filter((l) => l.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((l) => ({ startDate: l.startDate, endDate: l.endDate }));
}

function availabilityFrom(bookings: { startDate: string; endDate: string }[], today: string) {
  const current = bookings.find((b) => b.startDate <= today && today <= b.endDate);
  if (current) return { state: "on_loan" as const, until: current.endDate };
  return { state: "available" as const, nextBookingStart: bookings[0]?.startDate };
}

/**
 * PUBLIC (no auth). Deliberately returns only name and category:
 * no owner, condition, description or availability leaves the backend.
 */
export const listPublic = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, { category }) => {
    const tools = await activeTools(ctx, category);
    return tools.map((t) => ({ _id: t._id, name: t.name, category: t.category }));
  },
});

/** Signed-in users: every tool with availability and the owner's display name. */
export const list = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const today = todayIso();
    const tools = await activeTools(ctx, category);
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        const bookings = await upcomingBookings(ctx, t._id, today);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          isMine: t.ownerId === me._id,
          owner: { name: owner?.name ?? "Unknown", trustedLender: owner?.trustedLender ?? false },
          availability: availabilityFrom(bookings, today),
        };
      }),
    );
  },
});

/** Signed-in users: one tool plus its booked date ranges (for the borrow form). */
export const get = query({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) return null;
    const owner = await ctx.db.get(tool.ownerId);
    const today = todayIso();
    const bookings = await upcomingBookings(ctx, tool._id, today);
    return {
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      condition: tool.condition,
      description: tool.description,
      isMine: tool.ownerId === me._id,
      owner: { name: owner?.name ?? "Unknown", trustedLender: owner?.trustedLender ?? false },
      availability: availabilityFrom(bookings, today),
      bookings,
    };
  },
});

/** The signed-in user's own listings with pending request counts. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayIso();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    return await Promise.all(
      tools
        .filter((t) => t.deletedAt === undefined)
        .sort((a, b) => b._creationTime - a._creationTime)
        .map(async (t) => {
          const pending = await ctx.db
            .query("loans")
            .withIndex("by_tool_status", (q) => q.eq("toolId", t._id).eq("status", "requested"))
            .collect();
          const bookings = await upcomingBookings(ctx, t._id, today);
          return {
            _id: t._id,
            name: t.name,
            category: t.category,
            condition: t.condition,
            description: t.description,
            pendingRequests: pending.length,
            availability: availabilityFrom(bookings, today),
          };
        }),
    );
  },
});

/** Caps how many tools one user can list, in total and per hour. */
async function assertCanCreateTool(ctx: QueryCtx, ownerId: Id<"users">) {
  const recent = await ctx.db
    .query("tools")
    .withIndex("by_owner", (q) =>
      q.eq("ownerId", ownerId).gt("_creationTime", Date.now() - RATE_LIMITS.windowMs),
    )
    .take(RATE_LIMITS.toolsPerHour);
  if (recent.length >= RATE_LIMITS.toolsPerHour) {
    rateLimited("Too many tools listed in the last hour. Please try again later.");
  }
  const owned = await ctx.db
    .query("tools")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  if (owned.filter((t) => t.deletedAt === undefined).length >= RATE_LIMITS.maxActiveTools) {
    rateLimited(`You can list at most ${RATE_LIMITS.maxActiveTools} tools.`);
  }
}

export const create = mutation({
  args: toolInput,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await assertCanCreateTool(ctx, me._id);
    return await ctx.db.insert("tools", { ownerId: me._id, ...validateToolInput(args) });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolInput },
  handler: async (ctx, { toolId, ...args }) => {
    await requireToolAccess(ctx, toolId, { allowAdmin: false });
    await ctx.db.patch(toolId, validateToolInput(args));
  },
});

/**
 * Owners can delete their own tools unless one is currently lent out.
 * Admins can delete any tool (moderation); the action is audited.
 * Pending requests are rejected so borrowers are notified.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const { user, tool } = await requireToolAccess(ctx, toolId, { allowAdmin: true });
    const isOwner = tool.ownerId === user._id;

    if (isOwner) {
      const today = todayIso();
      const lentOut = (await upcomingBookings(ctx, toolId, today)).some(
        (b) => b.startDate <= today,
      );
      if (lentOut) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "This tool is currently lent out. Mark it returned before deleting it.",
        });
      }
    }

    await ctx.db.patch(toolId, { deletedAt: Date.now() });
    await rejectOpenRequests(ctx, toolId);

    if (!isOwner) {
      await ctx.db.insert("auditLog", {
        actorId: user._id,
        action: "tool.delete",
        targetTable: "tools",
        targetId: toolId,
        detail: tool.name,
      });
    }
  },
});

async function rejectOpenRequests(ctx: MutationCtx, toolId: Id<"tools">) {
  const pending: Doc<"loans">[] = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
    .collect();
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "rejected", decidedAt: Date.now() });
    await onLoanStatusChange(ctx, loan._id, "rejected");
  }
}
