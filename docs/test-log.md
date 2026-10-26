# Test log

This is a factual record of checks that were actually run. Automated tests show that the software
behaves as specified. They do not validate buyer needs.

## 2026-10-26: initial implementation (local, Windows 11, Node 24.14.0)

| Check | Result |
|---|---|
| `npm run build` (server tsc, client tsc, vite build) | Pass |
| `npm test`: 29 Vitest tests (domain rules, seed shape, primary demo via API, stale/duplicate/invalid splits, in-transit/received split block, follow-up completion keeps risk, restart without reseed, reset baseline, JSON 404, health) | 29 passed |
| Date-only helpers give identical results under TZ=Pacific/Kiritimati, America/Los_Angeles, Pacific/Pago_Pago | Pass (in `npm test`) |
| `npm run test:e2e`: Playwright (Chromium) against the production build with an isolated DB covering arrival update → split → add and complete follow-up → B still late 60 → reload of the direct PO URL | 1 passed |
| `npm run dev`: Vite proxy `/api/health` and `/purchase-orders/6` page route | 200 / 200 |
| `npm run db:reset` locally; the same command with `NODE_ENV=production` | Reset; refused as intended |
| `docker build` of the Dockerfile (Linux, better-sqlite3 native module) | Built |
| Container with volume at `/data`, `PORT=18431`: `/api/health`, direct `/purchase-orders/6`, `/api/missing` | 200 JSON / 200 HTML / 404 JSON |
| Arrival edit, then `docker restart`: edit kept, log says "existing data kept" (no reseed) | Pass |
| Container removed and recreated on the same volume (simulated redeploy): edit kept | Pass |

## 2026-10-26: v2 alignment with the updated PRD/ARCHITECTURE (single work order per PO)

| Check | Result |
|---|---|
| `npm run build` | Pass |
| `npm test`: 33 Vitest tests, adding coverage for the 20-WO/25-PO seed shape (5 WOs with two POs), no allocation tables, rows inheriting the PO work order and start, blank-note arrival update, split deliveries keeping PO item and work order, follow-up completion not changing Last update, and the v1→v2 migration (resets once, later edits persist) | 33 passed |
| Migration 002 on a copy of the real local v1 database (40 WOs, 130 links, edits): migrated to 20 WOs / 25 POs / 80 lines; second start did not reseed | Pass |
| `npm run test:e2e`, test 1: primary demo with adjacent Expected arrival / Production start columns, a blank note, source icons, header work order and start, split with no allocation UI, item totals in columns, Last update unchanged by follow-up, state filter empty state and preserved filter after reload | Pass |
| `npm run test:e2e`, test 2: a 10-item PO renders as one table with 10 rows, Enter-key expansion with `aria-expanded`, and multiple rows open at once | Pass |
| `docker build`: image contains `001_init.sql` and `002_po_single_work_order.sql`; a fresh volume seeds the v2 baseline; health 200; direct PO URL 200 | Pass |

## 2026-10-26: v3 alignment (required dock dates, delivery issues, inline resolution, item table)

| Check | Result |
|---|---|
| `npm run build` | Pass |
| `npm test`: 38 Vitest tests. Pure rules: late vs production conflict vs overdue vs unknown, equal dates not flagged, Date restored validation, issue transitions (open, retain, no reopen on identical/source-only/improved, reopen on later/unknown/new overdue), cumulative Shipped/Received (100 = 30 in transit + 20 received + 50 not shipped → Shipped 50, Received 20), arrival prioritization, row ordering, timezone independence. API: seed counts, supplier catalog coherence, inherited work order, seeded issue scenarios, no issue creation on reads/restart, full primary demo, blank notes, Save changes vs Save and resolve, Date restored rejections leave state unchanged, accepted lateness stays Late, stale/wrong issue and delivery versions (409), split transfer to children with unrelated issues untouched, duplicate/stale splits, blocked in-transit/received splits and received updates, reminder completion not touching issues or Last update, migration 003 on v2 data | 38 passed |
| `npm run test:e2e`, test 1: primary demo in the browser: adjacent Required dock / Expected arrival / Production start, blank-note Save changes opens an issue with accessible late and conflict icons, split with Save and resolve in one form, Ordered/Shipped/Received columns and stacked arrivals with quantities, a worse date reopens and Accept delay resolves inline, reminder completion leaves Last update unchanged, combined filters with empty states, filters kept after reload, accepted delay in Late but not Needs action | Pass |
| `npm run test:e2e`, test 2: 10-item PO as one table, arrivals capped at two with `+1`, open-issue count covering a hidden delivery, Enter-key expansion with `aria-expanded`, several items open | Pass |
| Migration 003 on the real local v2 preview database (backup kept at `.tmp/preview-v2-backup.sqlite`): data kept, 27 issues initialized once, dock dates fall back to production start, banner flags the older seed | Pass |
| `docker build`: image contains migrations 001 to 003; a fresh volume seeds v3 (`seedVersion` 3); health 200; direct PO URL 200; restart keeps data with no reseed | Pass |

