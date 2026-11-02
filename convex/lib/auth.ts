import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Access control lives here. Every public query/mutation that touches
 * private data calls one of these helpers; the UI only mirrors the rules.
 */

type Ctx = QueryCtx | MutationCtx;

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required." });
  }
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Admins only." });
  }
  return user;
}

/** Returns the tool if the current user owns it (or is an admin, when allowed). */
export async function requireToolAccess(
  ctx: Ctx,
  toolId: Id<"tools">,
  opts: { allowAdmin: boolean },
): Promise<{ user: Doc<"users">; tool: Doc<"tools"> }> {
  const user = await requireUser(ctx);
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.deletedAt !== undefined) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Tool not found." });
  }
  const isOwner = tool.ownerId === user._id;
  const isAllowedAdmin = opts.allowAdmin && user.role === "admin";
  if (!isOwner && !isAllowedAdmin) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Not your tool." });
  }
  return { user, tool };
}
