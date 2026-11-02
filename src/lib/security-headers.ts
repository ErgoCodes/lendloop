/**
 * HTTP security headers applied to every route (see next.config.ts).
 *
 * The CSP is nonce-less on purpose: `cacheComponents` prerenders static
 * shells, which cannot carry a per-request nonce, so inline scripts are
 * allowed and everything else is locked down to the origins the app really
 * talks to (Clerk, Convex, Cloudflare Turnstile for Clerk's bot protection).
 */

type Env = {
  NODE_ENV?: string;
  NEXT_PUBLIC_CONVEX_URL?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
};

/** Clerk's Frontend API host is base64-encoded in the publishable key. */
export function clerkFrontendApiOrigin(publishableKey: string | undefined): string | null {
  const encoded = publishableKey?.match(/^pk_(?:test|live)_(.+)$/)?.[1];
  if (!encoded) return null;
  try {
    const host = atob(encoded).replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

/** HTTP(S) origin of the Convex deployment plus its WebSocket counterpart. */
export function convexOrigins(convexUrl: string | undefined): string[] {
  if (!convexUrl) return ["https://*.convex.cloud", "wss://*.convex.cloud"];
  try {
    const url = new URL(convexUrl);
    const ws = url.protocol === "https:" ? "wss:" : "ws:";
    return [url.origin, `${ws}//${url.host}`];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy(env: Env): string {
  const isDev = env.NODE_ENV === "development";
  const clerk =
    clerkFrontendApiOrigin(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) ?? "https://*.clerk.accounts.dev";
  const turnstile = "https://challenges.cloudflare.com";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      clerk,
      turnstile,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com"],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      clerk,
      "https://clerk-telemetry.com",
      ...convexOrigins(env.NEXT_PUBLIC_CONVEX_URL),
    ],
    "frame-src": [turnstile],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  // Would rewrite a local http:// Convex backend to https:// in development.
  if (!isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export function securityHeaders(env: Env = process.env): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    // Ignored by browsers over plain http, so harmless on localhost.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
