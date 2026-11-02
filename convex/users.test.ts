import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { MAX_PAGE_SIZE } from "./users";

const page = { numItems: 50, cursor: null };
import schema from "./schema";
import { modules } from "./test.setup";

const ROOT = "root@lendloop.test";

function setup() {
  const t = convexTest(schema, modules);
  const as = (subject: string, email: string, emailVerified = true) =>
    t.withIdentity({ subject, email, emailVerified, name: subject });
  return { t, as };
}

beforeEach(() => {
  process.env.ROOT_ADMIN_EMAIL = ROOT;
});
afterEach(() => {
  delete process.env.ROOT_ADMIN_EMAIL;
});

describe("users.store", () => {
  test("first login creates a regular user", async () => {
    const { as } = setup();
    const alice = as("alice", "alice@example.com");
    await alice.mutation(api.users.store, {});
    const me = await alice.query(api.users.me, {});
    expect(me).toMatchObject({ role: "user", isRoot: false, trustedLender: false });
  });

  test("ROOT_ADMIN_EMAIL with a verified email becomes root admin", async () => {
    const { as } = setup();
    const root = as("root", ROOT.toUpperCase());
    await root.mutation(api.users.store, {});
    expect(await root.query(api.users.me, {})).toMatchObject({ role: "admin", isRoot: true });
  });

  test("ROOT_ADMIN_EMAIL with an unverified email stays a regular user", async () => {
    const { as } = setup();
    const impostor = as("impostor", ROOT, false);
    await impostor.mutation(api.users.store, {});
    expect(await impostor.query(api.users.me, {})).toMatchObject({ role: "user", isRoot: false });
  });

  test("calling store twice does not duplicate the user", async () => {
    const { t, as } = setup();
    const alice = as("alice", "alice@example.com");
    const id1 = await alice.mutation(api.users.store, {});
    const id2 = await alice.mutation(api.users.store, {});
    expect(id1).toEqual(id2);
    const count = await t.run(async (ctx) => (await ctx.db.query("users").collect()).length);
    expect(count).toBe(1);
  });

  test("anonymous callers are rejected", async () => {
    const { t } = setup();
    await expect(t.mutation(api.users.store, {})).rejects.toThrow();
  });
});

describe("role management", () => {
  async function seed() {
    const { t, as } = setup();
    const root = as("root", ROOT);
    const alice = as("alice", "alice@example.com");
    const bob = as("bob", "bob@example.com");
    const rootId = await root.mutation(api.users.store, {});
    const aliceId = await alice.mutation(api.users.store, {});
    const bobId = await bob.mutation(api.users.store, {});
    return { t, root, alice, bob, rootId, aliceId, bobId };
  }

  test("root can promote a user, who can then promote others", async () => {
    const { root, alice, aliceId, bobId } = await seed();
    await root.mutation(api.users.setRole, { userId: aliceId, role: "admin" });
    await alice.mutation(api.users.setRole, { userId: bobId, role: "admin" });
    const { page: users } = await alice.query(api.users.list, { paginationOpts: page });
    expect(users.find((u) => u._id === bobId)?.role).toBe("admin");
  });

  test("the user list is paginated, newest first, with a capped page size", async () => {
    const { root, bobId, aliceId } = await seed();
    const first = await root.query(api.users.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((u) => u._id)).toEqual([bobId, aliceId]);
    expect(first.isDone).toBe(false);
    const huge = await root.query(api.users.list, {
      paginationOpts: { numItems: 100_000, cursor: null },
    });
    expect(huge.page.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  test("regular users cannot list users or change roles", async () => {
    const { alice, bobId } = await seed();
    await expect(alice.query(api.users.list, { paginationOpts: page })).rejects.toThrow(
      /Admins only/,
    );
    await expect(
      alice.mutation(api.users.setRole, { userId: bobId, role: "admin" }),
    ).rejects.toThrow(/Admins only/);
  });

  test("nobody can demote the root admin", async () => {
    const { root, alice, aliceId, rootId } = await seed();
    await root.mutation(api.users.setRole, { userId: aliceId, role: "admin" });
    await expect(
      alice.mutation(api.users.setRole, { userId: rootId, role: "user" }),
    ).rejects.toThrow(/root admin/);
  });

  test("admins cannot change their own role", async () => {
    const { root, alice, aliceId } = await seed();
    await root.mutation(api.users.setRole, { userId: aliceId, role: "admin" });
    await expect(
      alice.mutation(api.users.setRole, { userId: aliceId, role: "user" }),
    ).rejects.toThrow(/own role/);
  });

  test("role changes and trusted-lender flags are audited", async () => {
    const { t, root, aliceId } = await seed();
    await root.mutation(api.users.setRole, { userId: aliceId, role: "admin" });
    await root.mutation(api.users.setTrustedLender, { userId: aliceId, trusted: true });
    const actions = await t.run(async (ctx) =>
      (await ctx.db.query("auditLog").collect()).map((a) => a.action),
    );
    expect(actions).toEqual(["user.promote", "user.trust"]);
  });
});
