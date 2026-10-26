// Read-only views of simulated correspondence, call tasks, and carrier events for PO detail. A
// cross-PO request or task appears identically from either PO, with all of its items.
import type { DB } from '../db/db.js';
import { buyerAddress, supplierAddress } from './outreach.js';
import type {
  CallTaskView,
  CarrierEventView,
  MessageResultView,
  OutreachItemView,
  OutreachRequestView,
  ResponseState,
  SupplierMessageView,
} from '../../shared/types.js';

const ITEM_SQL = `SELECT oi.id, oi.delivery_id AS deliveryId, p.id AS poId, p.number AS poNumber, l.line_no AS lineNo,
                         l.part_number AS partNumber, oi.requested_qty AS requestedQty, l.unit,
                         oi.expected_arrival_snapshot AS expectedArrivalSnapshot, oi.response_state AS responseState,
                         oi.answered_at AS answeredAt
                  FROM outreach_items oi JOIN po_lines l ON l.id = oi.po_line_id JOIN purchase_orders p ON p.id = l.po_id`;

/** Requests (and their call tasks) that include at least one item on this PO. */
const requestIdsForPo = (db: DB, poId: number) =>
  (
    db
      .prepare(
        `SELECT DISTINCT oi.request_id AS id FROM outreach_items oi JOIN po_lines l ON l.id = oi.po_line_id
         WHERE l.po_id = ? ORDER BY oi.request_id DESC`,
      )
      .all(poId) as { id: number }[]
  ).map((r) => r.id);

export function getCorrespondence(db: DB, poId: number): OutreachRequestView[] {
  return requestIdsForPo(db, poId).map((id) => {
    const request = db
      .prepare(
        `SELECT r.id, s.name AS supplierName, r.sent_at AS sentAt, r.response_due_at AS responseDueAt, r.state,
                (SELECT t.id FROM call_tasks t WHERE t.request_id = r.id) AS callTaskId
         FROM outreach_requests r JOIN suppliers s ON s.id = r.supplier_id WHERE r.id = ?`,
      )
      .get(id) as Omit<OutreachRequestView, 'items' | 'messages'>;
    const items = db.prepare(`${ITEM_SQL} WHERE oi.request_id = ? ORDER BY p.number, l.line_no, oi.id`).all(id) as OutreachItemView[];
    const buyer = (db.prepare('SELECT buyer FROM purchase_orders WHERE id = ?').get(items[0].poId) as { buyer: string }).buyer;
    const buyerSide = buyerAddress(buyer);
    const supplierSide = `${request.supplierName} <${supplierAddress(request.supplierName)}>`;
    const messages = (
      db
        .prepare(
          `SELECT id, direction, recipient, subject, body, sent_or_received_at AS at, processing_state AS processingState, fixture_key AS fixtureKey
           FROM supplier_messages WHERE request_id = ? ORDER BY sent_or_received_at, id`,
        )
        .all(id) as Omit<SupplierMessageView, 'results' | 'from' | 'to'>[]
    ).map(
      (m): SupplierMessageView => ({
        ...m,
        from: m.direction === 'outbound' ? buyerSide : supplierSide,
        to: m.direction === 'outbound' ? supplierSide : buyerSide,
        results: db
          .prepare(
            `SELECT id, outreach_item_id AS outreachItemId, classification, date_type AS dateType, proposed_date AS proposedDate,
                    proposed_qty AS proposedQty, evidence_text AS evidenceText, applied_at AS appliedAt, review_reason AS reviewReason
             FROM message_results WHERE message_id = ? ORDER BY id`,
          )
          .all(m.id) as MessageResultView[],
      }),
    );
    return { ...request, items, messages };
  });
}

export function getCallTasks(db: DB, poId: number): CallTaskView[] {
  const ids = requestIdsForPo(db, poId);
  if (ids.length === 0) return [];
  return (
    db
      .prepare(
        `SELECT t.id, t.request_id AS requestId, s.name AS supplierName, t.buyer, t.state, t.created_at AS createdAt, t.due_at AS dueAt,
                t.completed_at AS completedAt, t.completion_note AS completionNote, t.version
         FROM call_tasks t JOIN outreach_requests r ON r.id = t.request_id JOIN suppliers s ON s.id = r.supplier_id
         WHERE t.request_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.id DESC`,
      )
      .all(...ids) as Omit<CallTaskView, 'items'>[]
  ).map((task) => ({
    ...task,
    items: db
      .prepare(
        `${ITEM_SQL.replace('FROM outreach_items oi', 'FROM call_task_items ci JOIN outreach_items oi ON oi.id = ci.outreach_item_id').replace(
          'SELECT oi.id,',
          'SELECT ci.response_state AS taskResponseState, oi.id,',
        )} WHERE ci.task_id = ? ORDER BY p.number, l.line_no`,
      )
      .all(task.id) as (OutreachItemView & { taskResponseState: ResponseState })[],
  }));
}

/** Carrier events for shipments linked to this PO's deliveries, newest first. */
export function getCarrierEvents(db: DB, poId: number): CarrierEventView[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT e.id, e.shipment_id AS shipmentId, e.external_event_id AS externalEventId, e.occurred_at AS occurredAt,
                e.received_at AS receivedAt, e.payload_json AS payloadJson, e.applied_state AS appliedState, e.ignored_reason AS ignoredReason
         FROM carrier_events e
         JOIN shipment_deliveries sd ON sd.shipment_id = e.shipment_id
         JOIN deliveries d ON d.id = sd.delivery_id JOIN po_lines l ON l.id = d.po_line_id
         WHERE l.po_id = ? ORDER BY e.occurred_at DESC, e.id DESC`,
      )
      .all(poId) as (Omit<CarrierEventView, 'status' | 'eta'> & { payloadJson: string })[]
  ).map(({ payloadJson, ...e }) => {
    const payload = JSON.parse(payloadJson) as { status: string; eta?: string | null };
    return { ...e, status: payload.status, eta: payload.eta ?? null };
  });
}
