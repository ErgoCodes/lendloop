import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Single hook called whenever a loan is created or changes status.
 *
 * Mutations can't make network calls, so we record a pending automation
 * event and schedule an action to deliver it to n8n. Because this runs in
 * the same transaction as the status change, the event exists if and only
 * if the change was committed.
 */
export async function onLoanStatusChange(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  status: Doc<"loans">["status"],
): Promise<void> {
  // One notification per loan state; a loan never re-enters a state.
  const idempotencyKey = `notify:${loanId}:${status}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return;

  const eventId = await ctx.db.insert("automationEvents", {
    loanId,
    kind: "request_notification",
    status: "pending",
    idempotencyKey,
    loanStatus: status,
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
}
