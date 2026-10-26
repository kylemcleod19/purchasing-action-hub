# Purchasing Action Hub — Supplier Delivery Tracking prototype

A focused working prototype for a fictional interview case. A purchaser can see which incoming
direct-material deliveries may delay production, which work orders are affected, and what to
follow up on. They can record agreed arrival changes and delivery splits.

- **Two connected views:** Incoming items (landing page) and Purchase-order detail (Deliveries / Follow-ups tabs).
- **One work order per PO:** each PO belongs to exactly one work order, and its items and deliveries
  inherit that work order's production start. A work order may have several POs.
- **Actions that persist:** expected-arrival updates (date or unknown, source, optional note), splits of
  planned deliveries into dated quantities, supplier follow-ups, change history, and demo reset.
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

The demo records are PO **PO-DEMO-01** (part HX-2210, 100 EA) for work order **WO-DEMO-A**, which has a
production start of D+7. D is the demo date.

1. On **Incoming items**, choose **All outstanding** and search `PO-DEMO-01`. The expected arrival (D+5)
   sits next to the production start (D+7), and the row shows no identified date issue.
2. Click **Update arrival**, enter D+16 with source *Supplier email*, leave the note blank, and save. All
   100 units are now *Late*, with "9 days after start" beneath the date. Last update shows today with an
   envelope icon.
3. Click **Open PO**. The header shows WO-DEMO-A and the production start. Click **Split** on the delivery
   and enter 40 at D+6 and 60 at D+16. The preview shows the 40 with no date conflict and the 60 late.
   Save.
4. The item row reads Ordered 100, Planned 100, In transit 0, Received 0, Late 60. Its expanded delivery
   table shows the 40 with no identified date issue and the 60 as *Late*. WO-DEMO-A remains at risk,
   because all material is needed at start.
5. Add a follow-up on the 60-unit delivery. On the **Follow-ups** tab, complete it. Back on
   **Deliveries**, the 60 is still late and its Last update has not changed, because completing a task
   never changes dates or clears risk.
6. Try the delivery-state filter (for example *In transit* shows an empty state, and the item totals
   never change). Refresh the page and the changes and the filter persist. Use **Reset demo data** to
   restore the baseline.

The seed has 20 work orders: five have two POs and fifteen have one. It also includes these examples:
arrival before production start, known late arrival, missing expected arrival, arrival overdue with no
receipt, follow-up due with an otherwise timely arrival (PO-24107), an in-transit delivery with a
carrier-sourced manual update (PO-24111), PO items with two deliveries on different dates, and received
lines shown read-only. Other seeded deliveries show *Initial PO schedule* as their Last update source,
because no supplier email or call is invented.

## Rules worth knowing

- Comparisons are on date-only `YYYY-MM-DD` strings, so results are the same in any browser timezone.
  History timestamps are UTC.
- *Late* means the expected arrival is later than the linked production start. Arriving on the start
  date is not flagged. Receiving and inspection time are not modeled, and the UI says so.
- An unknown date is never treated as on time. Received deliveries carry no active date alerts.
- Each delivery is evaluated against its PO's single work-order production start. Each PO item shows
  late and unknown-date quantities separately, and quantities of different parts are never summed.
- Attention order is: date conflict, arrival overdue, date unknown, follow-up due, no identified date
  issue. Within each group, rows are sorted by the PO's production start, with unknown starts last. This
  is a simple demo ordering rule, not an optimized priority.
- *Last update* is the date and source of the latest arrival-information change. It is not a delivery
  date, and follow-ups never change it.
- Every mutation uses a version precondition and runs in one transaction. Stale or repeated submits
  get HTTP 409 and change nothing. Only planned deliveries can be split. Split deliveries stay on the
  same PO item and work order. The original row is kept (superseded) for history, and open
  delivery-level follow-ups move to the PO level.

The rule functions are in [shared/impact.ts](shared/impact.ts) and the display wording is in
[shared/labels.ts](shared/labels.ts).

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
