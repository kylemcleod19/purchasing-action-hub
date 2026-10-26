# Purchasing Action Hub — Supplier Delivery Tracking prototype

A focused working prototype for a fictional interview case. A purchaser can see which incoming
direct-material deliveries may delay production, which work orders are affected, and what to
follow up on. They can record agreed arrival changes and delivery splits.

- **Two connected views:** Incoming items (landing page) and Purchase-order detail (Deliveries / Follow-ups tabs).
- **One work order per PO:** each PO belongs to exactly one work order, and its items and deliveries
  inherit that work order's production start. A work order may have several POs.
- **Buyer action is separate from physical risk:** a delivery gets at most one open *issue* when it
  becomes late, conflicts with production, goes overdue, loses its date, or moves later. The buyer
  resolves it inline (Accepted delay, Date restored, Split delivery agreed, or Reviewed). Date warnings
  stay visible after resolution.
- **Actions that persist:** expected-arrival updates (date or unknown, source, optional note), splits of
  not-shipped deliveries, issue resolution (alone or with the edit, in one save), optional reminders,
  change history, and demo reset.
- **Synthetic data only.** All visitors share one dataset. No emails, PO amendments, supplier messages,
  or integrations of any kind.

The authority for scope and rules is [docs/PRD.md](docs/PRD.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stack

One TypeScript app: React + Vite client, Express 5 API, SQLite via better-sqlite3. In production,
Express serves both the API and the built client from one process. Zod validates requests.
Vitest and Playwright cover the tests.

## Prerequisites

- Node.js **24 LTS** (pinned in `package.json` `engines` and the Docker image; developed on 24.14.0)
- npm 11 (ships with Node 24)
- Docker is only needed to test the deployment image locally.

## Local setup

```sh
npm ci
cp .env.example .env    # optional; the defaults match .env.example
npm run dev             # Vite on http://localhost:5173, proxying /api to the API on :3000
```

The first start creates `data/demo.sqlite`, applies migrations, and seeds the baseline. Later starts
keep existing data and never reseed or shift dates.

**One-time v2 data reset.** Migration `002_po_single_work_order.sql` replaces the original multi-work-order
allocation schema (`work_order_links`, `delivery_links`) with a required `purchase_orders.work_order_id`.
The old allocations can't be mapped to one work order per PO without arbitrary choices. So the first time a
v1 database starts on this version, the migration drops the synthetic demo data and the v2 baseline is
seeded with a new demo date. Edits made in v1 are discarded once. The migration is recorded in
`schema_migrations` and never runs again, so later edits persist normally.

**v3 migration (issues and dock dates) keeps existing data.** Migration `003_issues_and_dock_dates.sql`
adds required dock dates, receipt dates, a separate arrival-update timestamp, history actors, and the
`delivery_issues` table. It keeps all deliveries, edits, and history:
- Items with no dock baseline get a one-time fallback of their work order's production start. This means
  migrated data shows no *late without production conflict* cases.
- v2 receipt dates and arrival-update timestamps carry over. v2 only wrote these on arrival updates and
  splits, never on follow-ups.
- On the first start after the migration, open issues are created once for current exceptions. This is
  guarded by an `issues_initialized` marker and a one-open-issue-per-delivery index. Completed
  reminders are not treated as buyer acceptance.

The banner says when data predates the current seed. Use **Reset demo data** (with confirmation) to
load the v3 scenarios: supplier catalogs, explicit dock dates, and seeded open, accepted, date-restored,
and split issues. Nothing resets automatically.

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) and Vite dev server together |
| `npm run build` | Type-checks, then compiles the server to `dist/server` and builds the client to `dist/client` |
| `npm start` | Runs the compiled server: initializes the DB, serves the API and SPA on `PORT` (default 3000) |
| `npm test` | Vitest: domain rules plus API/mutation tests, each on a temporary database |
| `npm run test:e2e` | Playwright: primary demo flow against the production build with an isolated DB (run `npm run build` first; first time: `npx playwright install chromium`) |
| `npm run db:reset` | Explicit local reset. Refuses when `NODE_ENV=production` unless `ALLOW_PROD_RESET=true` |

Environment variables (see `.env.example`): `PORT`, `DATABASE_PATH`, `DEMO_MODE` (enables the reset
endpoint; default `true`), `NODE_ENV`.

## Demo date and reset

Business dates are generated relative to a **demo date**, which is stored when the database is first
seeded and shown in the banner. Normal restarts keep it. **Reset demo data** (in the banner, with a
confirmation) replaces all data with the baseline and sets the demo date to the current UTC date, so
the scenarios stay valid on any later day. Reset is a demo utility, not a workflow, and it affects
every visitor.

## Primary demo (about 3 minutes)

The demo records are PO **PO-DEMO-01** (Cobalt Harness Works, part HX-2210, 100 EA) for work order
**WO-DEMO-A**: required dock D+5 and production start D+7. D is the demo date.

1. On **Incoming items**, choose **All outstanding** and search `PO-DEMO-01`. Required dock (D+5),
   Expected arrival (D+5), and Production start (D+7) sit side by side, and there is no issue.
2. Click **Update arrival**, enter D+16 with source *Supplier email*, leave the note blank, and click
   **Save changes**. One issue opens, and the confirmation names its reasons. The expected arrival shows
   a late warning (11 days after dock), and the production start shows a production-conflict marker
   (9 days).
3. Open the PO from the PO link; the item is already expanded. On the delivery, click **Split** and enter
   40 at D+5 and 60 at D+16. With *Split delivery agreed* as the outcome, click **Save and resolve issue**.
   This is one save; you don't need to go to Follow-ups.
