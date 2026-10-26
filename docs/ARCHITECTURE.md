# Architecture and Repo Bootstrap
Date: October 26, 2026
Companion: PRD.md
Status: Recommended defaults; Railway hosting is the user's requirement
Revision: Shared delivery modal, query filters, and full tracking seed — October 26, 2026

## 1. Architecture decision
For an existing implementation, update in place and preserve its Railway setup. Scaffold a new repository only if none exists. Use one TypeScript application: React/Vite frontend, Express API, and SQLite persistence. In production, Express serves both the built frontend and API from one Railway service. Use one Railway persistent volume for SQLite.

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
| purchase_orders | id, number, supplier_id, warehouse_id, work_order_id NOT NULL, buyer, status, created_date |
| po_lines | id, po_id, part_number, description, unit, ordered_qty, required_dock_date NOT NULL |
| deliveries | id, po_line_id, quantity, state, expected_arrival nullable, source, arrival_updated_at, received_at nullable, parent_delivery_id nullable, version, superseded_at nullable |
| delivery_issues | id, delivery_id, state (open/resolved/superseded), reasons_json, opened_at, resolved_at nullable, resolved_by nullable, outcome nullable, note nullable, reviewed_facts_json nullable, previous_issue_id nullable, parent_issue_id nullable, version |
| follow_ups | id, po_id, delivery_id nullable, due_date, note, state, completion_note, completed_at, version |
| change_history | id, po_id, delivery_id nullable, event_type, before_json, after_json, source, note, created_at |
| app_metadata | key, value (schema/seed version and demo reference date) |

Each purchase_order has one required work_order_id foreign key. Multiple POs may reference the same work order. All PO items and deliveries inherit this relationship through the PO; do not create work_order_links or delivery_links allocation tables. Verify PO and work order warehouse consistency. Seed 20 work orders for 25 POs as specified in PRD.md. Keep superseded deliveries for history but exclude them from current totals. API responses include work-order number and production_start for the PO and each incoming row.

Delivery state enum can remain planned/in_transit/received internally; display planned as Not shipped. Store actual received date for seeded received rows. Require required_dock_date <= production_start in this demo. Dates remain independent of current estimates.

On split, transactionally supersede the original, create children with parent_delivery_id under the same PO item, apply the issue inheritance/disposition rules in PRD section 7, move open delivery-level follow-ups to the PO level with their original context retained, and append history. Do not delete historical issues or follow-ups.

Add a partial unique index for one open issue per delivery. Keep resolved rows as history; reopening creates a new row rather than overwriting a resolution. reviewed_facts_json captures expected arrival, state, quantity, required dock, production start, evaluated risk reasons, and demo date at disposition. Store explicit arrival_updated_at separately from row/version changes, issue resolution, and follow-up events.

Use one shared pure function for physical risk and one explicit issue transition function. Physical risk is derived; issue disposition is persisted. Issue transitions run during mutations, initial seed, or an explicit reconciliation when upstream facts/demo date change. GET endpoints must not manufacture issues. Demo time advances only via explicit simulation controls; advancing time reconciles newly overdue conditions and due call tasks once. Normal browsing/restarts never advance time. No background scheduler or live connector is needed.

A later estimate, known-to-unknown transition, or newly active risk reason opens a new issue after resolution. Identical facts, notes/source-only edits, and improved dates with the same accepted risks do not reopen it. Save changes retains any existing open issue even when physical risk clears. The server validates Date restored against required dock/overdue rules. See PRD for split child issue behavior; do not merely copy an open parent ID to multiple children.

Use a version precondition on each mutation; return HTTP 409 for stale edits. A split can only consume an active source row once. Reset is transactional and explicitly initiated; it is never part of normal startup.

## 5. API shape
A compact JSON API is enough:
- GET /api/incoming: current delivery rows, calculated attention, follow-up summaries.
- GET /api/purchase-orders/:id: detail, work-order impacts, history, tasks.
- PATCH /api/deliveries/:id: arrival/source/optional note, expected delivery version, optional resolution payload and expected issue version.
- POST /api/deliveries/:id/split: child quantities/dates, source/optional note, expected delivery version, optional resolution payload and expected issue version.
- POST /api/deliveries/:id/resolve: current issue ID, expected issue and delivery versions, outcome, optional note; no date change required.
- POST /api/purchase-orders/:id/follow-ups
- PATCH /api/follow-ups/:id: edit/complete with expected version.
- POST /api/demo/reset: reset confirmation, available only in DEMO_MODE.
- GET /api/health: return 200 only after migrations, initial seed, and database readiness.

