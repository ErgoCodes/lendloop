import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { CATEGORIES, CONDITIONS } from "./lib/constants";
import { addDays, todayIso } from "./lib/dates";

/**
 * Development seed: fake users with tools, plus loans for one real user, to
 * exercise pagination and performance with realistic volumes.
 *
 *   pnpm convex env set SEED_ENABLED true
 *   pnpm convex run seed:run '{"users": 300, "toolsPerUser": 5, "email": "you@example.com"}'
 *   pnpm convex run seed:clear
 *
 * Rows are inserted directly (no mutations), so no n8n notifications are
 * sent and rate limits don't apply. Seeded users have a `seed|` token
 * identifier and can't sign in; tools created for the real user carry a
 * SEED_MARKER description so `clear` can find them.
 */

const TOKEN_PREFIX = "seed|";
const SEED_MARKER = "[seed]";
const USER_BATCH = 50;
const CLEAR_BATCH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elena",
  "Felipe",
  "Gabriela",
  "Hugo",
  "Isabel",
  "Joao",
  "Karina",
  "Luis",
  "Mariana",
  "Nicolas",
  "Olivia",
  "Pedro",
  "Quintina",
  "Rafael",
  "Sofia",
  "Tomas",
  "Ursula",
  "Victor",
  "Wanda",
  "Ximena",
  "Yago",
  "Zoe",
];
const LAST_NAMES = [
  "Almeida",
  "Barbosa",
  "Castro",
  "Dias",
  "Esteves",
  "Ferreira",
  "Gomes",
  "Herrera",
  "Iglesias",
  "Jimenez",
  "Lopes",
  "Martins",
  "Nunes",
  "Oliveira",
  "Pereira",
  "Ramos",
  "Silva",
  "Teixeira",
  "Valdes",
  "Zamora",
];
const TOOLS_BY_CATEGORY: Record<(typeof CATEGORIES)[number], string[]> = {
  "Power tools": [
    "Cordless drill",
    "Circular saw",
    "Angle grinder",
    "Jigsaw",
    "Orbital sander",
    "Impact driver",
  ],
  "Hand tools": [
    "Claw hammer",
    "Socket set",
    "Spirit level",
    "Hand saw",
    "Pipe wrench",
    "Chisel set",
  ],
  Garden: [
    "Lawn mower",
    "Hedge trimmer",
    "Leaf blower",
    "Pruning shears",
    "Wheelbarrow",
    "Garden hose",
  ],
  "Ladders & access": ["Step ladder", "Extension ladder", "Scaffold tower", "Work platform"],
  Cleaning: ["Pressure washer", "Carpet cleaner", "Wet/dry vacuum", "Window squeegee kit"],
  "Camping & outdoors": [
    "4-person tent",
    "Camping stove",
    "Sleeping bag",
    "Cooler box",
    "Hiking poles",
  ],
  Kitchen: ["Stand mixer", "Pasta machine", "Slow cooker", "Food dehydrator", "Waffle iron"],
  Other: ["Projector", "Sewing machine", "Folding table", "Party speaker", "Moving dolly"],
};

/** Small deterministic PRNG so a given seed index always yields the same data. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, items: readonly T[]) => items[Math.floor(r() * items.length)];

function assertEnabled() {
  if (process.env.SEED_ENABLED !== "true") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message:
        "Seeding is disabled. Run `pnpm convex env set SEED_ENABLED true` on a dev deployment.",
    });
  }
}

function seededUsers(ctx: QueryCtx) {
  return ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.gte("tokenIdentifier", TOKEN_PREFIX).lt("tokenIdentifier", "seed}"),
    );
}

function makeTool(r: () => number, ownerId: Id<"users">) {
  const category = pick(r, CATEGORIES);
  const base = pick(r, TOOLS_BY_CATEGORY[category]);
  const condition = pick(r, CONDITIONS);
  return {
    ownerId,
    name:
      r() < 0.3 ? `${base} (${pick(r, ["XL", "compact", "pro", "spare", "old faithful"])})` : base,
    category,
    condition,
    description:
      r() < 0.25 ? "" : `${condition} ${base.toLowerCase()}, happy to lend to neighbours.`,
  };
}

// ---------- seeding ----------

/** Highest seed index used so far, so repeated runs add new users instead of duplicates. */
export const lastIndex = internalQuery({
  args: {},
  handler: async (ctx) => {
    const last = await seededUsers(ctx).order("desc").first();
    return last ? Number(last.tokenIdentifier.slice(TOKEN_PREFIX.length)) : 0;
  },
});

