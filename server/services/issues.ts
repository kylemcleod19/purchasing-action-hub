// Persisted delivery issues. Transitions run only inside mutations, seeding, or the one-time migration
// reconciliation; GET endpoints never create issues.
import type { DB } from '../db/db.js';
import { HttpError, notFound, stale } from '../errors.js';
import { meetsDateRestored, physicalRisk } from '../../shared/impact.js';
import { evaluateIssueTransition } from '../../shared/issues.js';
import { OUTCOME_LABELS } from '../../shared/labels.js';
import type { DeliveryFacts, DeliveryState, IssueReason, ResolutionOutcome, ReviewedFacts } from '../../shared/types.js';
import { addHistory } from './history.js';

export interface DeliveryRecord extends DeliveryFacts {
  id: number;
  poId: number;
  poLineId: number;
  buyer: string;
  source: string;
  version: number;
  supersededAt: string | null;
  parentDeliveryId: number | null;
}

export function loadDelivery(db: DB, id: number): DeliveryRecord {
  const row = db
    .prepare(
      `SELECT d.id, p.id AS poId, d.po_line_id AS poLineId, p.buyer, d.quantity, d.state,
              d.expected_arrival AS expectedArrival, l.required_dock_date AS requiredDock,
              wo.production_start AS productionStart, d.source, d.version, d.superseded_at AS supersededAt,
              d.parent_delivery_id AS parentDeliveryId
       FROM deliveries d
       JOIN po_lines l ON l.id = d.po_line_id
       JOIN purchase_orders p ON p.id = l.po_id
       JOIN work_orders wo ON wo.id = p.work_order_id
       WHERE d.id = ?`,
    )
    .get(id) as (DeliveryRecord & { state: DeliveryState }) | undefined;
  if (!row) throw notFound('Delivery');
  return row;
}

export interface IssueRecord {
  id: number;
  deliveryId: number;
  state: 'open' | 'resolved' | 'superseded';
  reasons: IssueReason[];
  version: number;
}

export function getOpenIssue(db: DB, deliveryId: number): IssueRecord | null {
  const row = db
    .prepare(
      `SELECT id, delivery_id AS deliveryId, state, reasons_json, version
       FROM delivery_issues WHERE delivery_id = ? AND state = 'open'`,
    )
    .get(deliveryId) as (Omit<IssueRecord, 'reasons'> & { reasons_json: string }) | undefined;
  if (!row) return null;
  const { reasons_json, ...rest } = row;
  return { ...rest, reasons: JSON.parse(reasons_json) };
}

/** Facts reviewed at the most recent disposition on this delivery, with that issue's id. */
export function getLastReviewed(db: DB, deliveryId: number): { issueId: number; facts: ReviewedFacts } | null {
  const row = db
    .prepare(
      `SELECT id, reviewed_facts_json FROM delivery_issues
       WHERE delivery_id = ? AND state = 'resolved' AND reviewed_facts_json IS NOT NULL
       ORDER BY resolved_at DESC, id DESC LIMIT 1`,
    )
    .get(deliveryId) as { id: number; reviewed_facts_json: string } | undefined;
  return row ? { issueId: row.id, facts: JSON.parse(row.reviewed_facts_json) } : null;
}

export function reviewedFacts(facts: DeliveryFacts, demoDate: string): ReviewedFacts {
  return {
    state: facts.state,
    expectedArrival: facts.expectedArrival,
    quantity: facts.quantity,
    requiredDock: facts.requiredDock,
    productionStart: facts.productionStart,
    reasons: physicalRisk(facts, demoDate).reasons,
    demoDate,
  };
}

interface TransitionContext {
  delivery: Pick<DeliveryRecord, 'id' | 'poId' | 'buyer'>;
  before: Pick<DeliveryFacts, 'expectedArrival'> | null;
  after: DeliveryFacts;
  demoDate: string;
  now: string;
  /** Defaults to this delivery's own latest disposition. Split children pass their parent's. */
  lastReviewed?: { issueId: number; facts: ReviewedFacts } | null;
  parentIssueId?: number | null;
}

