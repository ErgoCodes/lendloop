/**
 * HMAC-SHA256 request signing shared by both integration directions.
 *
 *   signature = hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))
 *   headers:   X-LendLoop-Timestamp: <unix seconds>
 *              X-LendLoop-Signature: sha256=<signature>
 *
 * Including the timestamp in the signed string lets the receiver reject
 * replays older than MAX_SKEW_SECONDS. Uses Web Crypto, available in the
 * Convex runtime and in n8n's Code node (via node:crypto, same algorithm).
 */

export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (avoids leaking how many chars matched). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signRequest(secret: string, body: string, nowMs: number = Date.now()) {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const signature = await hmacHex(secret, `${timestamp}.${body}`);
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `sha256=${signature}`,
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifyRequest(
  secret: string,
  body: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nowMs: number = Date.now(),
): Promise<VerifyResult> {
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing signature" };
  if (!/^\d+$/.test(timestampHeader)) return { ok: false, reason: "bad timestamp" };
  const skew = Math.abs(Math.floor(nowMs / 1000) - Number(timestampHeader));
  if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: "stale timestamp" };
  const expected = `sha256=${await hmacHex(secret, `${timestampHeader}.${body}`)}`;
  if (!timingSafeEqual(expected, signatureHeader)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