Arrival/split requests use an explicit optional resolve object containing issue_id, expected_issue_version, outcome, and optional note. Absence means Save changes. Resolve must target the exact open issue, not “whatever is current.” Use the PO buyer as the documented demo actor on the server. Return 409 for stale issue/delivery state and 422 for invalid outcomes or quantities.

Within one database transaction: check versions, validate proposed changes, write deliveries, evaluate physical risk and issue transitions, apply requested disposition (including split child dispositions), and write history. Return updated rows/issue summaries; never issue separate client-side save and resolve requests for the combined action. Failure rolls back everything. Version checks and the active-parent constraint make repeated requests safe.

API DTOs expose required dock date, expected arrival, received date, production start, arrival-update source/time, physical risk flags/days, and current open issue separately. Item DTOs expose ordered_qty, shipped_qty (in-transit plus received), received_qty, and open_issue_count. Never derive Needs action solely from lateness. Filters for physical Late and open Needs action are independent. Use consistent full totals and matching delivery subsets across both pages.

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
Read docs/PRD.md and docs/ARCHITECTURE.md. Inspect the existing app and implement the changes in small slices without rebuilding working infrastructure. If the repository is empty, scaffold the recommended defaults. Prioritize schema migration, shared risk/issue rules, table presentation, and atomic inline resolution. Continue through the specified slices without adding workflows. Keep the old project's requirements out of this repo. Finish with build/test results and Railway setup status. Ask only when a material product decision blocks progress.


## 12. Existing implementation alignment
If the initial multi-work-order schema has already been built, replace its allocation joins/UI with the single required PO work_order_id relationship. For this synthetic demo, use an explicit versioned demo-data migration/reset with the changed seed; do not arbitrarily pick a work order from conflicting legacy links or silently discard edits at every startup. Document the one-time reset. Preserve Railway configuration and unrelated working features.

## 13. Migration and focused verification for this revision
No new service, queue, AI dependency, or deployment architecture is required. Section 14 extends this same service with deterministic demo event processing. Preserve React/Express/SQLite and the Railway volume. This revision changes schema, domain rules, API payloads, and table/form presentation.

Use an ordered migration to add required dock dates, received dates, issue history, delivery lineage, and separate arrival timestamps. Existing required dock dates must come from seed/upstream facts; never use a changed expected arrival as the baseline silently. For synthetic legacy records without a baseline, document a one-time fallback to production start, or offer the explicitly confirmed updated-seed reset. Do not reset on every startup. Historical received dates must not be invented; use an unknown-date display for legacy records until explicit reseed supplies them. Backfill arrival timestamps from arrival history where available, not from follow-up completion.

Initialize issue rows once for existing outstanding exceptions; a migration marker and unique-open constraint prevent duplicates. Preserve existing edits and history unless Kyle explicitly resets the demo. Do not infer previous buyer acceptance from a completed reminder. Keep independent issue and follow-up tables.

Test shared risk/quantity calculations, transitions after resolution, atomic save-and-resolve and split dispositions, stale issue/delivery guards, and filtered table totals. Extend the core browser scenario to prove accepted lateness remains visible, a worse date reopens an issue, and the buyer can resolve it without visiting Follow-ups. Validate native SQLite/build and persistence using existing checks; avoid unrelated framework upgrades.

## 14. Supplier and carrier simulation implementation
### Architecture boundary
Retain the single Railway service, SQLite volume, and current frontend. Do not install email, carrier, LLM, queue, or training infrastructure. Implement deterministic fixtures behind a small source-adapter interface. Fixture adapters return explicit structured outputs and raw source text; they do not pretend to parse arbitrary emails. Show “Simulated AI reply processing” in the UI. Unknown fixtures/text cannot receive fabricated extracted results.

This is a working workflow demonstration with real persisted mutations, not a static mockup. A future real extractor can implement the same interface; its output must still pass domain validation. No provider selection or live deployment changes are necessary for these scenarios.

