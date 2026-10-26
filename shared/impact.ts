// Date-impact and attention rules (PRD §6A, §8). Pure functions shared by the server and the
// client's split preview. The server's result is authoritative. Every delivery is evaluated against
// the production start of its PO's single work order.
import { ATTENTION_ORDER, type AttentionReason, type DateStatus, type DeliveryState } from './types.js';

/** Date impact of one delivery on its work order. Unknown is never treated as on time. */
export function dateStatus(state: DeliveryState, expectedArrival: string | null, productionStart: string): DateStatus {
  if (state === 'received') return 'received';
  if (expectedArrival === null) return 'unknown';
  // Later than start is late; the same date is not a calculated conflict.
  return expectedArrival > productionStart ? 'late' : 'no_conflict';
}

export interface DeliveryInput {
  state: DeliveryState;
  expectedArrival: string | null;
  productionStart: string;
}

/**
 * All attention reasons for a delivery, strongest first. Always returns at least one entry
 * ('none' when nothing applies). Received deliveries have no active alerts.
 */
export function attentionReasons(delivery: DeliveryInput, demoDate: string, dueFollowUps: number): AttentionReason[] {
  if (delivery.state === 'received') return ['none'];
  const reasons = new Set<AttentionReason>();
  if (dateStatus(delivery.state, delivery.expectedArrival, delivery.productionStart) === 'late') reasons.add('date_conflict');
  if (delivery.expectedArrival !== null && delivery.expectedArrival < demoDate) reasons.add('arrival_overdue');
  if (delivery.expectedArrival === null) reasons.add('date_unknown');
  if (dueFollowUps > 0) reasons.add('follow_up_due');
  if (reasons.size === 0) reasons.add('none');
  return ATTENTION_ORDER.filter((r) => reasons.has(r));
}

/**
 * Late and unknown-date quantities for one PO item across its active deliveries. Quantities of
 * different parts are never summed into a work-order quantity.
 */
export function itemImpact(productionStart: string, deliveries: { state: DeliveryState; expectedArrival: string | null; quantity: number }[]) {
  let lateQty = 0;
  let unknownQty = 0;
  for (const d of deliveries) {
    const status = dateStatus(d.state, d.expectedArrival, productionStart);
    if (status === 'late') lateQty += d.quantity;
    if (status === 'unknown') unknownQty += d.quantity;
  }
  return { lateQty, unknownQty };
}

/**
 * Demo ordering rule for incoming rows: attention group, then the PO's production start
 * (unknown starts last). Not an optimized priority; supplier criticality is not modeled.
 */
export function compareAttention(
  a: { primaryReason: AttentionReason; productionStart: string | null },
  b: { primaryReason: AttentionReason; productionStart: string | null },
): number {
  const rank = ATTENTION_ORDER.indexOf(a.primaryReason) - ATTENTION_ORDER.indexOf(b.primaryReason);
  if (rank !== 0) return rank;
  if (a.productionStart === b.productionStart) return 0;
  if (a.productionStart === null) return 1;
  if (b.productionStart === null) return -1;
  return a.productionStart < b.productionStart ? -1 : 1;
}
