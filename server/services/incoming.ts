// Builds current delivery rows: derived physical risk plus persisted issue state. Reads never create
// or change issues. The dataset is small, so every view derives from one full read.
import type { DB } from '../db/db.js';
import { compareDeliveries, physicalRisk } from '../../shared/impact.js';
import type { DeliveryRow, OpenIssue, Resolution } from '../../shared/types.js';

type DeliveryRecord = Omit<DeliveryRow, 'risk' | 'issue' | 'lastResolution' | 'openFollowUps' | 'dueFollowUps'>;

interface IssueRecord {
  id: number;
  deliveryId: number;
  state: 'open' | 'resolved' | 'superseded';
  reasonsJson: string;
  openedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  outcome: Resolution['outcome'] | null;
  note: string | null;
  previousIssueId: number | null;
  parentIssueId: number | null;
  version: number;
}

export function loadDeliveryRows(db: DB, demoDate: string): DeliveryRow[] {
  const deliveries = db
    .prepare(
      `SELECT d.id AS deliveryId, d.version, p.id AS poId, p.number AS poNumber, p.buyer, s.id AS supplierId,
              s.name AS supplierName, l.id AS poLineId, l.line_no AS lineNo, l.part_number AS partNumber,
              l.description, l.unit, l.required_dock_date AS requiredDock, w.name AS warehouseName,
              wo.id AS workOrderId, wo.number AS workOrderNumber, wo.program, wo.production_start AS productionStart,
              d.quantity, d.state, d.expected_arrival AS expectedArrival, d.received_at AS receivedAt, d.source,
              d.arrival_updated_at AS arrivalUpdatedAt
       FROM deliveries d
       JOIN po_lines l ON l.id = d.po_line_id
       JOIN purchase_orders p ON p.id = l.po_id
       JOIN suppliers s ON s.id = p.supplier_id
       JOIN warehouses w ON w.id = p.warehouse_id
       JOIN work_orders wo ON wo.id = p.work_order_id
       WHERE d.superseded_at IS NULL`,
    )
    .all() as DeliveryRecord[];

  const issues = db
    .prepare(
      `SELECT i.id, i.delivery_id AS deliveryId, i.state, i.reasons_json AS reasonsJson, i.opened_at AS openedAt,
              i.resolved_at AS resolvedAt, i.resolved_by AS resolvedBy, i.outcome, i.note,
              i.previous_issue_id AS previousIssueId, i.parent_issue_id AS parentIssueId, i.version
       FROM delivery_issues i JOIN deliveries d ON d.id = i.delivery_id AND d.superseded_at IS NULL
       ORDER BY i.id`,
    )
    .all() as IssueRecord[];
  const openByDelivery = new Map<number, OpenIssue>();
  const resolvedByDelivery = new Map<number, Resolution>();
  for (const i of issues) {
    if (i.state === 'open') {
      openByDelivery.set(i.deliveryId, {
        id: i.id,
        version: i.version,
        reasons: JSON.parse(i.reasonsJson),
        openedAt: i.openedAt,
        previousIssueId: i.previousIssueId,
        parentIssueId: i.parentIssueId,
      });
    } else if (i.state === 'resolved' && i.outcome && i.resolvedAt) {
      // Ordered by id, so the latest resolution wins.
      resolvedByDelivery.set(i.deliveryId, {
        issueId: i.id,
        outcome: i.outcome,
        resolvedAt: i.resolvedAt,
        resolvedBy: i.resolvedBy ?? '',
        note: i.note,
      });
    }
  }

  const followUps = db
    .prepare(`SELECT po_id AS poId, delivery_id AS deliveryId, due_date AS dueDate FROM follow_ups WHERE state = 'open'`)
    .all() as { poId: number; deliveryId: number | null; dueDate: string }[];

  return deliveries
    .map((d): DeliveryRow => {
      // Reminders tied to this delivery, plus PO-level ones. They never create issues.
      const own = followUps.filter((f) => f.deliveryId === d.deliveryId || (f.deliveryId === null && f.poId === d.poId));
      return {
        ...d,
        risk: physicalRisk(d, demoDate),
        issue: openByDelivery.get(d.deliveryId) ?? null,
        lastResolution: resolvedByDelivery.get(d.deliveryId) ?? null,
        openFollowUps: own.length,
        dueFollowUps: own.filter((f) => f.dueDate <= demoDate).length,
      };
    })
    .sort(compareDeliveries);
}