## 2026-10-26: clearer flags and row tints (UI only)

| Check | Result |
|---|---|
| Overdue uses its own clock icon (not the late triangle); the Issue column shows one labeled icon per reason | Browser test passes: an overdue-before-dock row has two "Overdue" icons and no "Late" icon |
| Row tints: past production start uses `row-conflict` (light red); past required dock only uses `row-late` (very light red); applied to Incoming rows, PO delivery rows, and PO item rows (worst shown delivery) | Browser test passes: demo row, accepted 60-unit child, and item row are `row-conflict`; on-time 40 and overdue-only rows are untinted; PO-24108 is `row-late` |
| `npm test` / `npm run test:e2e` / `npm run build` | 38 passed / 2 passed / pass |

## 2026-10-26: in-transit icon and item-level actions (UI only)

| Check | Result |
|---|---|
| Package icon (label "In transit") beside in-transit dates in the PO Arrivals stack and delivery table | Browser test passes |
| Resolve / Update arrival / Split always on the item row when any delivery qualifies; with several candidates, a Delivery selector (most urgent first) picks the target and switching it reloads the form | Browser test passes: three-delivery item shows all three buttons; picker lists 3 deliveries; changing it updates the form |
| `npm test` / `npm run test:e2e` / `npm run build` | 38 passed / 2 passed / pass |

## 2026-10-26: v4 alignment (Manage deliveries modal, filters, seeded tracking, Case A/B simulation)

| Check | Result |
|---|---|
| `npm run typecheck` and `npm run build` | Pass |
| `npm test`: 65 Vitest tests. New pure-rule tests: 50% elapsed boundary, invalid and missing creation-to-dock intervals, overdue items still eligible, exactly-three-business-days staleness, received/tracked/awaiting exclusions with an untouched unshipped remainder, 20-line cap keeping a line's deliveries together, ranking, America/Chicago local dates, Friday→Monday deadline across the Nov 1 DST change, business-day counts, Destination/Program OR-within/AND-across, view counts without the view, URL round-trip with encoding, unknown filter values dropped | 12 passed |
| New API tests (`tests/simulation.test.ts`): every shipped/received row linked to one shipment, exactly one untracked dispatch, SH-DEMO-01 shared by three rows on two POs, one item with two tracking numbers; Case A preview is read-only, 8 eligible and 4 excluded as expected, second same-day send refused, partial reply matches `tests/simulation-expected.ts` (6 applied, 1 review, 1 not mentioned, issues and Last update per item), automated history attributed to simulated automation with source links, duplicate reply is a no-op, deadline creates one call task with 2 items visible from both POs, repeated clock moves merge instead of duplicating, clarifying reply closes the unstarted task and leaves late issues open; stale reply held after a buyer edit while other rows apply; started task stays with the buyer; past-date confirmation shows overdue; Case B delay updates exactly 3 rows with the remainder and totals unchanged, replay and older events change nothing, accepted delay reopens on a later ETA without duplicate open issues, buyer override held for review, equal-time conflict held, Delivered blocked until the clock reaches it and then recorded without receipt or resolution; forward-only clock, reads create nothing, restart keeps the clock, reset clears simulation tables, simulation routes 404 without DEMO_MODE | 15 passed |
| Existing tests (seed shape, primary demo via API, issue rules, splits, reminders, migration on v2 data, now including migration 004 leaving fixtures uninstalled with simulation routes answering 409) | 38 passed |
| `npm run test:e2e` (5 Playwright tests, Chromium, production build): (1) primary demo through the shared modal: no Issue column, one Manage deliveries button per row, blue/flag while open and white after an accepted late split, accept without changing Last update, collapsed history that stays open across saves, back link and reload keep Incoming view and search; (2) item entry selects the first open issue, incoming entry selects its exact delivery, count of 3 includes a delivery hidden behind `+1`, dirty-input confirm on switching, Reviewed / no further action for an unknown date, Cancel returns focus, received row opens read-only; (3) seeded tracking (shared DEMO-TRACK-001, two numbers on a split item, em dashes for not shipped, "Tracking unavailable", no links), Destination and Program line multi-selects with URL round-trip and stale values ignored, no-results clear, overdue-only and late-only tints; (4) Case A walkthrough in the drawer; (5) Case B walkthrough in the drawer, then PO detail shows Delivered / receipt pending with Received 0 | 5 passed |
| Migration 004 on a copy of the real local database (v2 seed with migration 003 applied): 91 deliveries kept, no reseed, fixtures not installed (banner shows the reset notice) | Pass |
| Screenshots of Incoming items, the modal, PO detail with tracking, and the drawer after a partial reply, checked by eye at 1440×900 | Layout as intended |

Not run for this revision: `docker build`, container restart and redeploy persistence, `npm run dev` proxy check.

## Pending

- Railway deployment has not been done. The local Railway CLI session is logged out. Still to verify:
  live URL, healthcheck, demo flow, and persistence across a Railway redeploy.
