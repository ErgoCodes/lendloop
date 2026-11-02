import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysBetween, isIsoDate } from "./lib/dates";

/** One reminder per loan per day: re-running the workflow the same day is a no-op. */
export function reminderKey(loanId: string, date: string) {
  return `remind:${loanId}:${date}`;
}

/**
 * Loans that should have been returned before `date` and haven't been
 * reminded yet today. Minimal fields: who to email and what to say.
 */
export const overdueForDate = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const overdue = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", date))
      .collect();

    const result = [];
    for (const loan of overdue) {
      const idempotencyKey = reminderKey(loan._id, date);
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (already?.status === "sent") continue;

      const borrower = await ctx.db.get(loan.borrowerId);
      const owner = await ctx.db.get(loan.ownerId);
      const tool = await ctx.db.get(loan.toolId);
      if (!borrower) continue;
      result.push({
        loanId: loan._id,
        idempotencyKey,
        borrower: { name: borrower.name, email: borrower.email },
        ownerFirstName: owner?.name.split(/\s+/)[0] ?? "the owner",
        toolName: tool?.name ?? "a tool",
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, date),
      });
    }
    return result;
  },
});

/**
 * Idempotent write-back from n8n after it tried to send a reminder.
 * The same key can be acknowledged any number of times; a "sent" result
 * is final and never downgraded by a later "failed".
 */
export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { loanId, idempotencyKey, status, error }) => {
    const id = ctx.db.normalizeId("loans", loanId);
    const loan = id ? await ctx.db.get(id) : null;
    if (!id || !loan) throw new ConvexError({ code: "NOT_FOUND", message: "Unknown loan" });

    const date = idempotencyKey.slice(idempotencyKey.lastIndexOf(":") + 1);
    if (!isIsoDate(date) || idempotencyKey !== reminderKey(id, date)) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Idempotency key mismatch" });
    }

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    const lastError = error?.slice(0, 500);

    if (existing) {
      if (existing.status === "sent") return { result: "duplicate" as const };
      await ctx.db.patch(existing._id, {
        status,
        attempts: existing.attempts + 1,
        lastError: status === "failed" ? lastError : undefined,
        completedAt: status === "sent" ? Date.now() : undefined,
      });
      return { result: "updated" as const };
    }

    await ctx.db.insert("automationEvents", {
      loanId: id,
      kind: "overdue_reminder",
      status,
      idempotencyKey,
      attempts: 1,
      lastError: status === "failed" ? lastError : undefined,
      completedAt: status === "sent" ? Date.now() : undefined,
    });
    return { result: "created" as const };
  },
});
