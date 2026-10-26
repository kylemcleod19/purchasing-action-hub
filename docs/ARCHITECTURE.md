# Architecture and Repo Bootstrap
Date: October 26, 2026
Companion: PRD.md
Status: Recommended defaults; Railway hosting is the user's requirement

## 1. Architecture decision
Start a new repository. Build one TypeScript application: React/Vite frontend, Express API, and SQLite persistence. In production, Express serves both the built frontend and API from one Railway service. Use one Railway persistent volume for SQLite.

This is a small shared interview demo, not a scalable enterprise platform. One process, one database file, and one deployment keep local development and edits straightforward. SQLite is a deliberate prototype trade-off: one replica, brief deployment downtime acceptable, no distributed writes. Postgres can replace persistence later if needed; do not build that migration now.

Do not require the old repo, ERPForge, Supabase, Vercel, external AI keys, Redis, queues, microservices, or a monorepo toolchain.

## 2. Suggested tools
- Node.js supported LTS release, pinned in package.json engines and Docker image; choose a compatible version during setup.
- npm and one committed package-lock.json.
- React + TypeScript + Vite; React Router for the two pages.
- Express + TypeScript, compiled for production.
- better-sqlite3 with parameterized SQL and a few ordered SQL migrations. Enable foreign keys; use transactions and a busy timeout.
- Zod for request validation.
- Plain CSS or CSS modules with a small shared component set. Do not install a large UI system merely to render tables/forms.
- Vitest for calculations and mutation rules; Playwright for one core browser flow.

Resolve compatible stable versions once, commit the lockfile, and avoid unrelated upgrades during iteration. Verify native SQLite installation both locally and in the Linux deployment build.

## 3. Repository structure
Use one package.json and one repo, with these directories:
- docs/PRD.md and docs/ARCHITECTURE.md: implementation authority.
- client/: React app, pages, reusable table/form components, API client.
- server/: Express entry, routes, database setup, mutation services.
- server/db/migrations/: numbered SQL migrations.
- server/db/seed.ts: deterministic synthetic data.
- shared/: small DTO types, schemas, pure date/impact functions.
- tests/: targeted domain/integration tests and one browser flow.
- data/: local SQLite file; gitignored.
- Dockerfile, .dockerignore, .env.example, README.md, CLAUDE.md.

Keep route handlers thin and put date-impact calculations in one tested function. Do not create generic repository frameworks, plugin systems, or speculative abstraction layers.

CLAUDE.md should briefly point to the two documents, state exclusions, list commands, and instruct the agent to make small changes without unrelated refactors. No duplication of the entire PRD.

## 4. Minimal database
Use IDs and foreign keys, plus timestamps where needed:
| Table | Core fields |
|---|---|
| suppliers | id, name |
| warehouses | id, name |
| work_orders | id, number, program, warehouse_id, production_start |
| purchase_orders | id, number, supplier_id, warehouse_id, buyer, status |
| po_lines | id, po_id, part_number, description, unit, ordered_qty |
| work_order_links | id, po_line_id, work_order_id, quantity |
| deliveries | id, po_line_id, quantity, state, expected_arrival nullable, source, updated_at, version, superseded_at nullable |
| delivery_links | delivery_id, work_order_link_id, quantity |
| follow_ups | id, po_id, delivery_id nullable, due_date, note, state, completion_note, completed_at, version |
| change_history | id, po_id, delivery_id nullable, event_type, before_json, after_json, source, note, created_at |
| app_metadata | key, value (schema/seed version and demo reference date) |

work_order_links are seeded upstream commitments; no editing API. delivery_links distribute those fixed quantities across dated deliveries. Verify matching PO line on every link. Keep superseded delivery rows for history, but exclude them from current totals.

On split, transactionally supersede the original, create child deliveries and links, reattach any open delivery-level follow-ups to the PO level with original context preserved, and append history. Do not delete historical follow-ups.

Use a version precondition on each mutation; return HTTP 409 for stale edits. A split can only consume an active source row once. Reset is transactional and explicitly initiated; it is never part of normal startup.

## 5. API shape
A compact JSON API is enough:
- GET /api/incoming: current delivery rows, calculated attention, follow-up summaries.
- GET /api/purchase-orders/:id: detail, work-order impacts, history, tasks.
- PATCH /api/deliveries/:id: arrival/source/note and expected version.
- POST /api/deliveries/:id/split: child quantities/dates/link distributions and expected version.
- POST /api/purchase-orders/:id/follow-ups
- PATCH /api/follow-ups/:id: edit/complete with expected version.
- POST /api/demo/reset: reset confirmation, available only in DEMO_MODE.
- GET /api/health: return 200 only after migrations, initial seed, and database readiness.