### Minimal additive data model
| Table/change | Fields and purpose |
|---|---|
| purchase_orders.created_date | Date-only creation date, required for elapsed-fraction eligibility |
| deliveries.last_supplier_confirmation_at | Substantive supplier confirmation time, distinct from outgoing messages and generic row updates |
| shipments | id, supplier_id, warehouse_id, carrier, tracking_number, tracking_usable, carrier_status, expected_arrival nullable, carrier_delivered_at nullable, latest_event_at, version |
| shipment_deliveries | shipment_id, delivery_id UNIQUE; each linked delivery row is its entire shipped quantity |
| outreach_requests | id, supplier_id, sent_at, response_due_at, state, demo_run_id, version |
| outreach_items | id, request_id, delivery_id, requested_qty, po_line_id, expected_arrival_snapshot, delivery_version_snapshot, response_state, answered_at nullable |
| supplier_messages | id, request_id, external_message_id UNIQUE, direction, body, sent_or_received_at, processing_state, fixture_key |
| message_results | id, message_id, outreach_item_id nullable, classification, proposed_date nullable, proposed_qty nullable, evidence_text, expected_delivery_version, applied_at nullable, review_reason nullable |
| call_tasks | id, request_id UNIQUE, buyer, state (open/in_progress/completed/answered), created_at, due_at, completed_at nullable, version |
| call_task_items | task_id, outreach_item_id UNIQUE, response_state; joins preserve cross-PO visibility |
| carrier_events | id, shipment_id, external_event_id UNIQUE, occurred_at, received_at, payload_json, applied_state, ignored_reason |
| app_metadata additions | demo_clock timestamp, scenario anchor(s), initial cadence settings, fixture version |

Keep the existing follow_ups table for manual reminders. Call tasks are a narrow system-generated request follow-up with linked items; expose both through the existing Follow-ups UI, not a new task application. Existing delivery_issues represent timing-risk actions. Source linkage in change_history should identify message/result or carrier event plus actor_type (buyer/simulated_automation), rather than attributing automated changes to the PO buyer.

A shipment may contain multiple PO lines across POs for the same supplier/destination. Each delivery row belongs to at most one shipment, representing its complete quantity. Split partial dispatched quantities into explicit delivery portions in the seed before linkage (30 shipped + 20 not shipped); never link a 50-unit row and then update only 30 through an implicit allocation. Several shipments for one PO item use separate delivery rows. Do not change the one-work-order-per-PO relationship or introduce inventory allocation tables.

### Selection and clock services
Implement pure selectOutreachCandidates(data, clock, settings) using PRD section 13 rules. Cap distinct PO item lines at 20, while retaining delivery-specific requested quantities. Exclusions apply by quantity/delivery. Transactionally recheck eligibility when simulating send, insert the request/message/items, and suppress repeat supplier sends on the same local date. Do not create requests on a GET.

Use a single persisted simulated timestamp in America/Chicago presentation; UTC for storage. Date comparisons derive the local date from that timestamp. Business-day arithmetic skips weekends only and preserves local wall-clock send time, including timezone offset changes. Initial defaults: 3 business days without substantive update; 1 business day response window; 50% elapsed; cap 20. The last two remain fixed bounds unless the user changes policy. Adaptive learning is not implemented.

Advance-clock accepts a forward timestamp only. It runs overdue reconciliation and deadline escalation in a transaction. Task uniqueness by request and issue uniqueness per delivery make repeat reconciliation idempotent. Normal restart never moves the clock. Initial requests/events use the scenario anchor, and Case B Delivered can only apply when clock is at least its event time. Document whether switching cases requires reset; choose the simplest explicit behavior rather than silently rewinding dates.

### Reply-processing contract
Fixture result types: confirmed_arrival, revised_arrival, ambiguous, unmatched, proposed_split, or missing. Results carry message ID, requested item/delivery ID, date type (arrival/ship/unknown), quantity, supporting source text, and captured delivery version. The request supplier/thread must match the referenced PO supplier. Do not match solely on part number or trust a supplier-provided arbitrary PO ID.

Only confirmed/revised arrivals with exact delivery/quantity/date matches can auto-apply. For unchanged confirmations refresh arrival_updated_at and last_supplier_confirmation_at, retaining source=email. Automated changes never invoke resolve. Existing open issues remain open even if dates improve. Late/overdue/production-conflicting updates create or update delivery_issues using existing shared logic.

