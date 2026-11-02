import { query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

/** Admin: recent automation runs, so failed notifications/reminders are visible. */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const events = await ctx.db.query("automationEvents").order("desc").take(50);
    return await Promise.all(
      events.map(async (e) => {
        const loan = await ctx.db.get(e.loanId);
        const tool = loan ? await ctx.db.get(loan.toolId) : null;
        return {
          _id: e._id,
          _creationTime: e._creationTime,
          kind: e.kind,
          status: e.status,
          loanStatus: e.loanStatus,
          attempts: e.attempts,
          lastError: e.lastError,
          completedAt: e.completedAt,
          toolName: tool?.name ?? "—",
        };
      }),
    );
  },
});
