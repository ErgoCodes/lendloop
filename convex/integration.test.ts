import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { MAX_SKEW_SECONDS, signRequest, verifyRequest } from "./lib/hmac";
import { MAX_ATTEMPTS } from "./notifications";
import { day, setupWorld } from "./test.helpers";

const TO_N8N = "convex-to-n8n-test-secret";
const TO_CONVEX = "n8n-to-convex-test-secret";
const WEBHOOK = "https://n8n.test/webhook/lendloop-loan-events";

beforeEach(() => {
  process.env.CONVEX_TO_N8N_SECRET = TO_N8N;
  process.env.N8N_TO_CONVEX_SECRET = TO_CONVEX;
  process.env.N8N_LOAN_EVENTS_WEBHOOK_URL = WEBHOOK;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HMAC signing", () => {
  test("round trip", async () => {
    const body = JSON.stringify({ hello: "world" });
    const h = await signRequest("s3cret", body);
    const ok = await verifyRequest(
      "s3cret",
      body,
      h["X-LendLoop-Timestamp"],
      h["X-LendLoop-Signature"],
    );
    expect(ok).toEqual({ ok: true });
  });

  test("rejects tampered body, wrong secret, stale timestamp and missing headers", async () => {
    const body = '{"a":1}';
    const now = Date.now();
    const h = await signRequest("s3cret", body, now);
    const ts = h["X-LendLoop-Timestamp"];
    const sig = h["X-LendLoop-Signature"];
    expect((await verifyRequest("s3cret", '{"a":2}', ts, sig, now)).ok).toBe(false);
    expect((await verifyRequest("other", body, ts, sig, now)).ok).toBe(false);
    const later = now + (MAX_SKEW_SECONDS + 1) * 1000;
    expect(await verifyRequest("s3cret", body, ts, sig, later)).toEqual({
      ok: false,
      reason: "stale timestamp",
    });
    expect((await verifyRequest("s3cret", body, null, sig, now)).ok).toBe(false);
  });
});

describe("loan notifications → n8n", () => {
  test("a new request is delivered once, signed, with minimal data", async () => {
    const calls: { headers: Headers; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ headers: new Headers(init.headers), body: init.body as string });
        return new Response("ok", { status: 200 });
      }),
    );

    const { t, bob, aliceDrill } = await setupWorld();
    await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
      message: "private note to the owner",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(1);
    const { headers, body } = calls[0];
    const verdict = await verifyRequest(
      TO_N8N,
      body,
      headers.get("X-LendLoop-Timestamp"),
      headers.get("X-LendLoop-Signature"),
    );
    expect(verdict.ok).toBe(true);

    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      status: "requested",
      recipientRole: "owner",
      recipient: { email: "alice@example.com" },
      counterpartFirstName: "bob",
      toolName: "Cordless drill",
    });
    // Data minimization: no borrower email, no description, no message.
    expect(body).not.toContain("bob@example.com");
    expect(body).not.toContain("18V");
    expect(body).not.toContain("private note");

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "sent", attempts: 1 });
  });

  test("approval notifies the borrower", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(init.body as string);
        return new Response("ok");
      }),
    );
    const { t, alice, bob, aliceDrill } = await setupWorld();
    const loanId = await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
    });
    await alice.mutation(api.loans.approve, { loanId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const approved = bodies.map((b) => JSON.parse(b)).find((p) => p.status === "approved");
    expect(approved).toMatchObject({
      recipientRole: "borrower",
      recipient: { email: "bob@example.com" },
    });
  });

  test("failures are retried with backoff, then marked failed", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t, bob, aliceDrill } = await setupWorld();
    await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
      lastError: "n8n responded 503",
    });
  });

  test("recovers if n8n comes back during the retry window", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++n < 3 ? new Response("down", { status: 502 }) : new Response("ok"))),
    );
    const { t, bob, aliceDrill } = await setupWorld();
    await bob.mutation(api.loans.request, {
      toolId: aliceDrill,
      startDate: day(1),
      endDate: day(2),
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event).toMatchObject({ status: "sent", attempts: 3 });
  });
});

