import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roleValidator = v.union(v.literal("admin"), v.literal("user"));

export const loanStatusValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const automationKindValidator = v.union(
  v.literal("request_notification"),
  v.literal("overdue_reminder"),
);

export const automationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed"),
);

export default defineSchema({
  users: defineTable({
    /** Stable identity from Clerk (issuer + subject). */
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    role: roleValidator,
    /** The bootstrap admin (ROOT_ADMIN_EMAIL). Cannot be demoted. */
    isRoot: v.boolean(),
    trustedLender: v.boolean(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_role", ["role"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
    /** Soft delete: kept so loan history stays readable. */
    deletedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    /** Denormalized from the tool so owners can query their incoming requests. */
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    /** Inclusive ISO dates (YYYY-MM-DD). */
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_borrower_status", ["borrowerId", "status"])
    .index("by_owner", ["ownerId"])
    .index("by_status_endDate", ["status", "endDate"]),

  /** Every outbound/inbound automation touching a loan (n8n notifications, reminders). */
  automationEvents: defineTable({
    loanId: v.id("loans"),
    kind: automationKindValidator,
    status: automationStatusValidator,
    /** Unique per logical event, makes writes from n8n idempotent. */
    idempotencyKey: v.string(),
    /** Loan status the notification refers to (request notifications only). */
    loanStatus: v.optional(loanStatusValidator),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  /** Signatures of accepted n8n → Convex requests, kept until they expire (replay protection). */
  httpNonces: defineTable({
    signature: v.string(),
    expiresAt: v.number(),
  })
    .index("by_signature", ["signature"])
    .index("by_expiresAt", ["expiresAt"]),

  /** Admin actions that change other people's data or permissions. */
  auditLog: defineTable({
    actorId: v.id("users"),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    detail: v.optional(v.string()),
  }).index("by_target", ["targetTable", "targetId"]),
});
