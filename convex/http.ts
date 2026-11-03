import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { todayIso, isIsoDate } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequest } from "./lib/hmac";

/**
 * Endpoints called BY n8n. Every request must carry a valid HMAC signature
 * made with N8N_TO_CONVEX_SECRET (a different secret from the one Convex
 * uses to sign requests TO n8n, so leaking one doesn't compromise both).
 */
const http = httpRouter();

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Reads the body as UTF-8 text, giving up as soon as it exceeds `maxBytes`
 * (measured in bytes, not UTF-16 code units) instead of buffering all of it.
 */
async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type Handler = (ctx: ActionCtx, body: Record<string, unknown>) => Promise<Response>;

/** Wraps a handler with signature verification, size limit and JSON parsing. */
function signed(handler: Handler) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.N8N_TO_CONVEX_SECRET;
    if (!secret) return json(503, { error: "integration not configured" });

    const raw = await readBodyLimited(request, MAX_BODY_BYTES);
    if (raw === null) return json(413, { error: "payload too large" });

    const verdict = await verifyRequest(
      secret,
      raw,
      request.headers.get(TIMESTAMP_HEADER),
      request.headers.get(SIGNATURE_HEADER),
    );
    if (!verdict.ok) {
      console.warn(`Rejected n8n request to ${new URL(request.url).pathname}: ${verdict.reason}`);
      return json(401, { error: "invalid signature" });
    }

    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json(400, { error: "body must be a JSON object" });
    }

    try {
      return await handler(ctx, body as Record<string, unknown>);
    } catch (err) {
      if (err instanceof ConvexError) {
        const data = err.data as { code?: string; message?: string };
        return json(data.code === "NOT_FOUND" ? 404 : 400, { error: data.message });
      }
      console.error("n8n endpoint failed", err);
      return json(500, { error: "internal error" });
    }
  });
}

/** Daily reminder workflow, step 1: which loans are overdue (and not yet reminded today)? */
http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: signed(async (ctx, body) => {
    const date = body.date === undefined ? todayIso() : body.date;
    if (typeof date !== "string" || !isIsoDate(date)) {
      return json(400, { error: "date must be YYYY-MM-DD" });
    }
    const loans = await ctx.runQuery(internal.reminders.overdueForDate, { date });
    return json(200, { date, count: loans.length, loans });
  }),
});

/** Daily reminder workflow, step 2: record the outcome for one loan (idempotent). */
http.route({
  path: "/n8n/reminders/ack",
  method: "POST",
  handler: signed(async (ctx, body) => {
    const { loanId, idempotencyKey, status, error } = body;
    if (
      typeof loanId !== "string" ||
      typeof idempotencyKey !== "string" ||
      (status !== "sent" && status !== "failed") ||
      (error !== undefined && typeof error !== "string")
    ) {
      return json(400, {
        error: "expected { loanId, idempotencyKey, status: sent|failed, error? }",
      });
    }
    const res = await ctx.runMutation(internal.reminders.recordReminder, {
      loanId,
      idempotencyKey,
      status,
      error,
    });
    return json(200, res);
  }),
});

export default http;
