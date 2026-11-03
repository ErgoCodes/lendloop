import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * Replay protection for signed n8n → Convex requests. A signature covers the
 * timestamp, so each one is valid for at most MAX_SKEW_SECONDS; remembering
 * it until then means a captured request cannot be sent a second time.
 */

/** Records a signature as used. Returns false if it was already used. */
export const claim = internalMutation({
  args: { signature: v.string(), expiresAt: v.number() },
  handler: async (ctx, { signature, expiresAt }) => {
    const existing = await ctx.db
      .query("httpNonces")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .unique();
    if (existing) return false;
    await ctx.db.insert("httpNonces", { signature, expiresAt });
    return true;
  },
});

/** Frees a signature when the server failed, so n8n's retry is accepted. */
export const release = internalMutation({
  args: { signature: v.string() },
  handler: async (ctx, { signature }) => {
    const existing = await ctx.db
      .query("httpNonces")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

const PURGE_BATCH = 500;

/** Deletes signatures whose timestamp is already too old to be accepted. */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("httpNonces")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(PURGE_BATCH);
    for (const nonce of expired) await ctx.db.delete(nonce._id);
    if (expired.length === PURGE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.httpNonces.purgeExpired, {});
    }
  },
});