Server validates every mutation and computes authoritative impacts. Client previews may reuse shared pure functions, but must not be the only validation. Return consistent JSON errors and useful field messages. Unknown API routes return JSON 404, never index.html.

After a save, reload the relevant incoming/detail data. A small fetch wrapper and React state are sufficient; do not add a global state framework unless an actual need emerges.

## 6. Local setup contract
Make these commands work:
- npm ci: install locked dependencies.
- npm run dev: run Vite and API together, with Vite proxying /api to localhost.
- npm run build: type-check and compile client to dist/client and server to dist/server.
- npm start: run compiled server, initialize persistence, serve static client.
- npm test: targeted unit/integration tests using a temporary database.
- npm run test:e2e: core browser test with isolated test data.
- npm run db:reset: explicit local reset, refusing production unless deliberately enabled.

Use portable scripts that work on Windows as well as Linux. No Bash-only environment assignments in npm scripts. Document prerequisite Node version. Docker is for deployment; do not require Docker for local development.

Example environment:
PORT=3000
DATABASE_PATH=./data/demo.sqlite
DEMO_MODE=true
NODE_ENV=development

Never commit .env, database files, WAL/SHM files, node_modules, dist, credentials, or browser-test artifacts.

## 7. Production serving
Express listens on 0.0.0.0 and Number(process.env.PORT || 3000).
Serve /api routes first, static assets second, and an SPA fallback for non-API GET page requests last. Use the route syntax supported by the installed Express version. Refreshing /purchase-orders/:id must load correctly.

Provide a Dockerfile with a compatible pinned Node LTS base, npm ci, build, and a runtime containing compiled output, runtime dependencies, and migration/seed assets. If the SQLite native module needs compilation, install build tooling in the build stage and ensure runtime compatibility. Do not accidentally exclude migrations from the image.

Start sequence:
1. Resolve DATABASE_PATH, create its parent directory if needed.
2. Open database and apply outstanding migrations.
3. Seed only an uninitialized database, using a metadata marker.
4. Start listening after initialization succeeds.

Fail startup clearly if database initialization fails. Do not fall back to an ephemeral database silently. Close the database on shutdown.

## 8. Railway setup
Deploy the Dockerfile from the new GitHub repo to one Railway app service:
1. Connect the repository and select the intended branch.
2. Attach a persistent volume mounted at /data.
3. Set DATABASE_PATH=/data/demo.sqlite, NODE_ENV=production, DEMO_MODE=true.
4. Let Railway provide PORT; bind to 0.0.0.0.
5. Use npm start as container startup; Docker build performs npm run build.
6. Configure healthcheck path /api/health and generate a public Railway domain.
7. Keep one replica and one region. Do not enable horizontal replicas for this SQLite architecture.

Initialize/migrate SQLite during startup, not image build or pre-deploy: Railway mounts volumes at runtime. The volume must hold the database and any associated WAL/SHM files.

The domain and volume are Railway resources, not things a repository file alone guarantees. README must distinguish repo configuration from platform steps. Use authenticated Railway tools if available in Kyle's environment; otherwise supply exact manual steps and state what remains unverified. Do not claim deployment without checking the URL.

Official references checked October 26, 2026:
- https://docs.railway.com/guides/express
- https://docs.railway.com/volumes

Recheck platform instructions if deployment behavior differs.

## 9. Demo boundaries
This is a public synthetic-data demo with shared state and no account system. State that visibly. Do not put confidential data in it. Reset requires confirmation, and must not be implemented as a GET route.
No emails, orders, or external messages are sent. Escape user notes as text. Use parameterized SQL, request validation, bounded request sizes, and normal same-origin API access; avoid building enterprise authentication or permission infrastructure.

## 10. Verification and credit discipline
Implement in the PRD's order. Work in small slices; run affected tests plus a final production build rather than rebuilding the whole app after every text edit. Avoid broad rewrites or re-reading the old project. Use concise completion summaries: changed files, checks, remaining issue.

Required checks:
- Core date/quantity rules and failed/stale transaction behavior.
- One browser path covering arrival update, split, and retained risk after follow-up.
- Direct PO URL refresh in production serving.
- Restart persistence; after Railway deployment, redeploy persistence as well.
- Confirm seed does not run again on restart.
- Confirm reset restores the known demo baseline.

Keep rule functions and display labels easy to locate for live interview modifications. Do not write exhaustive UI snapshot suites or test trivial styling. Record tests actually run and any deployment checks still pending.

## 11. First instruction to Claude
Read docs/PRD.md and docs/ARCHITECTURE.md. Initialize this fresh repository using the recommended defaults. First provide a short implementation sequence, then implement the first working slice: persisted seed data, Incoming items, and PO detail. Continue through the specified slices without adding workflows. Keep the old project's requirements out of this repo. Finish with build/test results and Railway setup status. Ask only when a material product decision blocks progress.

