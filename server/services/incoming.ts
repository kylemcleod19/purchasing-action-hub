// Builds current delivery rows with server-computed date status and attention. The dataset is
// small, so every view derives from one full read rather than per-view query variants.
import type { DB } from '../db/db.js';
import { attentionReasons, compareAttention, dateStatus } from '../../shared/impact.js';
import type { DeliveryRow, DeliveryState, FollowUpSummary } from '../../shared/types.js';

type DeliveryRecord = Omit<DeliveryRow, 'dateStatus' | 'reasons' | 'primaryReason' | 'nextFollowUp' | 'openFollowUps' | 'dueFollowUps'> & {
  state: DeliveryState;
};

interface FollowUpRecord extends FollowUpSummary {
  poId: number;
}

export function loadDeliveryRows(db: DB, demoDate: string): DeliveryRow[] {
  const deliveries = db
    .prepare(
      `SELECT d.id AS deliveryId, d.version, p.id AS poId, p.number AS poNumber, s.id AS supplierId,
              s.name AS supplierName, l.id AS poLineId, l.line_no AS lineNo, l.part_number AS partNumber,
              l.description, l.unit, w.name AS warehouseName, wo.id AS workOrderId, wo.number AS workOrderNumber,
              wo.program, wo.production_start AS productionStart, d.quantity, d.state,
              d.expected_arrival AS expectedArrival, d.received_date AS receivedDate, d.source, d.updated_at AS updatedAt
       FROM deliveries d
       JOIN po_lines l ON l.id = d.po_line_id
       JOIN purchase_orders p ON p.id = l.po_id
       JOIN suppliers s ON s.id = p.supplier_id
       JOIN warehouses w ON w.id = p.warehouse_id
       JOIN work_orders wo ON wo.id = p.work_order_id
       WHERE d.superseded_at IS NULL`,
    )
    .all() as DeliveryRecord[];

  const openFollowUps = db
    .prepare(
      `SELECT id, po_id AS poId, delivery_id AS deliveryId, due_date AS dueDate, note
       FROM follow_ups WHERE state = 'open' ORDER BY due_date, id`,
    )
    .all() as FollowUpRecord[];

  const rows = deliveries.map((d): DeliveryRow => {
    // Delivery-level follow-ups plus PO-level ones apply to the row.
    const followUps = openFollowUps.filter(
      (f) => f.deliveryId === d.deliveryId || (f.deliveryId === null && f.poId === d.poId),
    );
    const dueFollowUps = followUps.filter((f) => f.dueDate <= demoDate).length;
    const reasons = attentionReasons(d, demoDate, dueFollowUps);
    const next = followUps[0];
    return {
      ...d,
      dateStatus: dateStatus(d.state, d.expectedArrival, d.productionStart),
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
