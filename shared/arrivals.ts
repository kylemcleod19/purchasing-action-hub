// Ordering rules for the PO item table's Arrivals stack and item rows (PRD §6B).
import type { DeliveryRow } from './types.js';

type Arrival = Pick<DeliveryRow, 'deliveryId' | 'state' | 'expectedArrival' | 'receivedAt' | 'risk' | 'issue'>;

/** 0 open issue, 1 outstanding late/unknown/overdue, 2 other outstanding, 3 received. */
export function arrivalGroup(d: Arrival): number {
  if (d.issue) return 0;
  if (d.state === 'received') return 3;
  return d.risk.reasons.length > 0 ? 1 : 2;
}

export const arrivalDate = (d: Arrival) => (d.state === 'received' ? d.receivedAt : d.expectedArrival);

export function prioritizeArrivals<T extends Arrival>(deliveries: T[]): T[] {
  return [...deliveries].sort((a, b) => {
    const group = arrivalGroup(a) - arrivalGroup(b);
    if (group !== 0) return group;
    const da = arrivalDate(a);
    const db = arrivalDate(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    }
    return a.deliveryId - b.deliveryId;
  });
}

/** Item ordering: open issues first, then unresolved physical date risk, then others. */
export function itemRank(deliveries: Arrival[]): number {
  if (deliveries.some((d) => d.issue)) return 0;
  if (deliveries.some((d) => d.state !== 'received' && d.risk.reasons.length > 0)) return 1;
  return 2;
}

/**
 * Cumulative item quantities over active deliveries: Shipped includes received units, so
 * Received <= Shipped <= Ordered. In transit = Shipped - Received; Not shipped = Ordered - Shipped.
 */
export function itemQuantities(deliveries: Pick<DeliveryRow, 'state' | 'quantity'>[]) {
  const sum = (pred: (d: Pick<DeliveryRow, 'state'>) => boolean) => deliveries.filter(pred).reduce((s, d) => s + d.quantity, 0);
  return { shippedQty: sum((d) => d.state !== 'planned'), receivedQty: sum((d) => d.state === 'received') };
}
