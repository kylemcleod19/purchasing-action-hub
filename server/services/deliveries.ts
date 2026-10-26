// Arrival updates, splits, and issue dispositions (PRD §7). Each mutation runs in one transaction:
// check versions, validate, write deliveries, evaluate issue transitions, apply any requested
// disposition, and write history. Any failure rolls everything back. `now` is injectable so the seed
// can record backdated history through the same rules.
import type { DB } from '../db/db.js';
import { HttpError, stale } from '../errors.js';
import { physicalRisk } from '../../shared/impact.js';
import type { ResolveIssueInput, SplitInput, UpdateArrivalInput } from '../../shared/schemas.js';
import type { DeliveryFacts, IssueReason } from '../../shared/types.js';
import { addHistory } from './history.js';
import {
  applyIssueTransition,
  getLastReviewed,
  getOpenIssue,
  insertResolvedIssue,
  loadDelivery,
  requireOpenIssue,
  resolveIssueRow,
  validateOutcome,
  type DeliveryRecord,
} from './issues.js';

function checkCurrent(delivery: DeliveryRecord, version: number) {
  if (delivery.supersededAt !== null) {
    throw new HttpError(409, 'This delivery was replaced by a split. Reload to see the current deliveries.');
  }
  if (delivery.version !== version) throw stale();
}

export function updateArrival(db: DB, deliveryId: number, input: UpdateArrivalInput, demoDate: string, now = new Date().toISOString()): void {
  db.transaction(() => {
    const delivery = loadDelivery(db, deliveryId);
    checkCurrent(delivery, input.version);
    if (delivery.state === 'received') throw new HttpError(422, 'Received deliveries are read-only.');
    if (input.resolve) requireOpenIssue(db, deliveryId, input.resolve.issueId, input.resolve.expectedIssueVersion);

    const result = db
      .prepare(
        `UPDATE deliveries SET expected_arrival = ?, source = ?, arrival_updated_at = ?, version = version + 1
         WHERE id = ? AND version = ? AND superseded_at IS NULL`,
      )
      .run(input.expectedArrival, input.source, now, deliveryId, input.version);
    if (result.changes !== 1) throw stale();
    addHistory(
      db,
      {
        poId: delivery.poId,
        deliveryId,
        eventType: 'arrival_updated',
        before: { expectedArrival: delivery.expectedArrival, source: delivery.source },
        after: { expectedArrival: input.expectedArrival, source: input.source },
        actor: delivery.buyer,
        source: input.source,
        note: input.note,
      },
      now,
    );

    const after: DeliveryFacts = { ...delivery, expectedArrival: input.expectedArrival };
    applyIssueTransition(db, { delivery, before: delivery, after, demoDate, now });

    if (input.resolve) {
      // The transition may have added reasons to the same issue; it is still the one the buyer targeted.
      const open = getOpenIssue(db, deliveryId);
      if (!open || open.id !== input.resolve.issueId) throw stale();
      validateOutcome(input.resolve.outcome, after, demoDate, 'arrival');
      resolveIssueRow(db, {
        issueId: open.id,
        issueVersion: open.version,
        delivery,
        facts: after,
        outcome: input.resolve.outcome,
        note: input.resolve.note,
        demoDate,
        now,
      });
    }
  })();
}