If a buyer or newer source changed a delivery after request capture, hold that result for review rather than overwriting it. Other independent valid rows can still apply. Pre-classify results, then transactionally persist the message, all result classifications, valid updates/history, and review-task changes. Unique external message IDs prevent reapplication. A failed transaction leaves no partial receipt of the same processing operation.

Mark unanswered/ambiguous request items separately from answered ones. Quote-only content, signatures, relative ship dates, or “checking” statements do not confirm an arrival. Fixture handling must exhibit these distinctions without claiming general NLP capability. A proposed split is review-only. Clarifying replies must bind to current item/delivery versions, not reuse an obsolete extraction snapshot.

Use one call task per request; merge unresolved items instead of duplicating tasks. A clear reply can remove an item from outstanding call work. Automatically mark an unstarted task answered only when all items are answered; retain in-progress tasks for buyer completion. Never resolve timing issues merely because a response arrived or a call task closed.

### Carrier-processing contract
Find a shipment using the known fixture mapping/carrier+tracking identity, then update only linked active deliveries. Validate supplier/destination consistency. Process all delivery updates, risk transitions, event receipt, and history atomically. A unique event ID prevents duplicate writes; an event older than latest_event_at is recorded as ignored, not applied. Equal-time conflicting events are held for review rather than arbitrarily winning. Newer events must also be newer than a linked delivery's last authoritative arrival update; a newer buyer override blocks automatic overwrite of that delivery and creates review work. A timestamp without an explicit ETA confirmation is not an arrival-information update.

Carrier ETA is authoritative for tracked in-transit quantities unless a newer buyer override requires review. Supplier replies on those quantities cannot silently replace it. If the carrier explicitly withdraws an ETA, set affected estimates unknown and create/update issues; omission of ETA from an ordinary status event does not withdraw it.

Delivered records carrier_delivered_at/status only. Do not set deliveries.state=received or received_at, increment received quantity, or clear issues. Display the separate carrier state; receipt pending is not evidence of missing material. Preserve the last estimate for audit and show carrier delivery timestamp in expansion. Routine supplier arrival requests stay suppressed for this shipment. Warehouse receipt reconciliation remains out of scope.

### API and UI additions
- GET /api/demo/scenarios: fixture choices, current clock, allowed next steps.
- GET /api/outreach/preview: eligible supplier/item rows and exclusion reasons; read-only.
- POST /api/demo/outreach/send: supplier/selected eligible IDs, current version/run token; creates a simulated outbound message only.
- POST /api/demo/supplier-replies/:fixtureId: processes the designated reply once.
- POST /api/demo/carrier-events/:fixtureId: processes the designated carrier event once.
- POST /api/demo/advance-clock: forward-only clock mutation and reconciliation.
- PATCH /api/call-tasks/:id: start/complete with version check.

Guard simulation mutations with DEMO_MODE and label all controls. Never expose arbitrary real recipient sending. Add correspondence, request-item state, linked task and shipment/event DTOs to existing PO detail endpoints. Reuse tables/accordion patterns; a compact demo drawer is sufficient. Show blocked/stale review results visibly, not only in logs. Persist simulated outbox and inbox bodies so the interviewer can compare source text to resulting records.

### Seed, migration, tests
Add schema migrations without destructive startup reset. Preserve existing manual edits. Full fixture scenarios are installed during explicit demo reset; on upgraded existing data, show a reset-required notice if the fixture version is missing. Do not silently add extra POs/items or attach fixtures to arbitrary records. Reset clears messages, processing receipts, tasks, events, issue changes, and clock, then restores the complete deterministic baseline.

Maintain synthetic supplier addresses under example.com and clearly fake tracking IDs. Generate literal dates in email bodies from the same scenario anchor as structured expected results. Capture fixtures and expected effects in separate files so tests can compare applied state to expected outcomes. Fixture playback passing is not evidence of extraction accuracy.

Add two browser paths for the PRD scenarios plus focused tests for eligibility, item cap, weekend deadline, stale/duplicate reply processing, one task per partial request, shared shipment propagation, duplicate/older events, buyer override protection, delivered-versus-received, and unchanged order totals. Keep existing quantity/issue tests. Document actual checks and simulation limitations in README.

