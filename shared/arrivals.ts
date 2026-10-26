// Ordering rules for the PO item table's Arrivals stack and item rows (PRD §6B).
import type { DeliveryRow, PoLineDetail } from './types.js';

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

/** PO item table columns that can sort. The default is always line number ascending. */
export type ItemSortKey = 'line' | 'part' | 'description' | 'unit' | 'ordered' | 'shipped' | 'received' | 'dock' | 'arrivals';
export interface ItemSort {
  key: ItemSortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_ITEM_SORT: ItemSort = { key: 'line', dir: 'asc' };
const ITEM_SORT_KEYS: ItemSortKey[] = ['line', 'part', 'description', 'unit', 'ordered', 'shipped', 'received', 'dock', 'arrivals'];

type SortableItem = Pick<PoLineDetail, 'lineNo' | 'partNumber' | 'description' | 'unit' | 'orderedQty' | 'shippedQty' | 'receivedQty' | 'requiredDock'>;

/** Arrivals sorts by the earliest date the cell shows for the filtered deliveries; all-unknown is empty. */
function itemValue(line: SortableItem, matching: Arrival[], key: ItemSortKey): string | number | null {
  switch (key) {
    case 'line':
      return line.lineNo;
    case 'part':
      return line.partNumber;
    case 'description':
      return line.description.toLowerCase();
    case 'unit':
      return line.unit;
    case 'ordered':
      return line.orderedQty;
    case 'shipped':
      return line.shippedQty;
    case 'received':
      return line.receivedQty;
    case 'dock':
      return line.requiredDock;
    case 'arrivals': {
      const dates = matching.map(arrivalDate).filter((d): d is string => d !== null).sort();
      return dates[0] ?? null;
    }
  }
}

/** Empty values sort last in either direction; ties fall back to line number ascending. */
export function compareItems(sort: ItemSort) {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return (a: { line: SortableItem; matching: Arrival[] }, b: { line: SortableItem; matching: Arrival[] }): number => {
    const va = itemValue(a.line, a.matching, sort.key);
    const vb = itemValue(b.line, b.matching, sort.key);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * sign;
    }
    return a.line.lineNo - b.line.lineNo;
  };
}

/** Reads the item sort from the URL; missing or unknown values mean the default line order. */
export function parseItemSort(params: URLSearchParams): ItemSort {
  const key = params.get('sort') as ItemSortKey | null;
  if (!key || !ITEM_SORT_KEYS.includes(key)) return DEFAULT_ITEM_SORT;
  return { key, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' };
}

const isDefault = (s: ItemSort) => s.key === DEFAULT_ITEM_SORT.key && s.dir === DEFAULT_ITEM_SORT.dir;

/** Header click cycle: ascending, descending, then back to line order (Line itself toggles). */
export function nextItemSort(current: ItemSort, key: ItemSortKey): ItemSort {
  if (current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return DEFAULT_ITEM_SORT;
}

/** URL value for a sort, or null to drop the parameters for the default. */
export const itemSortParams = (s: ItemSort) => (isDefault(s) ? null : s);

/**
 * Cumulative item quantities over active deliveries: Shipped includes received units, so
 * Received <= Shipped <= Ordered. In transit = Shipped - Received; Not shipped = Ordered - Shipped.
 */
export function itemQuantities(deliveries: Pick<DeliveryRow, 'state' | 'quantity'>[]) {
  const sum = (pred: (d: Pick<DeliveryRow, 'state'>) => boolean) => deliveries.filter(pred).reduce((s, d) => s + d.quantity, 0);
  return { shippedQty: sum((d) => d.state !== 'planned'), receivedQty: sum((d) => d.state === 'received') };
}
