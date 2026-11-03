import { describe, expect, test } from "vitest";
import {
  clerkFrontendApiOrigin,
  contentSecurityPolicy,
  convexOrigins,
  securityHeaders,
} from "./security-headers";

const pk = (host: string) => `pk_test_${btoa(`${host}$`)}`;

describe("security headers", () => {
  test("derives Clerk's Frontend API origin from the publishable key", () => {
    expect(clerkFrontendApiOrigin(pk("happy-cat-1.clerk.accounts.dev"))).toBe(
      "https://happy-cat-1.clerk.accounts.dev",
    );
    expect(clerkFrontendApiOrigin("pk_test_xxx")).toBeNull();
    expect(clerkFrontendApiOrigin(pk("evil.com; script-src *"))).toBeNull();
    expect(clerkFrontendApiOrigin(undefined)).toBeNull();
  });

  test("allows the Convex deployment over HTTP and WebSocket", () => {
    expect(convexOrigins("https://quick-fox-123.convex.cloud")).toEqual([
      "https://quick-fox-123.convex.cloud",
      "wss://quick-fox-123.convex.cloud",
    ]);
    expect(convexOrigins("http://127.0.0.1:3210")).toEqual([
      "http://127.0.0.1:3210",
      "ws://127.0.0.1:3210",
    ]);
  });

  test("production CSP is locked down", () => {
    const csp = contentSecurityPolicy({
      NODE_ENV: "production",
      NEXT_PUBLIC_CONVEX_URL: "https://quick-fox-123.convex.cloud",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk("happy-cat-1.clerk.accounts.dev"),
    });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("wss://quick-fox-123.convex.cloud");
    expect(csp).toContain("https://happy-cat-1.clerk.accounts.dev");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  test("development allows eval for HMR and does not force https", () => {
    const csp = contentSecurityPolicy({ NODE_ENV: "development" });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  test("sends the standard hardening headers", () => {
    const keys = securityHeaders({ NODE_ENV: "production" }).map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Strict-Transport-Security",
      ]),
    );
  });
});
