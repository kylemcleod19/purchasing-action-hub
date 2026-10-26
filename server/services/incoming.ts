// Builds current delivery rows with server-computed impact and attention. The dataset is small,
// so every view derives from one full read rather than per-view query variants.
import type { DB } from '../db/db.js';
import { attentionReasons, compareAttention, earliestDate, linkStatus, workOrderImpact } from '../../shared/impact.js';
import type { AffectedWorkOrder, DeliveryRow, DeliveryState, FollowUpSummary } from '../../shared/types.js';

interface DeliveryRecord {
  deliveryId: number;
  version: number;
  poId: number;
  poNumber: string;
  supplierId: number;
  supplierName: string;
  poLineId: number;
  lineNo: number;
  partNumber: string;
  description: string;
  unit: string;
  warehouseName: string;
  quantity: number;
  state: DeliveryState;
  expectedArrival: string | null;
  receivedDate: string | null;
  source: string;
  updatedAt: string;
}

interface LinkRecord {
  deliveryId: number;
  workOrderLinkId: number;
  workOrderId: number;
  number: string;
  program: string;
  productionStart: string;
  quantity: number;
}

interface FollowUpRecord extends FollowUpSummary {
  poId: number;
}

export function loadDeliveryRows(db: DB, demoDate: string): DeliveryRow[] {
  const deliveries = db
    .prepare(
      `SELECT d.id AS deliveryId, d.version, p.id AS poId, p.number AS poNumber, s.id AS supplierId,
              s.name AS supplierName, l.id AS poLineId, l.line_no AS lineNo, l.part_number AS partNumber,
              l.description, l.unit, w.name AS warehouseName, d.quantity, d.state,
              d.expected_arrival AS expectedArrival, d.received_date AS receivedDate, d.source, d.updated_at AS updatedAt
       FROM deliveries d
       JOIN po_lines l ON l.id = d.po_line_id
       JOIN purchase_orders p ON p.id = l.po_id
       JOIN suppliers s ON s.id = p.supplier_id
       JOIN warehouses w ON w.id = p.warehouse_id
       WHERE d.superseded_at IS NULL`,
    )
    .all() as DeliveryRecord[];

  const links = db
    .prepare(
      `SELECT dl.delivery_id AS deliveryId, k.id AS workOrderLinkId, wo.id AS workOrderId, wo.number,
              wo.program, wo.production_start AS productionStart, dl.quantity
       FROM delivery_links dl
       JOIN deliveries d ON d.id = dl.delivery_id AND d.superseded_at IS NULL
       JOIN work_order_links k ON k.id = dl.work_order_link_id
       JOIN work_orders wo ON wo.id = k.work_order_id
       ORDER BY wo.production_start, wo.number`,
    )
    .all() as LinkRecord[];

  const openFollowUps = db
    .prepare(
      `SELECT id, po_id AS poId, delivery_id AS deliveryId, due_date AS dueDate, note
       FROM follow_ups WHERE state = 'open' ORDER BY due_date, id`,
    )
    .all() as FollowUpRecord[];

  const deliveryById = new Map(deliveries.map((d) => [d.deliveryId, d]));
  const linksByDelivery = groupBy(links, (l) => l.deliveryId);
  const linksByWorkOrder = groupBy(links, (l) => l.workOrderId);

  const summaries = new Map<number, AffectedWorkOrder['summary']>();
  for (const [workOrderId, woLinks] of linksByWorkOrder) {
    const portions = woLinks.map((l) => {
      const d = deliveryById.get(l.deliveryId)!;
      return { state: d.state, expectedArrival: d.expectedArrival, quantity: l.quantity };
    });
    summaries.set(workOrderId, workOrderImpact(woLinks[0].productionStart, portions));
  }

  const rows = deliveries.map((d): DeliveryRow => {
    const affected = (linksByDelivery.get(d.deliveryId) ?? []).map(
      (l): AffectedWorkOrder => ({
        workOrderLinkId: l.workOrderLinkId,
        workOrderId: l.workOrderId,
        number: l.number,
        program: l.program,
        productionStart: l.productionStart,
        quantity: l.quantity,
        status: linkStatus(d.state, d.expectedArrival, l.productionStart),
        summary: summaries.get(l.workOrderId)!,
      }),
    );
    // Delivery-level follow-ups plus PO-level ones apply to the row.
    const followUps = openFollowUps.filter(
      (f) => f.deliveryId === d.deliveryId || (f.deliveryId === null && f.poId === d.poId),
    );
    const dueFollowUps = followUps.filter((f) => f.dueDate <= demoDate).length;
    const reasons = attentionReasons(
      { state: d.state, expectedArrival: d.expectedArrival, productionStarts: affected.map((a) => a.productionStart) },
      demoDate,
      dueFollowUps,
    );
    const next = followUps[0];
    return {
      ...d,
      earliestStart: earliestDate(affected.map((a) => a.productionStart)),
      affected,
      reasons,
      primaryReason: reasons[0],
      nextFollowUp: next ? { id: next.id, dueDate: next.dueDate, note: next.note, deliveryId: next.deliveryId } : null,
      openFollowUps: followUps.length,
      dueFollowUps,
    };
  });

  return rows.sort(
    (a, b) =>
      compareAttention(a, b) ||
      a.poNumber.localeCompare(b.poNumber) ||
      a.lineNo - b.lineNo ||
      a.deliveryId - b.deliveryId,
  );
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