4. The item row reads Ordered 100, Shipped 0, Received 0. Arrivals shows both dates with quantities in
   parentheses, and the 60 keeps its warning. No action badge remains. Production risk for WO-DEMO-A
   persists, because all material is needed at start.
5. On the 60-unit delivery, **Update arrival** to D+18 and **Save changes**. A new issue opens, linked to
   the earlier one. Click **Resolve** and then **Accept delay and resolve**; the date is not changed.
6. On **Follow-ups**, add a reminder and complete it. Arrival dates, Last update, and the resolution don't
   change. Try the filters: *Needs action* is now empty, *Resolved issues* shows the item, and totals
   never change. Refresh to confirm everything and the filters persist. In Incoming items the 60 is no
   longer in *Needs action* but still appears under *Late*. **Reset demo data** restores the baseline.

The seed has 20 suppliers, each selling one coherent part family. Each of the five largest suppliers
holds one ten-line PO from its own catalog. There are 25 POs, 80 items, and 20 work orders (five with two
POs). Examples:
- Arrival before production start.
- Late without production conflict (PO-24108).
- Missing date (PO-24109).
- Overdue with no receipt (PO-24110).
- Reminder due with a timely arrival (PO-24107).
- Carrier update that opened an issue (PO-24111).
- Received line (PO-24112).
- Date-restored resolution (PO-24113).
- Split agreed with one late child (PO-24114).
- Accepted delay that a worse date will reopen (PO-24115).
- Items with deliveries on different dates for the same work order.

## Rules worth knowing

- Comparisons use date-only `YYYY-MM-DD` strings, so results are the same in any browser timezone.
  History timestamps are UTC, and overdue checks use the persisted demo date.
- *Late*: the expected arrival is after the required dock date. *Production conflict*: the expected
  arrival is after production start. Equal dates are not flagged, because receiving and inspection time
  are not modeled.
- An unknown date is never treated as on time. Received deliveries show the actual receipt date and have
  no active alerts.
- Issue rules ([shared/issues.ts](shared/issues.ts)):
  - A delivery has at most one open issue.
  - **Save changes** keeps an open issue open, even if the date becomes on time.
  - **Save and resolve** applies the edit and the disposition atomically.
  - After a resolution, identical facts, source- or note-only edits, and improved dates with the same
    accepted risks don't reopen the issue. A later estimate, a new unknown date, or a newly active risk
    reason (such as overdue) opens a new issue linked to the old one.
  - Date restored is validated on the server.
- Splits:
  - With **Save changes**, the open review moves to every child, even on-time ones.
  - With **Save and resolve**, the outcome is recorded on the parent, and each child gets a resolved
    disposition against its saved facts.
  - In-transit and received deliveries can't be split.
- Item quantities are cumulative: Shipped includes received units, so Received ≤ Shipped ≤ Ordered.
  Filters never change these totals.
- *Last update* is the date and source of the latest arrival-information change. Resolutions, reminders,
  and notes never change it. Resolutions record the PO buyer as a labeled demo actor (there is no login).
- Every mutation checks delivery and issue versions and runs in one transaction. Stale or repeated
  submits get HTTP 409 and change nothing.

Rule functions are in [shared/impact.ts](shared/impact.ts) (physical risk),
[shared/issues.ts](shared/issues.ts) (issue transitions), and [shared/arrivals.ts](shared/arrivals.ts)
(item table ordering and quantities). Display wording is in [shared/labels.ts](shared/labels.ts).

## Deployment (Railway)

**Repository configuration (in this repo):**

- `Dockerfile`: multi-stage `node:24.14.0-bookworm-slim` image. It runs `npm ci`, `npm run build`, and
  prunes dev dependencies. The runtime image contains the compiled server, SQL migrations, built client,
  and production `node_modules`. The start command is `npm start`.
- `railway.json`: Dockerfile builder, healthcheck `/api/health`, restart on failure.
- The server binds `0.0.0.0:$PORT`. It migrates and seeds at startup, not at build time, because the
  volume is only mounted at runtime. If database initialization fails, startup fails rather than
  falling back to a temporary database.

**Platform steps (done in Railway, not guaranteed by repo files):**

1. Create a project, add a service from the GitHub repo `kylemcleod19/purchasing-action-hub`, and pick the `main` branch.
2. Attach a **volume** to the service, mounted at `/data`.
3. Set variables: `DATABASE_PATH=/data/demo.sqlite`, `NODE_ENV=production`, `DEMO_MODE=true`. Railway provides `PORT`.
4. Confirm the healthcheck path is `/api/health` (it comes from `railway.json`).
5. Keep **one replica in one region**. SQLite on a volume does not support multiple replicas.
6. Under Networking, generate a public domain.
7. After deploy: open `/api/health`, run the demo, open a PO URL directly, then redeploy and confirm
   the change is still there.

You can also do these steps with the Railway CLI after `railway login`. Check `railway --help` for the
volume, variables, and domain subcommands in your CLI version.

**Deployment status:** not deployed yet. The image was built and run locally with a Docker volume
(see the test log). No live Railway URL has been verified.

## Limits

This is an interview prototype. It has no accounts, roles, or permissions; anyone with the URL can
edit the shared synthetic data. The following are out of scope: PO creation or approval, receiving and
QA, inventory, capacity, freight, production scheduling, notifications, AI extraction, and live
integrations. Manual recording is assumed to be enough to demonstrate the decision workflow. Its real
operating burden is untested, and nothing here claims user validation or measured benefit.

## Checks performed

See [docs/test-log.md](docs/test-log.md).
