import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * Single hook called whenever a loan is created or changes status.
 * Wired to the n8n notification workflow in notifications.ts.
 */
export async function onLoanStatusChange(
  _ctx: MutationCtx,
  _loanId: Id<"loans">,
  _status: Doc<"loans">["status"],
): Promise<void> {}