/** Applies the shared transition rule and persists the result. Returns the open issue id, if any. */
export function applyIssueTransition(db: DB, ctx: TransitionContext): number | null {
  const open = getOpenIssue(db, ctx.delivery.id);
  const lastReviewed = ctx.lastReviewed !== undefined ? ctx.lastReviewed : getLastReviewed(db, ctx.delivery.id);
  const transition = evaluateIssueTransition({
    before: ctx.before,
    after: ctx.after,
    demoDate: ctx.demoDate,
    openIssueReasons: open?.reasons ?? null,
    lastReviewed: lastReviewed?.facts ?? null,
  });

  if (transition.action === 'update' && open) {
    db.prepare('UPDATE delivery_issues SET reasons_json = ?, version = version + 1 WHERE id = ?').run(
      JSON.stringify(transition.reasons),
      open.id,
    );
    addHistory(
      db,
      {
        poId: ctx.delivery.poId,
        deliveryId: ctx.delivery.id,
        eventType: 'issue_updated',
        before: { issue: open.id, reasons: open.reasons },
        after: { issue: open.id, reasons: transition.reasons },
        actor: null,
        source: null,
        note: null,
      },
      ctx.now,
    );
    return open.id;
  }
  if (transition.action === 'open') {
    const id = Number(
      db
        .prepare(
          `INSERT INTO delivery_issues (delivery_id, state, reasons_json, opened_at, previous_issue_id, parent_issue_id)
           VALUES (?, 'open', ?, ?, ?, ?)`,
        )
        .run(ctx.delivery.id, JSON.stringify(transition.reasons), ctx.now, lastReviewed?.issueId ?? null, ctx.parentIssueId ?? null)
        .lastInsertRowid,
    );
    addHistory(
      db,
      {
        poId: ctx.delivery.poId,
        deliveryId: ctx.delivery.id,
        eventType: 'issue_opened',
        before: lastReviewed ? { previousIssue: lastReviewed.issueId } : null,
        after: { issue: id, reasons: transition.reasons },
        actor: null,
        source: null,
        note: null,
      },
      ctx.now,
    );
    return id;
  }
  return open?.id ?? null;
}

/** Validates that `issueId`/`version` is exactly the delivery's current open issue. */
export function requireOpenIssue(db: DB, deliveryId: number, issueId: number, version: number): IssueRecord {
  const open = getOpenIssue(db, deliveryId);
  if (!open || open.id !== issueId || open.version !== version) {
    throw new HttpError(409, 'This issue changed since you opened it. Reload to see its current state, then try again.');
  }
  return open;
}

export function validateOutcome(outcome: ResolutionOutcome, facts: DeliveryFacts, demoDate: string, context: 'arrival' | 'split' | 'resolve') {
  if (outcome === 'split_agreed' && context !== 'split') {
    throw new HttpError(422, 'Split delivery agreed is only available when saving a split.', { outcome: 'Choose another outcome.' });
  }
  if (outcome === 'date_restored' && !meetsDateRestored(facts, demoDate)) {
    throw new HttpError(422, 'Date restored needs an expected arrival on or before the required dock date that is not overdue.', {
      outcome: 'The arrival is late, unknown, or overdue. Choose Accepted delay or Reviewed instead.',
    });
  }
}

interface ResolveContext {
  issueId: number;
  issueVersion: number;
  delivery: Pick<DeliveryRecord, 'id' | 'poId' | 'buyer'>;
  facts: DeliveryFacts;
  outcome: ResolutionOutcome;
  note: string;
  demoDate: string;
  now: string;
}

