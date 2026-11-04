# Deployment and architecture decisions

This page records the decisions behind the public LendLoop demo: what was chosen, what was ruled out, and what each choice costs. The constraint behind all of them was a demo that runs at **zero cost, with no custom domain and no VPS**.

## Summary

| # | Area | Decision |
|---|------|----------|
| 1 | Hosting | Vercel Hobby (Next.js) + Convex Production (free) + Clerk development instance |
| 2 | Build | Vercel runs `convex deploy --cmd 'pnpm build'`, so the backend and frontend ship together |
| 3 | Automations | Self-hosted n8n on Render free, with Postgres on Neon free |
| 4 | n8n secrets | Encryption key read from a secret file, never from the environment |
| 5 | Convex ↔ n8n | HMAC-signed requests in both directions, one secret per direction |
| 6 | Email | Brevo HTTP API instead of SMTP |
| 7 | Dates | "Today" is the user's local date, validated by the server |
| 8 | Demo data | The seed stays disabled in production |

Live URLs: app `https://lendloop-gamma.vercel.app`, n8n `https://lendloop-n8n.onrender.com`.

---

## 1. Hosting: Vercel + Convex + Clerk (development instance)

**Decision.** The Next.js app runs on Vercel Hobby, the data and business logic on a Convex Production deployment (free plan), and authentication on Clerk.

**Why the Clerk *development* instance.** A Clerk production instance needs a domain you own, and the demo has none. The development instance (`pk_test_` / `sk_test_` keys) works on the `*.vercel.app` URL as is.

**Trade-offs.**
- Clerk shows its development banner, and the instance is not meant for real user traffic.
- Moving to production needs a domain, a Clerk production instance and new keys. No code changes are required.

## 2. Build: deploy Convex from the Vercel build

**Decision.** The Vercel build command is `convex deploy --cmd 'pnpm build'`, authenticated by a Convex production deploy key stored in Vercel.

**Why.** One push deploys the Convex functions and schema first, then builds Next.js with `NEXT_PUBLIC_CONVEX_URL` injected. The frontend can never ship against a backend that is behind it.

**Trade-off.** The deploy key is a high-value secret. It lives only in Vercel's environment and is never committed or printed.

## 3. Automations: self-hosted n8n on Render + Neon

**Decision.** n8n runs as a Docker image (`n8nio/n8n:2.45.7`, the same version as the local `docker-compose`) on a Render free web service. Its database is a Neon free Postgres, using the direct (non-pooled) connection.

**Alternatives considered.**

| Option | Why not |
|--------|---------|
| n8n Cloud | Trial only, no permanent free tier |
| Render without an external DB | The free filesystem is ephemeral: workflows and credentials would vanish on every restart |
| A VPS | Out of scope (no VPS available) |

**Trade-offs.**
- Render free instances sleep when idle, so the first webhook after a pause is slow. Convex absorbs this with retries: loan events are re-sent after 30 s, 2 min, 10 min and 30 min before being marked failed (`convex/notifications.ts`).
- n8n stores its state in Neon, so a Render redeploy loses nothing.

## 4. n8n encryption key from a secret file

**Decision.** `N8N_ENCRYPTION_KEY_FILE=/etc/secrets/n8n_encryption_key` points to a Render *Secret File*. The key itself is never set as an environment variable.

**Why.** The workflows' Code nodes need `$env` access to read the HMAC secrets. Anything in the environment is therefore readable from a Code node. Keeping the key that decrypts every stored credential in a file removes it from that surface. This mirrors the local setup, which uses a Docker secret.

## 5. Signed traffic between Convex and n8n

**Decision.** Every request in both directions carries `x-lendloop-timestamp` and `x-lendloop-signature = sha256=HMAC(secret, timestamp + "." + rawBody)`. There is one secret per direction (`CONVEX_TO_N8N_SECRET`, `N8N_TO_CONVEX_SECRET`).

**Why.** Both endpoints are public URLs.
- The signature proves the sender.
- The 300-second timestamp window blocks replays.
- Separate secrets mean a leak in one direction does not compromise the other.
- n8n also dedupes events by `idempotencyKey`, so a Convex retry never sends the same email twice.

**Failure modes.**
- If Convex has no webhook configured, it records the attempt as failed and the app keeps working.
- If the n8n → Convex secret is missing, Convex answers `503` instead of accepting unsigned calls.

## 6. Email: Brevo HTTP API instead of SMTP

**Context.** The first deploy used Gmail over SMTP, and every send failed with `ETIMEDOUT`. Since September 2025, Render free web services [block outbound SMTP ports 25, 465 and 587](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports).

**Decision.** The email node in each workflow is an HTTP Request to `https://api.brevo.com/v3/smtp/email`, which goes out over port 443.
- The production versions live in [`n8n/workflows-brevo`](../n8n/workflows-brevo).
- [`n8n/workflows`](../n8n/workflows) keeps SMTP to Mailpit for local development, so nothing local changed.

**Alternatives considered.**

| Option | Why not |
|--------|---------|
| Upgrade Render to a paid instance | Breaks the zero-cost constraint |
| Gmail API (OAuth) | Needs a Google Cloud OAuth app: far more setup for a demo |
| Brevo (chosen) | Free tier of 300 emails/day, works with a verified single sender, no domain needed |

**Trade-offs.**
- The Brevo key is restricted to *transactional emails* only.
- Brevo's *Authorised IPs* protection is turned off. Render free uses shared outbound IPs that can change, so an IP allowlist would break unpredictably. The scoped key is the compensating control.

## 7. "Today" is the user's local date

**Context.** The server computed "today" in UTC while the UI used the browser's date. In the evening west of UTC (for example 21:40 in UTC-3, already the next day in UTC), a user could not start a loan on their own "today".

**Decision.** The UI sends its local date (`today`) to the loan mutations and queries. The server's `resolveToday` accepts it only if it is "today" in some real time zone at that instant (UTC-12 to UTC+14). Without it, the server falls back to UTC.

**Alternatives considered.**

| Option | Why not |
|--------|---------|
| One fixed app time zone (e.g. `America/Sao_Paulo`) | Simpler, but reviewers and users can be anywhere, and they would see someone else's "today" |
| Trust the client date blindly | A client could move "today" arbitrarily and bypass the "no past dates" rule |
| Local date + bounded validation (chosen) | Correct for every time zone, and a client can shift "today" by at most the real time zone spread |

**Known limit.** The daily overdue-reminder job still evaluates "overdue" in UTC. Matching each user's local day there would need a time zone stored per user (see [`production.md`](production.md)).

## 8. Seed disabled in production

**Decision.** `SEED_ENABLED` is not set in Convex Production, so `seed:run` refuses to run there.

**Why.** The seed creates fake users and loans. Production data should come from real sign-ups. If demo data is ever needed, the flag is set temporarily, the seed is run once, and the flag is removed.

---

## Operational notes

- **Secrets live only in their platform's environment:** Vercel, Convex, Render and n8n credentials. None are committed to the repository.
- **Rotate after sharing:** any key exposed outside its platform (in chat, screenshots or logs) should be rotated.
- **Moving to real production:** see [`production.md`](production.md). The main steps are a custom domain, a Clerk production instance, a paid or SMTP-capable host for n8n (or keep Brevo), and per-user time zones.
