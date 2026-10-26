// Simulated supplier outreach (PRD §13). Preview is read-only. Send rechecks eligibility inside its
// transaction and writes a simulated outbound message only; nothing is emailed.
import type { DB } from '../db/db.js';
import { getDemoClock, getMeta, getOutreachSettings } from '../db/db.js';
import { HttpError, notFound } from '../errors.js';
import { addBusinessDays, formatClock, localDate } from '../../shared/clock.js';
import { formatDate } from '../../shared/dates.js';
import { OUTREACH_REQUEST_TEXT } from '../../shared/labels.js';
import { selectOutreachCandidates } from '../../shared/outreach.js';
import type { SendOutreachInput } from '../../shared/schemas.js';
import type { EmailView, OutreachCandidate, OutreachDelivery, OutreachPreview } from '../../shared/types.js';
import { addHistory } from './history.js';

/** Every active delivery quantity with the facts the eligibility rule needs. */
export function loadOutreachDeliveries(db: DB): OutreachDelivery[] {
  const rows = db
    .prepare(
      `SELECT d.id AS deliveryId, d.version, p.id AS poId, p.number AS poNumber, l.id AS poLineId, l.line_no AS lineNo,
              s.id AS supplierId, s.name AS supplierName, l.part_number AS partNumber, l.description, l.unit,
              d.quantity, d.state, d.expected_arrival AS expectedArrival, l.required_dock_date AS requiredDock,
              p.created_date AS poCreatedDate,
              CASE WHEN COALESCE(d.last_supplier_confirmation_at, '') > COALESCE(d.arrival_updated_at, '')
                   THEN d.last_supplier_confirmation_at ELSE d.arrival_updated_at END AS lastUpdateAt,
              EXISTS (SELECT 1 FROM shipment_deliveries sd JOIN shipments sh ON sh.id = sd.shipment_id
                      WHERE sd.delivery_id = d.id AND sh.tracking_usable = 1) AS trackingUsable,
              (EXISTS (SELECT 1 FROM outreach_items oi JOIN outreach_requests r ON r.id = oi.request_id
                       WHERE oi.delivery_id = d.id AND r.state = 'open' AND oi.response_state <> 'answered')
               OR EXISTS (SELECT 1 FROM call_task_items ci JOIN call_tasks t ON t.id = ci.task_id JOIN outreach_items oi ON oi.id = ci.outreach_item_id
                          WHERE oi.delivery_id = d.id AND t.state IN ('open', 'in_progress') AND ci.response_state <> 'answered'))
                AS awaitingResponse
       FROM deliveries d
       JOIN po_lines l ON l.id = d.po_line_id
       JOIN purchase_orders p ON p.id = l.po_id
       JOIN suppliers s ON s.id = p.supplier_id
       WHERE d.superseded_at IS NULL
       ORDER BY d.id`,
    )
    .all() as (Omit<OutreachDelivery, 'trackingUsable' | 'awaitingResponse'> & { trackingUsable: number; awaitingResponse: number })[];
  return rows.map((r) => ({ ...r, trackingUsable: r.trackingUsable === 1, awaitingResponse: r.awaitingResponse === 1 }));
}

const sentOn = (db: DB, supplierId: number, date: string) =>
  db.prepare('SELECT 1 FROM outreach_requests WHERE supplier_id = ? AND local_date = ?').get(supplierId, date) !== undefined;

