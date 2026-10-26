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

## Pending

- Railway deployment has not been done. The local Railway CLI session is logged out. Still to verify:
  live URL, healthcheck, demo flow, and persistence across a Railway redeploy.
