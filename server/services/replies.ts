// Supplier reply processing (PRD §13, ARCHITECTURE §14 "Reply-processing contract"). Each requested
// delivery quantity is handled independently. Only exact confirmed/revised arrivals for the requested
// quantity, on a delivery unchanged since the request, auto-apply; everything else is marked for
// review without touching dates. Automation never resolves an issue. The message, all results,
// updates, history, and task changes persist in one transaction; a duplicate message ID is a no-op.
import type { DB } from '../db/db.js';
import { getDemoClock, getDemoDate, getMeta, getOutreachSettings } from '../db/db.js';
import { HttpError, notFound } from '../errors.js';
import { localDate } from '../../shared/clock.js';
import { selectOutreachCandidates } from '../../shared/outreach.js';
import type { EmailView, ResponseState } from '../../shared/types.js';
import { fixtureReplySource, REPLY_FIXTURES, type ExtractedResult, type ThreadItem } from '../simulation/fixtures.js';
import { syncAfterReply } from './callTasks.js';
import { recordArrivalUpdate } from './deliveries.js';
import { addHistory } from './history.js';
import { buyerAddress, loadOutreachDeliveries, supplierAddress } from './outreach.js';
import { loadDelivery } from './issues.js';

interface ItemRecord extends ThreadItem {
  id: number;
  poId: number;
  deliveryId: number;
  supplierId: number;
  deliveryVersionSnapshot: number;
  responseState: ResponseState;
  trackingUsable: number;
}

export interface ReplyOutcome {
  duplicate: boolean;
  messageId: number;
  applied: number;
  needsReview: number;
  notMentioned: number;
  unmatched: number;
}

export function requireFixtures(db: DB) {
  if (!getMeta(db, 'fixture_version')) {
    throw new HttpError(409, 'This data predates the demo scenarios. Reset demo data to install them.');
  }
}

/** Why an extracted result cannot auto-apply to its item, or null when it can. */
function reviewReason(r: ExtractedResult, item: ItemRecord): string | null {
  if (r.classification === 'proposed_split') return 'Proposed split needs buyer review in the split form.';
  if (r.classification === 'ambiguous' || r.classification === 'unmatched') {
    if (r.dateType === 'ship') return 'Ship date only; no arrival date. Not treated as an arrival.';
    return 'No clear arrival date.';
  }
  if (r.dateType !== 'arrival') return 'Ship date only; no arrival date. Not treated as an arrival.';
  if (!r.proposedDate) return 'No arrival date stated.';
  if (r.proposedQty !== item.requestedQty) return `Quantity ${r.proposedQty ?? 'missing'} does not match the requested ${item.requestedQty}.`;
  if (item.trackingUsable) return 'Carrier tracking is authoritative for this quantity.';
  return null;
}