export function resolveIssueRow(db: DB, ctx: ResolveContext): void {
  const facts = reviewedFacts(ctx.facts, ctx.demoDate);
  const result = db
    .prepare(
      `UPDATE delivery_issues
       SET state = 'resolved', resolved_at = ?, resolved_by = ?, outcome = ?, note = ?, reviewed_facts_json = ?,
           version = version + 1
       WHERE id = ? AND version = ? AND state = 'open'`,
    )
    .run(ctx.now, ctx.delivery.buyer, ctx.outcome, ctx.note || null, JSON.stringify(facts), ctx.issueId, ctx.issueVersion);
  if (result.changes !== 1) throw stale();
  addHistory(
    db,
    {
      poId: ctx.delivery.poId,
      deliveryId: ctx.delivery.id,
      eventType: 'issue_resolved',
      before: { issue: ctx.issueId, state: 'open' },
      after: { issue: ctx.issueId, outcome: OUTCOME_LABELS[ctx.outcome], expectedArrival: ctx.facts.expectedArrival },
      actor: ctx.delivery.buyer,
      source: null,
      note: ctx.note,
    },
    ctx.now,
  );
}

/** Records an already-resolved disposition (split children saved with "Save and resolve"). */
export function insertResolvedIssue(
  db: DB,
  ctx: Omit<ResolveContext, 'issueId' | 'issueVersion'> & { reasons: IssueReason[]; parentIssueId: number | null },
): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO delivery_issues (delivery_id, state, reasons_json, opened_at, resolved_at, resolved_by, outcome, note,
                                      reviewed_facts_json, parent_issue_id)
         VALUES (?, 'resolved', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.delivery.id,
        JSON.stringify(ctx.reasons),
        ctx.now,
        ctx.now,
        ctx.delivery.buyer,
        ctx.outcome,
        ctx.note || null,
        JSON.stringify(reviewedFacts(ctx.facts, ctx.demoDate)),
        ctx.parentIssueId,
      ).lastInsertRowid,
  );
  addHistory(
    db,
    {
      poId: ctx.delivery.poId,
      deliveryId: ctx.delivery.id,
      eventType: 'issue_resolved',
      before: { parentIssue: ctx.parentIssueId },
      after: { issue: id, outcome: OUTCOME_LABELS[ctx.outcome], expectedArrival: ctx.facts.expectedArrival },
      actor: ctx.delivery.buyer,
      source: null,
      note: ctx.note,
    },
    ctx.now,
  );
  return id;
}

/**
 * One-time initialization for data that predates issues (migration 003): open issues for current
 * exceptions on active deliveries that have no issue history. Completed reminders are not read as
 * buyer acceptance. Guarded by an app_metadata marker and the one-open-issue index.
 */
/**
 * Explicit reconciliation after the demo clock moves forward: re-evaluates every outstanding active
 * delivery against the new demo date with unchanged facts, so newly overdue conditions open (or add a
 * reason to) an issue exactly once. Repeating it changes nothing.
 */
export function reconcileForDemoDate(db: DB, demoDate: string, now: string): number {
  const ids = db.prepare(`SELECT id FROM deliveries WHERE superseded_at IS NULL AND state <> 'received' ORDER BY id`).all() as { id: number }[];
  let changed = 0;
  for (const { id } of ids) {
    const delivery = loadDelivery(db, id);
    const before = getOpenIssue(db, id);
    const result = applyIssueTransition(db, { delivery, before: delivery, after: delivery, demoDate, now });
    const after = getOpenIssue(db, id);
    if (result !== null && (before?.id !== after?.id || before?.version !== after?.version)) changed++;
  }
  return changed;
}

export function reconcileIssues(db: DB, demoDate: string, now: string): number {
  const ids = db
    .prepare(
      `SELECT d.id FROM deliveries d
       WHERE d.superseded_at IS NULL AND d.state <> 'received'
         AND NOT EXISTS (SELECT 1 FROM delivery_issues i WHERE i.delivery_id = d.id)`,
    )
    .all() as { id: number }[];
  let opened = 0;
  for (const { id } of ids) {
    const delivery = loadDelivery(db, id);
    if (applyIssueTransition(db, { delivery, before: null, after: delivery, demoDate, now, lastReviewed: null }) !== null) opened++;
  }
  return opened;
}
