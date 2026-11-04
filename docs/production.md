# Going to production

LendLoop is built as a take-home: correct and secure by default, but sized for a demo. This is what I'd change before real users rely on it, roughly in priority order.

## Identity and users

- **Sync users with Clerk webhooks** (`user.created`, `user.updated`, `user.deleted`) through a signed Convex HTTP action (Svix signatures), instead of the client calling `users.store` on login. Names, emails and deletions then stay in sync even when someone never opens the app again.
- **Account deletion and retention.** When a user is deleted, anonymize their loans (keep dates and status for the lender's history) and purge their automation events after a retention window.
- **Root admin.** Keep `ROOT_ADMIN_EMAIL` only for bootstrapping. Afterwards, require MFA for admins in Clerk and consider a "break glass" procedure instead of a permanent root.

## Integration (Convex ⇄ n8n)

- **Secrets.** Store them in a secrets manager and rotate them. Support two active secrets per direction during rotation: verify against both, sign with the new one.
- **Replay protection.** Convex stores every accepted signature (`httpNonces`) until its 5-minute window closes and rejects reuse with 409; an hourly cron purges expired rows. n8n dedupes Convex's events by idempotency key. Edge case: if Convex succeeds but n8n times out before reading the response, n8n's same-signature retry gets 409 and the run alerts ops; the next run catches up because acks are idempotent.
- **Durable dedupe in n8n.** Workflow static data is per-workflow and capped at 500 keys. A shared store (Postgres or Redis) is sturdier with several n8n workers.
- **n8n deployment.**
  - Run in queue mode (Redis + workers) on Postgres instead of SQLite.
  - Keep the webhook URL behind HTTPS with a stable domain, not a quick tunnel.
  - Restrict the editor UI (SSO, IP allow-list).
  - Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` and move the HMAC secrets into a custom credential type, or n8n's external secrets, so they're not readable from arbitrary Code nodes.
- **Dead letters.** Add an admin "retry" button for `failed` notifications, plus alerting when the failure rate crosses a threshold. Today failures are visible but retried only by Convex's own schedule.
- **Rate limiting** on the HTTP actions (for example the Convex rate-limiter component) as defense in depth on top of signatures.

## Email

- Use a transactional provider (Postmark, SES, Resend) with SPF, DKIM and DMARC instead of Mailpit.
- HTML templates, an unsubscribe or notification-preferences page, and per-user opt-out for non-essential emails.
- Bounce handling: mark addresses as undeliverable and surface that to the user.

## Data and privacy

- **Minimization is already in place** (see the README). Next steps:
  - A data processing record.
  - A privacy notice explaining what's shared with whom: the owner sees the borrower's name, emails go through the email provider.
  - A data export endpoint for users.
- **Contact between users.** Today people coordinate pickup outside the app. In production I'd add in-app messaging rather than exposing emails between users.
- **Logs.** n8n execution data contains recipient emails. Set `EXECUTIONS_DATA_PRUNE=true` with a short `EXECUTIONS_DATA_MAX_AGE`. Convex logs never include payloads (only event keys and statuses).

## Product and scale

- **Pagination.** `tools.list`, `loans.*` and admin tables load everything. Use Convex `paginate` plus search indexes (full-text search on tool names).
- **Availability.** Availability is computed per tool per query (N+1 reads). At scale, denormalize `currentLoanUntil` onto the tool, or precompute it in a cron.
- **Time zones.** The UI sends the browser's local date, and the server accepts it only if it is "today" in some real time zone (UTC-12 to UTC+14). Requests, approvals, returns and the "overdue" badge then follow each user's local day. Server-side jobs still use UTC, such as the daily reminder list when n8n sends no date. Store each user's time zone if reminders must match their local day too.
- **Moderation.** Report a listing, and a reason field on admin deletes (already audited).
- **Abuse.** Cap open requests per user and add a cooldown after repeated rejections.

## Operations

- Separate Convex dev/prod deployments, with a Clerk production instance and a separate JWT issuer per environment.
- Deploy the app to Vercel with preview deployments wired to Convex preview deployments.
- Error tracking (Sentry) on the client and in Convex actions. Uptime checks on the n8n webhook and the Convex HTTP endpoints.
- Back up Convex (scheduled exports) and the n8n database.
- End-to-end tests (Playwright) for the main flows against a seeded Convex preview deployment, in addition to the existing function-level tests.