export function processSupplierReply(db: DB, fixtureKey: string): ReplyOutcome {
  const fixture = REPLY_FIXTURES[fixtureKey];
  if (!fixture) throw notFound('Reply fixture');
  requireFixtures(db);
  return db.transaction((): ReplyOutcome => {
    const existing = db.prepare('SELECT id FROM supplier_messages WHERE external_message_id = ?').get(fixture.externalMessageId) as { id: number } | undefined;
    if (existing) return { duplicate: true, messageId: existing.id, applied: 0, needsReview: 0, notMentioned: 0, unmatched: 0 };

    const request = db
      .prepare(
        `SELECT r.id, r.supplier_id AS supplierId FROM outreach_requests r JOIN suppliers s ON s.id = r.supplier_id
         WHERE s.name = ? ORDER BY r.id DESC LIMIT 1`,
      )
      .get(fixture.supplier) as { id: number; supplierId: number } | undefined;
    if (!request) throw new HttpError(409, `Simulate the request to ${fixture.supplier} first.`);

    const items = db
      .prepare(
        `SELECT oi.id, oi.delivery_id AS deliveryId, oi.requested_qty AS requestedQty, oi.delivery_version_snapshot AS deliveryVersionSnapshot,
                oi.response_state AS responseState, p.id AS poId, p.number AS poNumber, p.supplier_id AS supplierId, l.line_no AS lineNo,
                l.part_number AS partNumber,
                EXISTS (SELECT 1 FROM shipment_deliveries sd JOIN shipments sh ON sh.id = sd.shipment_id
                        WHERE sd.delivery_id = oi.delivery_id AND sh.tracking_usable = 1) AS trackingUsable
         FROM outreach_items oi JOIN po_lines l ON l.id = oi.po_line_id JOIN purchase_orders p ON p.id = l.po_id
         WHERE oi.request_id = ? ORDER BY oi.id`,
      )
      .all(request.id) as ItemRecord[];

    const anchor = getMeta(db, 'scenario_anchor') ?? getDemoDate(db);
    const extracted = fixtureReplySource.extract(fixtureKey, anchor, items) ?? [];
    const clock = getDemoClock(db);
    const demoDate = localDate(clock);
    const buyer = (db.prepare('SELECT buyer FROM purchase_orders WHERE id = ?').get(items[0].poId) as { buyer: string }).buyer;

    const messageId = Number(
      db
        .prepare(
          `INSERT INTO supplier_messages (request_id, external_message_id, direction, recipient, subject, body, sent_or_received_at, processing_state, fixture_key)
           VALUES (?, ?, 'inbound', NULL, ?, ?, ?, 'processed', ?)`,
        )
        .run(request.id, fixture.externalMessageId, `RE: Arrival confirmation request`, fixture.body(anchor, items, buyer), clock, fixtureKey)
        .lastInsertRowid,
    );
    const insertResult = db.prepare(
      `INSERT INTO message_results (message_id, outreach_item_id, classification, date_type, proposed_date, proposed_qty, evidence_text,
                                    expected_delivery_version, applied_at, review_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    const outcome: ReplyOutcome = { duplicate: false, messageId, applied: 0, needsReview: 0, notMentioned: 0, unmatched: 0 };
    const mentioned = new Set<number>();

    for (const r of extracted) {
      // Match only within this thread, by PO and line, and only for the request's own supplier.
      const item = items.find((i) => i.poNumber === r.ref.poNumber && i.lineNo === r.ref.lineNo && i.supplierId === request.supplierId);
      if (!item) {
        insertResult.run(messageId, null, 'unmatched', r.dateType, r.proposedDate, r.proposedQty, r.evidence, null, `No requested item in this thread matches ${r.ref.poNumber} line ${r.ref.lineNo}.`);
        outcome.unmatched++;
        continue;
      }
      mentioned.add(item.id);
      const delivery = loadDelivery(db, item.deliveryId);
      let reason = reviewReason(r, item);
      if (!reason && delivery.supersededAt !== null) reason = 'The delivery was split after the request. Review against the current deliveries.';
      if (!reason && delivery.state === 'received') reason = 'Received deliveries are read-only.';
      if (!reason && delivery.version !== item.deliveryVersionSnapshot) {
        reason = 'Changed by the buyer or a newer source after the request was sent. Held for review, not overwritten.';
      }
      const resultId = Number(
        insertResult.run(messageId, item.id, r.classification, r.dateType, r.proposedDate, r.proposedQty, r.evidence, item.deliveryVersionSnapshot, reason)
          .lastInsertRowid,
      );
      if (reason) {
        if (item.responseState !== 'answered') db.prepare(`UPDATE outreach_items SET response_state = 'needs_review' WHERE id = ?`).run(item.id);
        item.responseState = item.responseState === 'answered' ? 'answered' : 'needs_review';
        addHistory(
          db,
          {
            poId: item.poId,
            deliveryId: item.deliveryId,
            eventType: 'reply_needs_review',
            before: null,
            after: { classification: r.classification, reason },
            actor: null,
            actorType: 'simulated_automation',
            source: 'supplier_email',
            sourceRef: `message:${messageId}/result:${resultId}`,
            note: r.evidence,
          },
          clock,
        );
        outcome.needsReview++;
        continue;
      }
      recordArrivalUpdate(db, delivery, delivery.version, {
        expectedArrival: r.proposedDate,
        source: 'supplier_email',
        note: r.evidence,
        demoDate,
        now: clock,
        confirmation: true,
        actor: null,
        actorType: 'simulated_automation',
        sourceRef: `message:${messageId}/result:${resultId}`,
      });
      db.prepare('UPDATE message_results SET applied_at = ? WHERE id = ?').run(clock, resultId);
      // Later replies in this thread bind to the version automation just wrote.
      db.prepare(`UPDATE outreach_items SET response_state = 'answered', answered_at = ?, delivery_version_snapshot = ? WHERE id = ?`).run(
        clock,
        delivery.version + 1,
        item.id,
      );
      item.responseState = 'answered';
      outcome.applied++;
    }

    // A reply's existence does not answer every item: unmentioned ones stay awaiting.
    for (const item of items.filter((i) => !mentioned.has(i.id) && i.responseState !== 'answered')) {
      insertResult.run(messageId, item.id, 'missing', 'unknown', null, null, null, item.deliveryVersionSnapshot, 'Not mentioned in this reply.');
      outcome.notMentioned++;
    }

    syncAfterReply(db, request.id, clock);
    for (const poId of [...new Set(items.map((i) => i.poId))]) {
      addHistory(
        db,
        {
          poId,
          deliveryId: null,
          eventType: 'reply_processed',
          before: null,
          after: { message: messageId, applied: outcome.applied, needsReview: outcome.needsReview, notMentioned: outcome.notMentioned },
          actor: null,
          actorType: 'simulated_automation',
          source: 'supplier_email',
          sourceRef: `message:${messageId}`,
          note: null,
        },
        clock,
      );
    }
    return outcome;
  })();
}

/**
 * Read-only "sample reply" for a seeded fixture, rendered against the current thread (or, before a
 * send, the items a send would request). Nothing is stored and nothing implies the reply arrived.
 */
export function previewReply(db: DB, fixtureKey: string): EmailView {
  const fixture = REPLY_FIXTURES[fixtureKey];
  if (!fixture) throw notFound('Reply fixture');
  requireFixtures(db);
  const supplier = db.prepare('SELECT id, name FROM suppliers WHERE name = ?').get(fixture.supplier) as { id: number; name: string } | undefined;
  if (!supplier) throw notFound('Supplier');
  const request = db.prepare('SELECT id FROM outreach_requests WHERE supplier_id = ? ORDER BY id DESC LIMIT 1').get(supplier.id) as { id: number } | undefined;
  let items: (ThreadItem & { poId: number })[];
  if (request) {
    items = db
      .prepare(
        `SELECT p.id AS poId, p.number AS poNumber, l.line_no AS lineNo, l.part_number AS partNumber, oi.requested_qty AS requestedQty
         FROM outreach_items oi JOIN po_lines l ON l.id = oi.po_line_id JOIN purchase_orders p ON p.id = l.po_id
         WHERE oi.request_id = ? ORDER BY oi.id`,
      )
      .all(request.id) as (ThreadItem & { poId: number })[];
  } else {
    const settings = getOutreachSettings(db);
    items = (selectOutreachCandidates(loadOutreachDeliveries(db), getDemoClock(db), settings).suppliers.find((s) => s.supplierId === supplier.id)?.items ?? []).map(
      (c) => ({ poId: c.poId, poNumber: c.poNumber, lineNo: c.lineNo, partNumber: c.partNumber, requestedQty: c.quantity }),
    );
  }
  if (items.length === 0) throw new HttpError(409, `No requested items for ${supplier.name} to reply about.`);
  const buyer = (db.prepare('SELECT buyer FROM purchase_orders WHERE id = ?').get(items[0].poId) as { buyer: string }).buyer;
  const anchor = getMeta(db, 'scenario_anchor') ?? getDemoDate(db);
  return {
    from: `${supplier.name} <${supplierAddress(supplier.name)}>`,
    to: buyerAddress(buyer),
    subject: 'RE: Arrival confirmation request',
    at: null,
    body: fixture.body(anchor, items, buyer),
    sample: true,
  };
}