export const insertUsers = internalMutation({
  args: { from: v.number(), count: v.number(), toolsPerUser: v.number() },
  handler: async (ctx, { from, count, toolsPerUser }) => {
    assertEnabled();
    let tools = 0;
    for (let i = from; i < from + count; i++) {
      const r = rng(i);
      const first = pick(r, FIRST_NAMES);
      const id = String(i).padStart(5, "0");
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `${TOKEN_PREFIX}${id}`,
        name: `${first} ${pick(r, LAST_NAMES)}`,
        email: `seed${id}@lendloop.test`,
        role: "user",
        isRoot: false,
        trustedLender: i % 7 === 0,
      });
      // Vary per user (0..2×) around the requested average.
      const n = Math.round(toolsPerUser * 2 * r());
      for (let t = 0; t < n; t++) await ctx.db.insert("tools", makeTool(r, userId));
      tools += n;
    }
    return { users: count, tools };
  },
});

type LoanFields = Omit<Doc<"loans">, "_id" | "_creationTime">;

/**
 * Gives a real (signed-in at least once) user enough loans to page through:
 * history on both sides, plus pending, ongoing, overdue and recently decided
 * ones for the header badge and toasts. Counterparts are seeded users.
 */
export const insertLoansFor = internalMutation({
  args: { email: v.string(), history: v.number() },
  handler: async (ctx, { email, history }) => {
    assertEnabled();
    const normalized = email.trim().toLowerCase();
    const me = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), normalized))
      .first();
    if (!me) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `No user with email ${normalized}. Sign in to the app once with it, then re-run.`,
      });
    }

    const others = await seededUsers(ctx).take(60);
    const theirTools: Doc<"tools">[] = [];
    for (const u of others) {
      const t = await ctx.db
        .query("tools")
        .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
        .first();
      if (t) theirTools.push(t);
    }
    if (others.length === 0 || theirTools.length === 0) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "Seed some users with tools first (users > 0, toolsPerUser > 0).",
      });
    }

    // Tools of mine that seeded borrowers ask for.
    const r = rng(4242);
    const myTools: Id<"tools">[] = [];
    for (let i = 0; i < 4; i++) {
      const t = makeTool(r, me._id);
      myTools.push(
        await ctx.db.insert("tools", {
          ...t,
          description: `${SEED_MARKER} ${t.description}`.trim(),
        }),
      );
    }

    const today = todayIso();
    const now = Date.now();
    let created = 0;
    const insert = async (loan: LoanFields) => {
      await ctx.db.insert("loans", loan);
      created++;
    };
    const finished = ["returned", "rejected", "cancelled"] as const;
    const past = (i: number) => {
      const start = addDays(today, -(10 + i * 3));
      return { startDate: start, endDate: addDays(start, 1 + (i % 5)) };
    };
    const oldDecision = (i: number) => now - (2 + i) * DAY_MS;

    for (let i = 0; i < history; i++) {
      const status = finished[i % 3];
      // As borrower, on someone else's tool.
      const tool = theirTools[i % theirTools.length];
      await insert({
        toolId: tool._id,
        ownerId: tool.ownerId,
        borrowerId: me._id,
        ...past(i),
        status,
        decidedAt: oldDecision(i),
        ...(status === "returned" ? { returnedAt: oldDecision(i) + DAY_MS } : {}),
      });
      // As owner, borrowed by a seeded user.
      await insert({
        toolId: myTools[i % myTools.length],
        ownerId: me._id,
        borrowerId: others[i % others.length]._id,
        ...past(i),
        status,
        decidedAt: oldDecision(i),
        ...(status === "returned" ? { returnedAt: oldDecision(i) + DAY_MS } : {}),
      });
    }

    // Active ones. Approved loans use distinct tools so they never overlap.
    const [t0, t1, t2, t3] = theirTools;
    await insert({
      toolId: t0._id,
      ownerId: t0.ownerId,
      borrowerId: me._id,
      startDate: addDays(today, -2),
      endDate: addDays(today, 3),
      status: "approved",
      decidedAt: now - 3 * DAY_MS,
    });
    if (t1)
      await insert({
        toolId: t1._id,
        ownerId: t1.ownerId,
        borrowerId: me._id,
        startDate: addDays(today, -9),
        endDate: addDays(today, -4),
        status: "approved",
        decidedAt: now - 10 * DAY_MS,
      }); // overdue
    if (t2)
      await insert({
        toolId: t2._id,
        ownerId: t2.ownerId,
        borrowerId: me._id,
        startDate: addDays(today, 5),
        endDate: addDays(today, 7),
        status: "requested",
        message: "Seeded pending request.",
      });
    if (t3)
      await insert({
        toolId: t3._id,
        ownerId: t3.ownerId,
        borrowerId: me._id,
        startDate: addDays(today, 5),
        endDate: addDays(today, 6),
        status: "rejected",
        decidedAt: now - 2 * 60 * 60 * 1000,
      }); // decided recently
    await insert({
      toolId: myTools[0],
      ownerId: me._id,
      borrowerId: others[0]._id,
      startDate: addDays(today, -1),
      endDate: addDays(today, 2),
      status: "approved",
      decidedAt: now - 2 * DAY_MS,
    });
    for (let i = 1; i <= 4; i++) {
      await insert({
        toolId: myTools[i % myTools.length],
        ownerId: me._id,
        borrowerId: others[i % others.length]._id,
        startDate: addDays(today, 10 + i * 4),
        endDate: addDays(today, 11 + i * 4),
        status: "requested",
        message: `Seeded request #${i}.`,
      });
    }
    return { loans: created, myTools: myTools.length };
  },
});

