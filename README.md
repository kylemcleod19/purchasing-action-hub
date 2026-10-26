# Purchasing Action Hub — Supplier Delivery Tracking prototype

A focused working prototype for a fictional interview case. A purchaser can see which incoming
direct-material deliveries may delay production, which work orders are affected, and what to
follow up on. They can record agreed arrival changes and delivery splits.

- **Two connected views:** Incoming items (landing page) and Purchase-order detail (Deliveries / Follow-ups tabs).
- **Actions that persist:** expected-arrival updates (date or unknown, source, note), splits of planned
  deliveries with explicit work-order assignment, supplier follow-ups, change history, and demo reset.
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

The demo records are PO **PO-DEMO-01** (part HX-2210, 100 EA) and work orders **WO-DEMO-A** (40 units,
starts D+7) and **WO-DEMO-B** (60 units, starts D+14). D is the demo date.

1. On **Incoming items**, choose **All outstanding** and search `PO-DEMO-01`. Its expected arrival is
   D+5, which shows no identified date issue.
2. Click **Update arrival**, enter D+16 with source *Supplier email* and a note, and save. The row moves
   to **Needs attention** as *Late* with 2 late WOs. Expanding it shows A late 40 and B late 60.
3. Click **Open PO** and then **Split**. Enter delivery 1: 40 at D+6, delivery 2: 60 at D+16. In the
   grid, assign WO-DEMO-A 40 to delivery 1 and WO-DEMO-B 60 to delivery 2. The preview shows A with
   no date conflict and B late. Save.
4. The PO shows two deliveries. The 40 has no identified date issue and the 60 shows late 60. The line
   still reads *Ordered 100 = Planned 100 + In transit 0 + Received 0*.
5. Add a follow-up on the 60-unit delivery. On the **Follow-ups** tab, complete it. Back on
   **Deliveries**, B is still late 60, because completing a task never changes dates or clears risk.
6. Refresh the page (a direct PO URL) and the changes persist. Use **Reset demo data** to restore the
   baseline.

The seed also includes these examples: arrival before production start, known late arrival, missing
expected arrival, arrival overdue with no receipt, follow-up due with an otherwise timely arrival
(PO-24107), an in-transit delivery with a carrier-sourced manual update (PO-24111), and received lines
shown read-only.

## Rules worth knowing

- Comparisons are on date-only `YYYY-MM-DD` strings, so results are the same in any browser timezone.
  History timestamps are UTC.
- *Late* means the expected arrival is later than the linked production start. Arriving on the start
  date is not flagged. Receiving and inspection time are not modeled, and the UI says so.
- An unknown date is never treated as on time. Received deliveries carry no active date alerts.
- Each delivery-to-work-order link is evaluated separately. Work-order totals show late and unknown
  quantities separately.
- Attention order is: date conflict, arrival overdue, date unknown, follow-up due, no identified date
  issue. Within each group, rows are sorted by earliest affected production start, with unknown starts
  last. This is a simple demo ordering rule, not an optimized priority.
- Every mutation uses a version precondition and runs in one transaction. Stale or repeated submits
  get HTTP 409 and change nothing. Only planned deliveries can be split. A split keeps the original
  row (superseded) for history and moves open delivery-level follow-ups to the PO level.

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
