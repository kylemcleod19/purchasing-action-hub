# CLAUDE.md

Supplier delivery tracking prototype for a fictional interview case. Read `docs/PRD.md` (scope, rules, demo)
and `docs/ARCHITECTURE.md` (stack, persistence, deployment). They are the authority. Do not duplicate them here.

## Scope guardrails
- Two views only: Incoming items and PO detail (Deliveries / Follow-ups). No separate work-order, supplier,
  task, inventory, or dashboard modules.
- Excluded: PO creation/approval, sourcing, replenishment, capacity, receiving/QA, inventory, freight,
  scheduling, notifications/emails, AI extraction, live integrations, accounts/roles, KPI charts.
- Synthetic data only. Do not invent research, user validation, or business results.

## Where things live
- `shared/impact.ts`: date-impact and attention rules (single source; server-authoritative).
- `shared/labels.ts`: user-facing vocabulary. `shared/schemas.ts`: request validation.
- `server/services/`: mutations (transactional, version-checked). `server/routes/api.ts`: thin routes.
- `server/db/migrations/`: numbered SQL. `server/db/seed.ts`: deterministic seed and integrity checks.

## Commands
`npm run dev` · `npm run build` · `npm start` · `npm test` · `npm run test:e2e` (after build) · `npm run db:reset`

## Working style
Make small, targeted changes. No unrelated refactors, new frameworks, or speculative abstractions. Run the
affected tests and finish with `npm run build`. Record checks actually run in `docs/test-log.md`.