describe("n8n → Convex HTTP endpoints", () => {
  async function signedPost(
    t: Awaited<ReturnType<typeof setupWorld>>["t"],
    path: string,
    data: unknown,
    secret = TO_CONVEX,
  ) {
    const body = JSON.stringify(data);
    return t.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await signRequest(secret, body)) },
      body,
    });
  }

  async function worldWithOverdueLoan() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    const w = await setupWorld();
    const loanId = await w.t.run((ctx) =>
      ctx.db.insert("loans", {
        toolId: w.aliceDrill,
        ownerId: w.ids.alice,
        borrowerId: w.ids.bob,
        startDate: day(-5),
        endDate: day(-2),
        status: "approved",
      }),
    );
    return { ...w, loanId };
  }

  test("unsigned or wrongly signed requests are rejected", async () => {
    const { t } = await worldWithOverdueLoan();
    const unsigned = await t.fetch("/n8n/overdue-loans", { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    const wrong = await signedPost(t, "/n8n/overdue-loans", {}, "not-the-secret");
    expect(wrong.status).toBe(401);
  });

  test("overdue list contains only what the reminder needs", async () => {
    const { t, loanId } = await worldWithOverdueLoan();
    const res = await signedPost(t, "/n8n/overdue-loans", { date: day(0) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.loans[0]).toEqual({
      loanId,
      idempotencyKey: `remind:${loanId}:${day(0)}`,
      borrower: { name: "bob", email: "bob@example.com" },
      ownerFirstName: "alice",
      toolName: "Cordless drill",
      endDate: day(-2),
      daysOverdue: 2,
    });
  });

  test("acks are idempotent and reminded loans drop out of today's list", async () => {
    const { t, bob, loanId } = await worldWithOverdueLoan();
    const ack = { loanId, idempotencyKey: `remind:${loanId}:${day(0)}`, status: "sent" };

    const first = await signedPost(t, "/n8n/reminders/ack", ack);
    expect(await first.json()).toEqual({ result: "created" });
    const second = await signedPost(t, "/n8n/reminders/ack", ack);
    expect(await second.json()).toEqual({ result: "duplicate" });
    // A late "failed" never downgrades a "sent".
    const late = await signedPost(t, "/n8n/reminders/ack", { ...ack, status: "failed" });
    expect(await late.json()).toEqual({ result: "duplicate" });

    const reminders = await t.run(async (ctx) =>
      (await ctx.db.query("automationEvents").collect()).filter(
        (e) => e.kind === "overdue_reminder",
      ),
    );
    expect(reminders).toHaveLength(1);

    const list = await (await signedPost(t, "/n8n/overdue-loans", { date: day(0) })).json();
    expect(list.count).toBe(0);

    // Shows up as activity on the borrower's loan.
    const [loan] = await bob.query(api.loans.myRequests, {});
    expect(loan.activity[0]).toMatchObject({ kind: "overdue_reminder" });
  });

  test("a failed reminder can be retried and later succeed", async () => {
    const { t, loanId } = await worldWithOverdueLoan();
    const key = `remind:${loanId}:${day(0)}`;
    await signedPost(t, "/n8n/reminders/ack", {
      loanId,
      idempotencyKey: key,
      status: "failed",
      error: "SMTP down",
    });
    // Still listed so the next run tries again.
    expect((await (await signedPost(t, "/n8n/overdue-loans", { date: day(0) })).json()).count).toBe(
      1,
    );
    const res = await signedPost(t, "/n8n/reminders/ack", {
      loanId,
      idempotencyKey: key,
      status: "sent",
    });
    expect(await res.json()).toEqual({ result: "updated" });
  });

  test("rejects mismatched idempotency keys and bad input", async () => {
    const { t, loanId } = await worldWithOverdueLoan();
    const mismatch = await signedPost(t, "/n8n/reminders/ack", {
      loanId,
      idempotencyKey: "remind:someone-else:2026-01-01",
      status: "sent",
    });
    expect(mismatch.status).toBe(400);
    const bad = await signedPost(t, "/n8n/reminders/ack", { loanId, status: "maybe" });
    expect(bad.status).toBe(400);
    const badDate = await signedPost(t, "/n8n/overdue-loans", { date: "tomorrow" });
    expect(badDate.status).toBe(400);
  });
});