export function getOutreachPreview(db: DB): OutreachPreview {
  const clock = getDemoClock(db);
  const settings = getOutreachSettings(db);
  const demoDate = localDate(clock);
  const selection = selectOutreachCandidates(loadOutreachDeliveries(db), clock, settings);
  return {
    demoClock: clock,
    demoDate,
    settings,
    suppliers: selection.suppliers.map((s) => ({ ...s, sentToday: sentOn(db, s.supplierId, demoDate) })),
    excluded: selection.excluded,
  };
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Synthetic recipient under example.com; never a real address. */
export const supplierAddress = (supplierName: string) => `orders@${slug(supplierName)}.example.com`;

/** Synthetic sender for the buyer side of simulated email. */
export const buyerAddress = (buyer: string) => `${buyer} <purchasing@demo-buyer.example.com>`;

function outboundBody(supplierName: string, buyer: string, items: OutreachCandidate[], dueAt: string, tracked: Set<number>): string {
  const lines = items.map((i) => {
    const ask =
      i.state === 'in_transit' && !tracked.has(i.deliveryId)
        ? 'shipped; please send the tracking number and expected arrival'
        : i.expectedArrival
          ? `expected arrival ${formatDate(i.expectedArrival)}`
          : 'no expected arrival on file; please provide one';
    return `- ${i.poNumber} line ${i.lineNo} · ${i.partNumber} ${i.description} · ${i.quantity} ${i.unit} · ${ask}`;
  });
  return [
    `Hello ${supplierName} team,`,
    '',
    OUTREACH_REQUEST_TEXT,
    '',
    ...lines,
    '',
    `Please reply by ${formatClock(dueAt)}.`,
    '',
    `${buyer}, Purchasing`,
    '(Simulated message for the demo; nothing was sent.)',
  ].join('\n');
}

/** The request email for these items, exactly as a send would store it. Pure composition; no writes. */
function composeRequest(db: DB, supplierName: string, chosen: OutreachCandidate[], clock: string, windowDays: number) {
  const dueAt = addBusinessDays(clock, windowDays);
  const buyer = (db.prepare('SELECT buyer FROM purchase_orders WHERE id = ?').get(chosen[0].poId) as { buyer: string }).buyer;
  const tracked = new Set(chosen.filter((c) => c.trackingUsable).map((c) => c.deliveryId));
  return {
    dueAt,
    buyer,
    recipient: supplierAddress(supplierName),
    subject: `Arrival confirmation request: ${[...new Set(chosen.map((c) => c.poNumber))].join(', ')}`,
    body: outboundBody(supplierName, buyer, chosen, dueAt, tracked),
  };
}

/**
 * Read-only preview of the request a send would create now for this supplier's eligible items.
 * Nothing is stored; the email is labeled a sample until a send happens.
 */
export function previewRequestEmail(db: DB, supplierId: number): EmailView {
  const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(supplierId) as { id: number; name: string } | undefined;
  if (!supplier) throw notFound('Supplier');
  const clock = getDemoClock(db);
  const settings = getOutreachSettings(db);
  const items = selectOutreachCandidates(loadOutreachDeliveries(db), clock, settings).suppliers.find((s) => s.supplierId === supplier.id)?.items ?? [];
  if (items.length === 0) throw new HttpError(409, `No items are eligible for a request to ${supplier.name} right now.`);
  const email = composeRequest(db, supplier.name, items, clock, settings.responseWindowBusinessDays);
  return { from: buyerAddress(email.buyer), to: email.recipient, subject: email.subject, at: null, body: email.body, sample: true };
}

export interface SendResult {
  requestId: number;
  messageId: number;
  itemCount: number;
}

/**
 * Creates one simulated request for a supplier with the selected eligible delivery quantities. Rejects
 * a second send to the same supplier on the same demo date, and any item whose eligibility or version
 * changed since the preview. Never creates anything on a GET.
 */
export function sendOutreach(db: DB, input: SendOutreachInput): SendResult {
  return db.transaction(() => {
    const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(input.supplierId) as { id: number; name: string } | undefined;
    if (!supplier) throw notFound('Supplier');
    const clock = getDemoClock(db);
    const settings = getOutreachSettings(db);
    const demoDate = localDate(clock);
    if (sentOn(db, supplier.id, demoDate)) {
      throw new HttpError(409, `A request already went to ${supplier.name} on this demo date. Remaining items wait for a later run.`);
    }
    const eligible = selectOutreachCandidates(loadOutreachDeliveries(db), clock, settings).suppliers.find((s) => s.supplierId === supplier.id)?.items ?? [];
    const chosen = input.items.map((pick) => {
      const item = eligible.find((e) => e.deliveryId === pick.deliveryId);
      if (!item || item.version !== pick.version) {
        throw new HttpError(409, 'Eligibility changed since the preview. Reload the preview and try again.');
      }
      return item;
    });

    const email = composeRequest(db, supplier.name, chosen, clock, settings.responseWindowBusinessDays);
    const { dueAt } = email;
    const requestId = Number(
      db
        .prepare(
          `INSERT INTO outreach_requests (supplier_id, local_date, sent_at, response_due_at, state, demo_run_id)
           VALUES (?, ?, ?, ?, 'open', ?)`,
        )
        .run(supplier.id, demoDate, clock, dueAt, `anchor-${getMeta(db, 'scenario_anchor') ?? demoDate}`).lastInsertRowid,
    );
    const insertItem = db.prepare(
      `INSERT INTO outreach_items (request_id, delivery_id, po_line_id, requested_qty, expected_arrival_snapshot, delivery_version_snapshot, response_state)
       VALUES (?, ?, ?, ?, ?, ?, 'awaiting')`,
    );
    for (const item of chosen) insertItem.run(requestId, item.deliveryId, item.poLineId, item.quantity, item.expectedArrival, item.version);

    const messageId = Number(
      db
        .prepare(
          `INSERT INTO supplier_messages (request_id, external_message_id, direction, recipient, subject, body, sent_or_received_at, processing_state)
           VALUES (?, ?, 'outbound', ?, ?, ?, ?, 'simulated_sent')`,
        )
        .run(
          requestId,
          `OUT-${requestId}`,
          email.recipient,
          email.subject,
          email.body,
          clock,
        ).lastInsertRowid,
    );

    for (const poId of [...new Set(chosen.map((c) => c.poId))]) {
      const onPo = chosen.filter((c) => c.poId === poId);
      addHistory(
        db,
        {
          poId,
          deliveryId: null,
          eventType: 'outreach_sent',
          before: null,
          after: { request: requestId, items: onPo.map((c) => ({ id: c.deliveryId, line: c.lineNo, quantity: c.quantity })), dueAt },
          actor: null,
          actorType: 'simulated_automation',
          source: 'supplier_email',
          sourceRef: `request:${requestId}/message:${messageId}`,
          note: null,
        },
        clock,
      );
    }
    return { requestId, messageId, itemCount: chosen.length };
  })();
}