/** Splits one active not-shipped commitment into dated parts under the same PO item. Returns new ids. */
export function splitDelivery(db: DB, deliveryId: number, input: SplitInput, demoDate: string, now = new Date().toISOString()): number[] {
  return db.transaction(() => {
    const delivery = loadDelivery(db, deliveryId);
    checkCurrent(delivery, input.version);
    if (delivery.state !== 'planned') {
      throw new HttpError(422, 'Only not-shipped deliveries can be split. In-transit and received records cannot be split.');
    }
    validateSplit(delivery.quantity, input);
    const openIssue = getOpenIssue(db, deliveryId);
    if (input.resolve) requireOpenIssue(db, deliveryId, input.resolve.issueId, input.resolve.expectedIssueVersion);

    const childFacts: DeliveryFacts[] = input.parts.map((p) => ({
      state: 'planned',
      expectedArrival: p.expectedArrival,
      quantity: p.quantity,
      requiredDock: delivery.requiredDock,
      productionStart: delivery.productionStart,
    }));
    if (input.resolve) {
      for (const facts of childFacts) validateOutcome(input.resolve.outcome, facts, demoDate, 'split');
    }

    const superseded = db
      .prepare(
        `UPDATE deliveries SET superseded_at = ?, version = version + 1
         WHERE id = ? AND version = ? AND superseded_at IS NULL`,
      )
      .run(now, deliveryId, input.version);
    if (superseded.changes !== 1) throw stale();

    const insertDelivery = db.prepare(
      `INSERT INTO deliveries (po_line_id, parent_delivery_id, quantity, state, expected_arrival, source, arrival_updated_at)
       VALUES (?, ?, ?, 'planned', ?, ?, ?)`,
    );
    const children = childFacts.map((facts) => ({
      id: Number(insertDelivery.run(delivery.poLineId, deliveryId, facts.quantity, facts.expectedArrival, input.source, now).lastInsertRowid),
      facts,
    }));

    addHistory(
      db,
      {
        poId: delivery.poId,
        deliveryId,
        eventType: 'delivery_split',
        before: { quantity: delivery.quantity, expectedArrival: delivery.expectedArrival },
        after: { deliveries: children.map((c) => ({ id: c.id, quantity: c.facts.quantity, expectedArrival: c.facts.expectedArrival })) },
        actor: delivery.buyer,
        source: input.source,
        note: input.note,
      },
      now,
    );

    const ctxFor = (id: number) => ({ id, poId: delivery.poId, buyer: delivery.buyer });
    if (openIssue && input.resolve) {
      // Save and resolve: the outcome is recorded on the parent issue, and each child gets a resolved
      // disposition against its saved facts so accepted late children do not re-alert immediately.
      resolveIssueRow(db, {
        issueId: openIssue.id,
        issueVersion: input.resolve.expectedIssueVersion,
        delivery,
        facts: delivery,
        outcome: input.resolve.outcome,
        note: input.resolve.note,
        demoDate,
        now,
      });
      for (const child of children) {
        insertResolvedIssue(db, {
          delivery: ctxFor(child.id),
          facts: child.facts,
          reasons: physicalRisk(child.facts, demoDate).reasons,
          outcome: input.resolve.outcome,
          note: input.resolve.note,
          parentIssueId: openIssue.id,
          demoDate,
          now,
        });
      }
    } else if (openIssue) {
      // Save changes: the parent's open review moves to every outstanding child, even on-time ones,
      // so the buyer explicitly disposes of the negotiated schedule.
      db.prepare(`UPDATE delivery_issues SET state = 'superseded', version = version + 1 WHERE id = ?`).run(openIssue.id);
      addHistory(
        db,
        {
          poId: delivery.poId,
          deliveryId,
          eventType: 'issue_superseded',
          before: { issue: openIssue.id, state: 'open' },
          after: { issue: openIssue.id, state: 'superseded', children: children.map((c) => c.id) },
          actor: null,
          source: null,
          note: null,
        },
        now,
      );
      for (const child of children) {
        const reasons = [...new Set<IssueReason>([...openIssue.reasons, ...physicalRisk(child.facts, demoDate).reasons])];
        const issueId = Number(
          db
            .prepare(
              `INSERT INTO delivery_issues (delivery_id, state, reasons_json, opened_at, parent_issue_id)
               VALUES (?, 'open', ?, ?, ?)`,
            )
            .run(child.id, JSON.stringify(reasons), now, openIssue.id).lastInsertRowid,
        );
        addHistory(
          db,
          {
            poId: delivery.poId,
            deliveryId: child.id,
            eventType: 'issue_opened',
            before: { parentIssue: openIssue.id },
            after: { issue: issueId, reasons },
            actor: null,
            source: null,
            note: null,
          },
          now,
        );
      }
    } else {
      // No open issue: evaluate children normally against the parent's estimate and last disposition.
      const lastReviewed = getLastReviewed(db, deliveryId);
      for (const child of children) {
        applyIssueTransition(db, {
          delivery: ctxFor(child.id),
          before: delivery,
          after: child.facts,
          demoDate,
          now,
          lastReviewed,
          parentIssueId: lastReviewed?.issueId ?? null,
        });
      }
    }

    // Open delivery-level reminders move to the PO level, keeping a reference to the original delivery.
    const openFollowUps = db
      .prepare(`SELECT id, note FROM follow_ups WHERE delivery_id = ? AND state = 'open'`)
      .all(deliveryId) as { id: number; note: string }[];
    for (const followUp of openFollowUps) {
      db.prepare(
        `UPDATE follow_ups SET delivery_id = NULL, original_delivery_id = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
      ).run(deliveryId, now, followUp.id);
      addHistory(
        db,
        {
          poId: delivery.poId,
          deliveryId,
          eventType: 'follow_up_moved',
          before: { delivery: deliveryId },
          after: { delivery: null },
          actor: delivery.buyer,
          source: null,
          note: followUp.note,
        },
        now,
      );
    }

    return children.map((c) => c.id);
  })();
}

/** Resolves the exact open issue without changing any delivery date. */
export function resolveIssue(db: DB, deliveryId: number, input: ResolveIssueInput, demoDate: string, now = new Date().toISOString()): void {
  db.transaction(() => {
    const delivery = loadDelivery(db, deliveryId);
    checkCurrent(delivery, input.expectedDeliveryVersion);
    const open = requireOpenIssue(db, deliveryId, input.issueId, input.expectedIssueVersion);
    validateOutcome(input.outcome, delivery, demoDate, 'resolve');
    resolveIssueRow(db, {
      issueId: open.id,
      issueVersion: open.version,
      delivery,
      facts: delivery,
      outcome: input.outcome,
      note: input.note,
      demoDate,
      now,
    });
  })();
}

/** Quantity rule for a split. Throws 422 with a field message; nothing is written on failure. */
export function validateSplit(originalQty: number, input: SplitInput) {
  const total = input.parts.reduce((s, p) => s + p.quantity, 0);
  if (total !== originalQty) {
    throw new HttpError(422, 'The split does not balance. Nothing was saved.', {
      parts: `Split quantities total ${total}; they must total the original ${originalQty}.`,
    });
  }
}
