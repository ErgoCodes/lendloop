# LendLoop

> Lend what you have, borrow what you need. A neighbourhood tool-lending board.

**Stack:** Next.js 16 (App Router) · Clerk (auth) · Convex (data + business logic) · n8n (automations) · TypeScript · shadcn/ui

- Visitors see a public, read-only board (tool name + category only).
- Signed-in users list tools, request them for a date range, approve/reject requests for their own tools and mark loans as returned.
- Admins promote other users, mark **Trusted Lenders**, delete any listing and see every loan plus all automation runs.
- n8n emails the right person whenever a request is created or changes state, and sends a daily reminder for overdue loans, writing the result back to Convex.

---

## Contents

1. [Architecture](#architecture)
2. [Local setup](#local-setup)
3. [Environment variables](#environment-variables)
4. [n8n workflows](#n8n-workflows)
5. [Security and data minimization](#security-and-data-minimization)
6. [Testing](#testing)
7. [Project layout](#project-layout)
8. [Going to production](docs/production.md)

---

## Architecture

```
                ┌──────────────┐  JWT (template "convex")  ┌──────────────────────────────┐
  Browser ─────▶│  Next.js app │──────────────────────────▶│ Convex                       │
  (Clerk UI)    │  (UI only)   │  useQuery / useMutation   │  queries · mutations         │
                └──────────────┘                           │  access control (lib/auth)   │
                                                           │  automationEvents table      │
                                                           └──────┬───────────────▲───────┘
                       loan created / status changed:             │               │
                       mutation → scheduler → action              │ signed POST   │ signed POST
                       (HMAC: CONVEX_TO_N8N_SECRET)               ▼               │ (HMAC: N8N_TO_CONVEX_SECRET)
                                                           ┌──────────────────────┴───────┐
                                                           │ n8n                          │
                                                           │ 1. loan event notifications  │──▶ SMTP (Mailpit locally)
                                                           │ 2. daily overdue reminders   │──▶ SMTP
                                                           │ 3. error alerts              │──▶ ops email
                                                           └──────────────────────────────┘
```

**Where the rules live.** Every Convex function that touches private data starts with `requireUser`, `requireAdmin` or an ownership check ([`convex/lib/auth.ts`](convex/lib/auth.ts)). The UI hides buttons people can't use, but that is only convenience; the tests call the backend directly to prove the rules hold without the UI.

**Data model** ([`convex/schema.ts`](convex/schema.ts)):

| Table              | Purpose                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`            | Synced from Clerk on login (`users.store`). `role` (`admin`/`user`), `isRoot`, `trustedLender`.                                                                      |
| `tools`            | Listings. Soft-deleted (`deletedAt`) so loan history stays readable.                                                                                                 |
| `loans`            | `requested → approved → returned`, or `rejected` / `cancelled`. Inclusive `YYYY-MM-DD` dates. "Overdue" is derived (`approved` and `endDate` < today), never stored. |
| `automationEvents` | One row per notification or reminder: status, attempts, last error, unique `idempotencyKey`. Feeds the "Reminder sent 2 days ago" activity.                          |
| `auditLog`         | Admin actions on other people's data (role changes, trust, moderation deletes).                                                                                      |

**Roles and the root admin.** New users are `user`. The address in `ROOT_ADMIN_EMAIL` becomes the immutable **root admin** the first time it signs in, but only if Clerk reports the email as verified (otherwise anyone could register with that address). Admins promote or demote others from `/admin`. Nobody can change the root admin or their own role.

**Availability and races.** A request is refused if it overlaps an approved loan. Approval re-checks overlap and auto-rejects competing requests for the same days. Convex mutations are serializable transactions, so two concurrent approvals for overlapping dates can't both succeed.

---

## Local setup

Prerequisites: Node 22+, pnpm (`corepack enable` picks the version pinned in `package.json`), Docker, a Clerk account and a Convex account.

### 1. App + Convex

```bash
pnpm install
pnpm convex dev            # log in, create a project; writes CONVEX_DEPLOYMENT + NEXT_PUBLIC_CONVEX_URL to .env.local
```

Keep `pnpm convex dev` running (it pushes functions and regenerates `convex/_generated`).

### 2. Clerk

1. In the Clerk dashboard: **Configure → JWT templates → New template → Convex**. Keep the name `convex`.
2. Copy the template's **Issuer** URL.
3. Add the API keys to `.env.local` (see [`.env.example`](.env.example)):

   ```bash
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```

4. Tell Convex about Clerk and who the root admin is:

   ```bash
   pnpm convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-instance>.clerk.accounts.dev
   pnpm convex env set ROOT_ADMIN_EMAIL you@example.com
   ```

### 3. Run it

```bash
pnpm dev                   # http://localhost:3000
```

Sign in with the root admin email; you should see a **Root admin** badge and an **Admin** tab.

### Seed data (development only)

To try pagination and performance with realistic volumes, seed fake users and tools (and loans for your own account) into a **dev** deployment. The seed refuses to run unless `SEED_ENABLED` is set, inserts rows directly (no n8n emails, no rate limits), and seeded users can't sign in.

```bash
pnpm convex env set SEED_ENABLED true
# Sign in to the app once first, so your user exists.
pnpm convex run seed:run '{"users": 300, "toolsPerUser": 5, "email": "you@example.com", "history": 60}'
pnpm convex run seed:clear   # removes everything the seed created
```

| Arg            | Default | What it creates                                                                                                |
| -------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `users`        | 200     | Fake users (max 5000). Re-running adds more instead of duplicating.                                            |
| `toolsPerUser` | 5       | Average tools per fake user (0–2× per user, max 10).                                                           |
| `email`        | –       | Your account: 4 tools of yours, `history` finished loans on each side, plus pending, ongoing and overdue ones. |
| `history`      | 60      | Finished loans per side (as borrower and as owner) for `email` (max 500).                                      |

### 4. n8n + Mailpit

```bash
cd n8n
cp .env.example .env      # fill in the values (see below)
# n8n's encryption key lives in a file, not in .env, so Code nodes can't read it
mkdir -m 700 secrets && openssl rand -hex 32 > secrets/n8n_encryption_key
chmod 644 secrets/n8n_encryption_key   # readable by the container's node user
docker compose up -d      # n8n: http://localhost:5678 · Mailpit: http://localhost:8025
```

Generate the two shared secrets and set the **same values** in `n8n/.env` and in Convex:

```bash
openssl rand -hex 32      # → CONVEX_TO_N8N_SECRET
openssl rand -hex 32      # → N8N_TO_CONVEX_SECRET
pnpm convex env set CONVEX_TO_N8N_SECRET <first>
pnpm convex env set N8N_TO_CONVEX_SECRET <second>
```

**Import the workflows.** In n8n, use _Workflows → Import from file_ for each file in [`n8n/workflows`](n8n/workflows), or from the CLI:

```bash
docker compose exec n8n n8n import:workflow --separate --input=/workflows
```

> **Hosted n8n without SMTP (e.g. Render free, which blocks outbound ports 25/465/587):** import [`n8n/workflows-brevo`](n8n/workflows-brevo) instead. They are the same workflows, with the email node replaced by an HTTP call to the Brevo API (port 443). Create an n8n _Header Auth_ credential named `Brevo API` with header `api-key` and a Brevo key limited to transactional emails, then assign it to the email node of each workflow. `LENDLOOP_FROM_EMAIL` must be a sender verified in Brevo. If Brevo's _Authorised IPs_ protection is on, it rejects the host's IP with a 401.

Then:

1. **Import the local SMTP credential** (Mailpit, no password; the nodes already reference it):

   ```bash
   docker compose exec n8n n8n import:credentials --input=/credentials/mailpit-smtp.json
   ```

   For a real provider, create your own SMTP credential in the n8n UI instead and select it in the three email nodes.

2. **Set the error workflow.** Check that _Settings → Error workflow_ of workflows 1 and 2 points to **LendLoop · Error alerts**. The import keeps the ID, but n8n Cloud may reassign it.
3. **Publish all three workflows.** In n8n 2.x the error workflow must be published too; otherwise n8n logs `Workflow "LLErrorAlerts001" is not active` and no alert is sent. From the CLI:

   ```bash
   for id in LLLoanEvents0001 LLOverdueRemind1 LLErrorAlerts001; do
     docker compose exec n8n n8n publish:workflow --id=$id
   done
   docker compose restart n8n
   ```

These workflows were run end to end against n8n 2.45.7, with a mock Convex that uses the repo's own `convex/lib/hmac.ts` and a test SMTP server. Covered cases:

- signed event → email + 200
- replayed event → 200 `duplicate`, no second email
- forged or stale signature → 401
- a bounced reminder is acked as `failed` without stopping the batch
- a re-run skips loans already reminded that day
- an SMTP failure triggers the ops alert email

**Connect Convex to n8n.** Convex has to reach the n8n webhook, so pick one:

- **Convex cloud deployment (default).** Expose n8n with the bundled tunnel and use the URL it prints:

  ```bash
  docker compose --profile tunnel up -d && docker compose logs tunnel | grep trycloudflare
  pnpm convex env set N8N_LOAN_EVENTS_WEBHOOK_URL https://<random>.trycloudflare.com/webhook/lendloop-loan-events
  ```

  Set `CONVEX_SITE_URL=https://<deployment>.convex.site` in `n8n/.env`.

- **Everything local.** Run `pnpm convex dev --local` instead. Then:

  ```bash
  pnpm convex env set N8N_LOAN_EVENTS_WEBHOOK_URL http://localhost:5678/webhook/lendloop-loan-events
  ```

  Set `CONVEX_SITE_URL=http://host.docker.internal:3211` in `n8n/.env`.

After changing `n8n/.env`, run `docker compose up -d` again so n8n picks it up.

**Try it.** Request a tool with a second account and the owner's email appears in Mailpit. If the owner has the app open on any page, a toast appears right away and **Incoming** shows a pending-count badge (the borrower gets the same toast when the request is approved or declined), with no refresh needed thanks to Convex's live queries. For reminders, approve a loan, wait until it's overdue (or edit its `endDate` in the Convex dashboard), then run _Daily overdue reminders_ manually in n8n. The reminder lands in Mailpit, and the loan shows "Reminder sent … ago" in **My requests**.

---

## Environment variables

| Where                            | Variable                                                        | Purpose                                                                                |
| -------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `.env.local`                     | `NEXT_PUBLIC_CONVEX_URL`                                        | Convex client URL (written by `pnpm convex dev`).                                      |
| `.env.local`                     | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`         | Clerk keys.                                                                            |
| Convex env                       | `CLERK_JWT_ISSUER_DOMAIN`                                       | Issuer of the Clerk `convex` JWT template.                                             |
| Convex env                       | `ROOT_ADMIN_EMAIL`                                              | Bootstrap admin (must be a verified email in Clerk).                                   |
| Convex env                       | `N8N_LOAN_EVENTS_WEBHOOK_URL`                                   | n8n webhook for loan events. Unset → events are recorded as failed ("not configured"). |
| Convex env + `n8n/.env`          | `CONVEX_TO_N8N_SECRET`                                          | Convex signs loan events; n8n verifies.                                                |
| Convex env + `n8n/.env`          | `N8N_TO_CONVEX_SECRET`                                          | n8n signs calls to Convex; Convex verifies.                                            |
| `n8n/.env`                       | `CONVEX_SITE_URL`                                               | Base URL of Convex HTTP actions (`.convex.site`).                                      |
| `n8n/secrets/n8n_encryption_key` | `N8N_ENCRYPTION_KEY` (via `_FILE`)                              | Encrypts credentials stored by n8n. Kept out of `$env` so Code nodes can't read it.    |
| `n8n/.env`                       | `LENDLOOP_FROM_EMAIL`, `LENDLOOP_OPS_EMAIL`, `LENDLOOP_APP_URL` | Email sender, ops alert recipient, links in emails.                                    |

No secret is committed: `.env*` files are git-ignored (except the `.env.example` templates), and the workflow JSON only references `$env.*` and a credential by name.

---

## n8n workflows

### 1. Loan event notifications ([`1-loan-event-notifications.json`](n8n/workflows/1-loan-event-notifications.json))

```
Webhook (raw body) → Verify signature → Switch ─ ok ────────▶ Compose email → Send email → Remember event → 200
                                              ├ duplicate ─▶ 200 {duplicate: true}
                                              └ invalid ───▶ 401
```

**How events reach n8n.** Every loan mutation calls `onLoanStatusChange` ([`convex/lib/loanEvents.ts`](convex/lib/loanEvents.ts)). That inserts a `pending` automation event in the same transaction and schedules `notifications.deliver`. Mutations can't do network I/O, so an action does the POST.

**Who gets notified.** The owner hears about new and cancelled requests. The borrower hears about approvals, rejections and returns.

**Retries.** Any non-2xx response or timeout is retried after 30 s, 2 min, 10 min and 30 min, then the event is marked `failed` with the last error. Admins see it under **Automation activity**.

**Idempotency.**

- Each event has a key `notify:<loanId>:<status>`, sent as the `Idempotency-Key` header.
- n8n remembers processed keys (workflow static data), so a retry after a lost response doesn't send a second email.
- The response is sent only after the email succeeded. If SMTP fails, Convex sees a 500 and retries.

### 2. Daily overdue reminders ([`2-daily-overdue-reminders.json`](n8n/workflows/2-daily-overdue-reminders.json))

```
Schedule 09:00 / Manual → Sign request → POST /n8n/overdue-loans → one item per loan
    → Compose reminder → Send email (continue on error) → Sign result → POST /n8n/reminders/ack
```

**Overdue list.** Convex returns loans that are `approved` with `endDate` before today and that haven't been reminded today. Each comes with an idempotency key `remind:<loanId>:<date>`.

**Writing results back.** Every result, sent or failed, goes back to `/n8n/reminders/ack`:

- `sent` is final: re-acks report `duplicate` and never downgrade it.
- `failed` keeps the loan in the next run's list.
- Re-running the workflow the same day is safe.

**Error handling.** A single bounced email doesn't stop the batch, because that node continues on error and the failure is acked to Convex. HTTP nodes retry 3 times.

### 3. Error alerts ([`3-error-alerts.json`](n8n/workflows/3-error-alerts.json))

The error workflow for 1 and 2: any unhandled failure (Convex unreachable, bad secret, SMTP down for notifications) emails `LENDLOOP_OPS_EMAIL` with the workflow, node and error message. Payload data is not included.

Failures are therefore visible in three places:

- n8n's execution list.
- The ops email.
- `/admin` → _Automation activity_, for the Convex side.

---

## Security and data minimization

**Public page.** `tools.listPublic` builds its response field by field (`_id`, `name`, `category`), so owner identity, condition, description and availability never leave the backend for anonymous visitors. A test asserts the exact keys.

**Access control in Convex, not the UI.** The access-control tests call functions directly as other users and as anonymous callers. Examples:

- Users can't approve loans on someone else's tool.
- Admins can moderate but can't edit other people's listings.
- Only the borrower can cancel a request.

**Server-side validation.**

- Lengths, category and condition allow-lists, real calendar dates, no past start dates.
- At most 30 days per loan and 180 days lead time.
- You can't borrow your own tool or send duplicate pending requests.

**Signed integration in both directions.**

- **Signature.** `HMAC-SHA256(secret, "<unix-ts>.<raw body>")` in `X-LendLoop-Signature`, with the timestamp in `X-LendLoop-Timestamp`. Implemented in [`convex/lib/hmac.ts`](convex/lib/hmac.ts), and with `node:crypto` in the n8n Code nodes.
- **Verification.** Compared in constant time. Requests older than 5 minutes are rejected, and Convex remembers each accepted signature until it expires, so a captured request can't be replayed (409). A signature is released again if Convex fails with a 5xx, so n8n's automatic retry still goes through.
- **Raw body.** Verified over the exact bytes received (the n8n webhook uses the _raw body_ option), not re-serialized JSON.
- **Two secrets, one per direction.** A leak on one side can't be used to forge traffic the other way.
- **Fail closed.** Missing secret means 503. Bad or missing signature means 401, with no payload echoed back. Bodies over 16 KB get 413.

**Minimal payloads.**

- Loan events carry the recipient's name and email, the other party's _first name_, tool name, dates and status. They omit the tool description, condition, the borrower's message and the other party's email.
- Reminders carry only the borrower's contact, tool name, due date and days overdue.

**Secrets.** Secrets live only in Convex environment variables and `n8n/.env` (read as `$env.*`). SMTP credentials live in n8n's encrypted credential store. The exported workflows contain no secret values.

**Auditing.** Admin actions on other people's data are written to `auditLog`.

---

## Testing

```bash
pnpm test         # convex-test + Vitest: 39 tests
pnpm typecheck     # app + Convex functions
pnpm lint
```

| Test file                                           | What it covers                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`users.test.ts`](convex/users.test.ts)             | Root bootstrap (verified emails only), role management, audit log.                          |
| [`tools.test.ts`](convex/tools.test.ts)             | Public field whitelist, validation, ownership, admin moderation.                            |
| [`loans.test.ts`](convex/loans.test.ts)             | Full lifecycle, overlap rules, competing requests, who can do what.                         |
| [`integration.test.ts`](convex/integration.test.ts) | HMAC sign/verify, payload minimization, retries/backoff, signed endpoints, idempotent acks. |

CI (GitHub Actions) runs lint, typecheck and tests on every push.

---

## Project layout

```
src/app/                 Pages: / (public), /tools, /my/{listings,requests,incoming}, /admin
src/components/          App components + shadcn/ui (src/components/ui)
src/proxy.ts             Clerk route protection (Next 16 renamed middleware → proxy)
convex/schema.ts         Tables and indexes
convex/lib/auth.ts       requireUser / requireAdmin / ownership checks
convex/{users,tools,loans}.ts   Public API
convex/notifications.ts  Signed delivery to n8n with retries
convex/reminders.ts      Overdue list + idempotent reminder write-back
convex/http.ts           HTTP actions for n8n (signature-verified)
n8n/docker-compose.yml   n8n + Mailpit (+ optional Cloudflare tunnel)
n8n/workflows/           Exported workflows (no secrets)
n8n/workflows-brevo/     Same workflows, sending email via the Brevo HTTP API
docs/production.md       What to change before production
```
