import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { signRequest } from "./lib/hmac";

/** Delay before retry N (1-based). After the last one the event is marked failed. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;

type LoanStatus = Doc<"loans">["status"];

/** Who should hear about each status change. */
const RECIPIENT: Record<LoanStatus, "owner" | "borrower"> = {
  requested: "owner",
  cancelled: "owner",
  approved: "borrower",
  rejected: "borrower",
  returned: "borrower",
};

/**
 * Data minimization: n8n gets only what it needs to write one message.
 * Exactly one person's contact details (the recipient), first name only for
 * the other party, no tool description/condition, no request message.
 */
export const buildPayload = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending" || !event.loanStatus) return null;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return null;
    const tool = await ctx.db.get(loan.toolId);
    const owner = await ctx.db.get(loan.ownerId);
    const borrower = await ctx.db.get(loan.borrowerId);
    if (!owner || !borrower) return null;

    const to = RECIPIENT[event.loanStatus];
    const recipient = to === "owner" ? owner : borrower;
    const other = to === "owner" ? borrower : owner;
    return {
      eventId: event._id,
      idempotencyKey: event.idempotencyKey,
      type: "loan.status_changed",
      loanId: loan._id,
      status: event.loanStatus,
      recipientRole: to,
      recipient: { name: recipient.name, email: recipient.email },
      counterpartFirstName: other.name.split(/\s+/)[0],
      toolName: tool?.name ?? "a tool",
      startDate: loan.startDate,
      endDate: loan.endDate,
    };
  },
});

export const recordAttempt = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, ok, error }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return;
    const attempts = event.attempts + 1;

    if (ok) {
      await ctx.db.patch(eventId, { status: "sent", attempts, completedAt: Date.now() });
      return;
    }
    const retryDelay = RETRY_DELAYS_MS[attempts - 1];
    if (retryDelay === undefined) {
      await ctx.db.patch(eventId, { status: "failed", attempts, lastError: error });
      console.error(`Notification ${eventId} failed permanently after ${attempts} attempts`, error);
      return;
    }
    await ctx.db.patch(eventId, { attempts, lastError: error });
    await ctx.scheduler.runAfter(retryDelay, internal.notifications.deliver, { eventId });
  },
});

/** POSTs a signed loan event to the n8n webhook, retrying with backoff. */
export const deliver = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const payload = await ctx.runQuery(internal.notifications.buildPayload, { eventId });
    if (!payload) return; // already handled, or the loan is gone

    const url = process.env.N8N_LOAN_EVENTS_WEBHOOK_URL;
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordAttempt, {
        eventId,
        ok: false,
        error: "n8n webhook not configured (N8N_LOAN_EVENTS_WEBHOOK_URL / CONVEX_TO_N8N_SECRET)",
      });
      return;
    }

    const body = JSON.stringify(payload);
    let error: string | undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": payload.idempotencyKey,
          ...(await signRequest(secret, body)),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) error = `n8n responded ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await ctx.runMutation(internal.notifications.recordAttempt, { eventId, ok: !error, error });
  },
});
