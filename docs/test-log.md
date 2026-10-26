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

## Pending

- Railway deployment has not been done. The local Railway CLI session is logged out. Still to verify:
  live URL, healthcheck, demo flow, and persistence across a Railway redeploy.
