import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, requireAdmin } from "./lib/auth";
import { roleValidator } from "./schema";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Called by the client right after Clerk signs the user in.
 * Creates the Convex user on first login and keeps name/email in sync.
 *
 * The root admin is bootstrapped from ROOT_ADMIN_EMAIL, but only when Clerk
 * reports that email as verified (otherwise anyone could sign up with it).
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required." });
    }

    const email = normalizeEmail(identity.email ?? "");
    const name = identity.name ?? identity.givenName ?? email.split("@")[0] ?? "User";
    const rootEmail = normalizeEmail(process.env.ROOT_ADMIN_EMAIL ?? "");
    const isRootLogin = rootEmail !== "" && email === rootEmail && identity.emailVerified === true;

    const existing = await getCurrentUser(ctx);
    if (existing) {
      const patch: Partial<typeof existing> = {};
      if (existing.name !== name) patch.name = name;
      if (existing.email !== email) patch.email = email;
      if (isRootLogin && !existing.isRoot) {
        patch.isRoot = true;
        patch.role = "admin";
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: isRootLogin ? "admin" : "user",
      isRoot: isRootLogin,
      trustedLender: false,
    });
  },
});

/** The signed-in user's own profile (null while signed out or not yet stored). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isRoot: user.isRoot,
      trustedLender: user.trustedLender,
    };
  },
});

/** Max page size a client may ask for (paginationOpts comes from the caller). */
export const MAX_PAGE_SIZE = 50;

/** Admin: users for role management, newest first, one page at a time. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const result = await ctx.db
      .query("users")
      .order("desc")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(Math.max(paginationOpts.numItems, 1), MAX_PAGE_SIZE),
      });
    const page = result.page.map((u) => ({
      _id: u._id,
      _creationTime: u._creationTime,
      name: u.name,
      email: u.email,
      role: u.role,
      isRoot: u.isRoot,
      trustedLender: u.trustedLender,
    }));
    return { ...result, page };
  },
});

/** Admin: promote a user to admin or demote an admin. The root admin is immutable. */
export const setRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, { userId, role }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
    if (target.isRoot) {
      throw new ConvexError({ code: "FORBIDDEN", message: "The root admin cannot be changed." });
    }
    if (target._id === actor._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "You cannot change your own role." });
    }
    if (target.role === role) return;

    await ctx.db.patch(userId, { role });
    await ctx.db.insert("auditLog", {
      actorId: actor._id,
      action: role === "admin" ? "user.promote" : "user.demote",
      targetTable: "users",
      targetId: userId,
    });
  },
});

/** Admin: mark or unmark a user as a Trusted Lender. */
export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
    if (target.trustedLender === trusted) return;

    await ctx.db.patch(userId, { trustedLender: trusted });
    await ctx.db.insert("auditLog", {
      actorId: actor._id,
      action: trusted ? "user.trust" : "user.untrust",
      targetTable: "users",
      targetId: userId,
    });
  },
});
