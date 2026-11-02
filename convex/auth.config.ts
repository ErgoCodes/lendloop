import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Clerk Frontend API URL, set with:
      //   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<instance>.clerk.accounts.dev
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      // Must match the name of the "convex" JWT template in Clerk.
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