## 15. Consolidated delivery UI and seeded tracking
Implement these changes in place; no Railway/service/database replacement is needed. PRD sections 6 and 14 govern presentation and seed requirements. Remove obsolete table-level Resolve/Update/Split controls instead of adding a second access path beside them.

### Shared client components
- ManageDeliveriesButton receives explicit scope (PO item or incoming delivery) and openIssueCount. Render blue with one flag only when count > 0; otherwise white outline. Received-only scope uses View deliveries. Keep accessible action-state labels separate from physical risk flags.
- ManageDeliveriesModal receives poLineId and optional initialDeliveryId. Use the incoming delivery ID exactly; item entry selects first open issue then first outstanding delivery. Fetch all item deliveries even when the table has filtered out siblings. Reuse existing validated update, split, and resolve endpoints; do not create a new mutation implementation for each page.
- Local modal modes: update, accept/review, split, and read-only view. Preserve existing atomic mutation contracts; acceptance calls resolve without PATCHing dates/source. Do not send placeholder unchanged-date updates just to resolve. A successful save refreshes incoming/detail caches and preserves context.
- DeliveryTrackingTable renders linked shipment carrier/tracking/status and each delivery’s quantity/state/date. Event history remains expandable. Operational table expansions are read-only; no repeated edit-button clusters. Remove Issue columns while retaining issue objects for button state and modal detail.
- HistoryDisclosure is collapsed on initial page entry; retain local expansion during refreshes, increment count after mutations, expose aria-expanded and keyboard activation. No database field is needed for this preference.

### Filtering and DTOs
Use the existing work_orders.program as Program line and purchase_orders.warehouse_id as Destination; no separate program-line table. Return full-dataset filter options plus warehouse/program identifiers on incoming DTOs. Given this small seed, client filtering is acceptable; if implemented on the server, use repeated destination/program query keys and parameterized SQL with validated values. Multiple values are OR within a dimension, AND across dimensions. View counts apply other filters but not the active view predicate.

Serialize multi-select filters, supplier/state, search, and view in URLSearchParams with proper encoding. Retain the incoming return URL when navigating to a PO and use it for the back link; preserve the existing item query parameter. Unknown filter values must not crash or silently select a different program. Include clearable no-results behavior.

Ensure PO-detail and incoming DTOs supply shipment ID, carrier, tracking number, carrier status, expected arrival, carrier-delivered time, and warehouse received time separately. Do not overload the existing delivery state enum with carrier Delivered. Open issue counts must use full item scope for item buttons and exact delivery scope for incoming buttons. No separate issue-state column is needed in the UI.

### Full seed generation
Use the shipments/shipment_deliveries schema from section 14, with nullable tracking_number for the intentional missing-tracking case and a unique (carrier, tracking_number) constraint when non-null. Every dispatched or received seed delivery is linked to exactly one shipment; unshipped deliveries have no link. Maintain the shipment-level shared identity for multi-item/cross-PO containers. Add dispatched_at where needed for coherent seeded timeline detail; carrier_events already stores event timestamps.

Generate deterministic shipment IDs and tracking numbers from stable seed order, preserving SH-DEMO-01/DEMO-TRACK-001. Reserve scenario fixtures first, then populate remaining shipped/received records, grouping only compatible supplier/destination records. Ensure at least one item spans two distinct tracked shipments and one spans tracked+unshipped portions. Keep exactly one in-transit shipment with null tracking and tracking_usable=false; all other shipped/received shipments have synthetic identifiers. Shared shipment links do not represent extra supply or extra ordered quantity.

Use explicit seed-version migration/reset; never overwrite user edits at routine startup. Existing installations without tracking seed should show the existing reset-required notice, and installation instructions should tell Kyle to use the confirmed reset once to load the revised synthetic dataset. Populate all tracking fixture data in the seed script rather than relying on clicking demo controls to create baseline tracking. Keep source-event playback effects unapplied at reset.

Validate unique shipment numbers, supplier/warehouse consistency, expected counts, received timeline ordering, exactly one missing-tracking shipment, shared shipment identity, and unchanged quantity totals. Add focused UI checks for single-button actions, late-but-resolved white button, exact modal selection, acceptance without timestamp edits, hidden-sibling issue counts, read-only received rows, tracking visibility, collapsed history, and filter/back/reload behavior. Do not build broad snapshot suites or change platform dependencies.
