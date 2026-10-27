# CLAUDE.md

Supplier delivery tracking prototype for a fictional interview case. Read `docs/PRD.md` (scope, rules, demo)
and `docs/ARCHITECTURE.md` (stack, persistence, deployment). They are the authority. Do not duplicate them here.

## Scope guardrails
- Each PO has exactly one work order (`purchase_orders.work_order_id`); items and deliveries inherit it.
  Do not reintroduce work-order allocation tables or split allocation grids.
- Two views only: Incoming items and PO detail (Deliveries / Follow-ups), plus the Automation demo page (`/demo-scenarios`)
  (simulation controls only, linked beside Incoming items). No separate work-order, supplier, task, inventory, or dashboard modules.
- Excluded: PO creation/approval, sourcing, replenishment, capacity, receiving/QA, inventory, freight,
  scheduling, real email sending, live AI extraction, live integrations, adaptive cadence, accounts/roles, KPI charts.
  Supplier replies and carrier events are deterministic fixtures labeled as simulated; never fabricate extraction.
- Synthetic data only. Do not invent research, user validation, or business results.

## Where things live
- `shared/impact.ts`: physical date risk. `shared/issues.ts`: the issue transition rule. `shared/arrivals.ts`:
  item-table ordering and cumulative quantities. All pure and server-authoritative.
- Issues (buyer action) and reminders (follow_ups) are independent; neither changes the other or Last update.
  Call tasks are likewise independent of issues, and automation never resolves an issue.
- `shared/outreach.ts`: outreach eligibility. `shared/clock.ts`: demo clock and business days.
  `shared/incomingFilters.ts`: Incoming views/filters and URL state. `server/simulation/fixtures.ts`: fixtures;
  expected effects in `tests/simulation-expected.ts`.
- `shared/labels.ts`: user-facing vocabulary. `shared/schemas.ts`: request validation.
- `server/services/`: mutations (transactional, version-checked). `server/routes/api.ts`: thin routes.
- `server/db/migrations/`: numbered SQL. `server/db/seed.ts`: deterministic seed and integrity checks.

## Commands
`npm run dev` · `npm run build` · `npm start` · `npm test` · `npm run test:e2e` (after build) · `npm run db:reset`

## Working style
Make small, targeted changes. No unrelated refactors, new frameworks, or speculative abstractions. Run the
affected tests and finish with `npm run build`. Record checks actually run in `docs/test-log.md`.

## Live demo mode
When I say "demo mode":
- Make the smallest change that delivers the request. One concern per prompt. No refactors, renames, or new files unless asked.
- Don't ask clarifying questions; pick the obvious reading, then say in one line what you assumed.
- Prefer changes in `shared/labels.ts`, client components, and fixtures. Don't touch migrations,
  `shared/issues.ts`, `shared/impact.ts`, or `server/services/` unless the request requires it, and say so first if it does.
- No new dependencies, no schema changes, no `db:reset` unless I ask.
- Verify with `npm run typecheck` plus the single relevant test file (e.g. `npx vitest run tests/api.test.ts`).
  Skip `npm run build`, e2e, and `docs/test-log.md` during the demo.
- Reply in 2–3 lines: what changed, which file, and what was checked.