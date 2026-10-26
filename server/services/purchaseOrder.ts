import type { DB } from '../db/db.js';
import { loadDeliveryRows } from './incoming.js';
import { itemImpact } from '../../shared/impact.js';
import type { FollowUp, HistoryEntry, PoLineDetail, PurchaseOrderDetail } from '../../shared/types.js';

export function getPurchaseOrderDetail(db: DB, poId: number, demoDate: string): PurchaseOrderDetail | null {
  const po = db
    .prepare(
      `SELECT p.id, p.number, p.status, p.buyer, s.name AS supplierName, w.name AS warehouseName,
              wo.number AS workOrderNumber, wo.program, wo.production_start AS productionStart
       FROM purchase_orders p
       JOIN suppliers s ON s.id = p.supplier_id
       JOIN warehouses w ON w.id = p.warehouse_id
       JOIN work_orders wo ON wo.id = p.work_order_id
       WHERE p.id = ?`,
    )
    .get(poId) as PurchaseOrderDetail['po'] | undefined;
  if (!po) return null;

  const rows = loadDeliveryRows(db, demoDate)
    .filter((r) => r.poId === poId)
    .sort((a, b) => a.deliveryId - b.deliveryId);

  const lines = (
    db
      .prepare(
        `SELECT id, line_no AS lineNo, part_number AS partNumber, description, unit, ordered_qty AS orderedQty
         FROM po_lines WHERE po_id = ? ORDER BY line_no`,
      )
      .all(poId) as Pick<PoLineDetail, 'id' | 'lineNo' | 'partNumber' | 'description' | 'unit' | 'orderedQty'>[]
  ).map((line): PoLineDetail => {
    const deliveries = rows.filter((r) => r.poLineId === line.id);
    const qty = (state: string) => deliveries.filter((d) => d.state === state).reduce((s, d) => s + d.quantity, 0);
    return {
      ...line,
      plannedQty: qty('planned'),
      inTransitQty: qty('in_transit'),
      receivedQty: qty('received'),
      ...itemImpact(po.productionStart, deliveries),
      deliveries,
    };
  });

  const followUps = (
    db
      .prepare(
        `SELECT id, po_id AS poId, delivery_id AS deliveryId, original_delivery_id AS originalDeliveryId,
                due_date AS dueDate, note, state, completion_note AS completionNote, completed_at AS completedAt,
                created_at AS createdAt, updated_at AS updatedAt, version
         FROM follow_ups WHERE po_id = ?
         ORDER BY state = 'completed', due_date, id`,
      )
      .all(poId) as Omit<FollowUp, 'isDue'>[]
  ).map((f): FollowUp => ({ ...f, isDue: f.state === 'open' && f.dueDate <= demoDate }));

  const history = (
    db
      .prepare(
        `SELECT id, delivery_id AS deliveryId, event_type AS eventType, before_json, after_json, source, note,
                created_at AS createdAt
         FROM change_history WHERE po_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(poId) as (Omit<HistoryEntry, 'before' | 'after'> & { before_json: string | null; after_json: string | null })[]
  ).map(({ before_json, after_json, ...rest }): HistoryEntry => ({
    ...rest,
    before: before_json ? JSON.parse(before_json) : null,
    after: after_json ? JSON.parse(after_json) : null,
  }));

  return { demoDate, po, lines, followUps, history };
}
