// Date-impact and attention rules (PRD §6A, §8). Pure functions shared by the server and the
// client's split preview. The server's result is authoritative.
import { ATTENTION_ORDER, type AttentionReason, type DeliveryState, type LinkStatus } from './types.js';

/** Impact of one delivery on one linked work order. Unknown is never treated as on time. */
export function linkStatus(state: DeliveryState, expectedArrival: string | null, productionStart: string): LinkStatus {
  if (state === 'received') return 'received';
  if (expectedArrival === null) return 'unknown';
  // Later than start is late; the same date is not a calculated conflict.
  return expectedArrival > productionStart ? 'late' : 'no_conflict';
}

export interface DeliveryInput {
  state: DeliveryState;
  expectedArrival: string | null;
  productionStarts: string[];
}

/**
 * All attention reasons for a delivery, strongest first. Always returns at least one entry
 * ('none' when nothing applies). Received deliveries have no active alerts.
 */
export function attentionReasons(delivery: DeliveryInput, demoDate: string, dueFollowUps: number): AttentionReason[] {
  if (delivery.state === 'received') return ['none'];
  const reasons = new Set<AttentionReason>();
  for (const start of delivery.productionStarts) {
    if (linkStatus(delivery.state, delivery.expectedArrival, start) === 'late') reasons.add('date_conflict');
  }
  if (delivery.expectedArrival !== null && delivery.expectedArrival < demoDate) reasons.add('arrival_overdue');
  if (delivery.expectedArrival === null) reasons.add('date_unknown');
  if (dueFollowUps > 0) reasons.add('follow_up_due');
  if (reasons.size === 0) reasons.add('none');
  return ATTENTION_ORDER.filter((r) => reasons.has(r));
}

export function earliestDate(dates: string[]): string | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (b < a ? b : a));
}

export interface WorkOrderDeliveryPortion {
  state: DeliveryState;
  expectedArrival: string | null;
  quantity: number;
}

/**
 * Late and unknown quantities for one work order across its outstanding deliveries.
 * Only the late portion counts as late; the work order's full quantity is never labeled late.
 */
export function workOrderImpact(productionStart: string, portions: WorkOrderDeliveryPortion[]) {
  let linkedQty = 0;
  let lateQty = 0;
  let unknownQty = 0;
  for (const p of portions) {
    if (p.state === 'received') continue;
    linkedQty += p.quantity;
    const status = linkStatus(p.state, p.expectedArrival, productionStart);
    if (status === 'late') lateQty += p.quantity;
    if (status === 'unknown') unknownQty += p.quantity;
  }
  return { linkedQty, lateQty, unknownQty };
}

/**
 * Demo ordering rule for incoming rows: attention group, then earliest affected production start
 * (unknown starts last). Not an optimized priority; supplier criticality is not modeled.
 */
export function compareAttention(
  a: { primaryReason: AttentionReason; earliestStart: string | null },
  b: { primaryReason: AttentionReason; earliestStart: string | null },
): number {
  const rank = ATTENTION_ORDER.indexOf(a.primaryReason) - ATTENTION_ORDER.indexOf(b.primaryReason);
  if (rank !== 0) return rank;
  if (a.earliestStart === b.earliestStart) return 0;
  if (a.earliestStart === null) return 1;
  if (b.earliestStart === null) return -1;
  return a.earliestStart < b.earliestStart ? -1 : 1;
}
