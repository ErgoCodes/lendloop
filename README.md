# LendLoop

> Lend what you have, borrow what you need. A neighbourhood tool-lending board.

**Stack:** Next.js (App Router) · Clerk (auth) · Convex (data + business logic) · n8n (automations) · TypeScript

> 🚧 Work in progress. This README will be completed with setup, architecture and security notes.

## Planned structure

```
src/app/            Next.js routes (public landing, /tools, /my/listings, /my/requests, /my/incoming, /admin)
src/components/     UI components
convex/             Schema, queries, mutations, actions, HTTP endpoints, crons
  schema.ts         users, tools, loans, automationEvents
  lib/auth.ts       requireUser / requireAdmin helpers (access control lives here, not in the UI)
  http.ts           HMAC-verified endpoints called by n8n
n8n/
  docker-compose.yml  Local self-hosted n8n
  workflows/          Exported workflow JSON (no secrets)
docs/               Architecture and production notes
```

## Planned n8n workflows

1. **Request notifications** — Convex schedules an action when a loan request is created or changes status; it POSTs a minimal, HMAC-signed payload to an n8n webhook, which verifies the signature and notifies the owner/borrower.
2. **Overdue reminders** — Daily schedule in n8n calls a signed Convex HTTP endpoint to fetch overdue loans, sends a reminder per borrower, and writes the result back to Convex (idempotent by `loanId + date`).

## Local setup (draft)

```bash
npm install
cp .env.example .env.local      # fill in Clerk + Convex values
npx convex dev                  # creates/links your Convex deployment
npm run dev
```

n8n:

```bash
cd n8n && cp .env.example .env && docker compose up -d
```