export const run = internalAction({
  args: {
    users: v.optional(v.number()),
    toolsPerUser: v.optional(v.number()),
    /** A real user's email: also seeds loans (history, pending, overdue) for them. */
    email: v.optional(v.string()),
    /** Finished loans per side (as borrower and as owner) for `email`. */
    history: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertEnabled();
    const users = Math.min(Math.max(Math.floor(args.users ?? 200), 0), 5000);
    const toolsPerUser = Math.min(Math.max(args.toolsPerUser ?? 5, 0), 10);
    const history = Math.min(Math.max(Math.floor(args.history ?? 60), 0), 500);

    const start = (await ctx.runQuery(internal.seed.lastIndex, {})) + 1;
    const totals = { users: 0, tools: 0, loans: 0 };
    for (let done = 0; done < users; done += USER_BATCH) {
      const res = await ctx.runMutation(internal.seed.insertUsers, {
        from: start + done,
        count: Math.min(USER_BATCH, users - done),
        toolsPerUser,
      });
      totals.users += res.users;
      totals.tools += res.tools;
    }
    if (args.email) {
      const res = await ctx.runMutation(internal.seed.insertLoansFor, {
        email: args.email,
        history,
      });
      totals.loans = res.loans;
      totals.tools += res.myTools;
    }
    return totals;
  },
});

// ---------- clearing ----------

async function deleteLoan(ctx: MutationCtx, loan: Doc<"loans">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
    .collect();
  for (const e of events) await ctx.db.delete(e._id);
  await ctx.db.delete(loan._id);
}

/** Deletes a few seeded users with their tools and every loan they're part of. */
export const clearUsersBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertEnabled();
    const users = await seededUsers(ctx).take(CLEAR_BATCH);
    for (const u of users) {
      const [borrowed, owned, tools] = await Promise.all([
        ctx.db
          .query("loans")
          .withIndex("by_borrower", (q) => q.eq("borrowerId", u._id))
          .collect(),
        ctx.db
          .query("loans")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
          .collect(),
        ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
          .collect(),
      ]);
      for (const loan of [...borrowed, ...owned]) await deleteLoan(ctx, loan);
      for (const t of tools) await ctx.db.delete(t._id);
      await ctx.db.delete(u._id);
    }
    return users.length;
  },
});

/** Deletes tools seeded for real users (marked in the description), one page per call. */
export const clearMarkedToolsPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    assertEnabled();
    const res = await ctx.db.query("tools").paginate({ cursor, numItems: 200 });
    let deleted = 0;
    for (const t of res.page) {
      if (!t.description.startsWith(SEED_MARKER)) continue;
      const loans = await ctx.db
        .query("loans")
        .withIndex("by_tool_status", (q) => q.eq("toolId", t._id))
        .collect();
      for (const loan of loans) await deleteLoan(ctx, loan);
      await ctx.db.delete(t._id);
      deleted++;
    }
    return { deleted, cursor: res.isDone ? null : res.continueCursor };
  },
});

export const clear = internalAction({
  args: {},
  handler: async (ctx) => {
    assertEnabled();
    let users = 0;
    for (;;) {
      const n = await ctx.runMutation(internal.seed.clearUsersBatch, {});
      users += n;
      if (n < CLEAR_BATCH) break;
    }
    let tools = 0;
    let cursor: string | null = null;
    do {
      const res: { deleted: number; cursor: string | null } = await ctx.runMutation(
        internal.seed.clearMarkedToolsPage,
        { cursor },
      );
      tools += res.deleted;
      cursor = res.cursor;
    } while (cursor !== null);
    return { users, markedTools: tools };
  },
});
