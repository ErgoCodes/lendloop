import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addDays, todayIso } from "./lib/dates";
import schema from "./schema";
import { modules } from "./test.setup";

export const ROOT_EMAIL = "root@lendloop.test";

export const day = (offset: number) => addDays(todayIso(), offset);

/** Fresh in-memory backend with a root admin and two regular users. */
export async function setupWorld() {
  process.env.ROOT_ADMIN_EMAIL = ROOT_EMAIL;
  const t = convexTest(schema, modules);
  const as = (subject: string, email: string) =>
    t.withIdentity({ subject, email, emailVerified: true, name: subject });

  const root = as("root", ROOT_EMAIL);
  const alice = as("alice", "alice@example.com");
  const bob = as("bob", "bob@example.com");
  const carol = as("carol", "carol@example.com");
  const ids = {
    root: await root.mutation(api.users.store, {}),
    alice: await alice.mutation(api.users.store, {}),
    bob: await bob.mutation(api.users.store, {}),
    carol: await carol.mutation(api.users.store, {}),
  };

  const aliceDrill: Id<"tools"> = await alice.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "Power tools",
    condition: "Good",
    description: "18V, two batteries.",
  });

  return { t, root, alice, bob, carol, ids, aliceDrill };
}
