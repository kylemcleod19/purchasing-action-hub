// Automatic supplier-outreach eligibility and ranking (PRD §13 "Outreach eligibility"). Pure and
// server-authoritative; the send endpoint rechecks it inside its transaction. The parameters are
// configurable initial defaults, not optimized findings. Nothing here learns or tunes cadence.
import { businessDaysBetween, localDate } from './clock.js';
import { daysBetween } from './dates.js';
import type { ExclusionReason, OutreachCandidate, OutreachDelivery, OutreachSettings } from './types.js';

export const DEFAULT_OUTREACH_SETTINGS: OutreachSettings = {
  staleBusinessDays: 3,
  responseWindowBusinessDays: 1,
  elapsedThreshold: 0.5,
  itemCap: 20,
};

/** (demo date − PO creation) / (required dock − PO creation), in calendar days. Null when invalid. */
export function elapsedFraction(demoDate: string, createdDate: string, requiredDock: string): number | null {
  const interval = daysBetween(createdDate, requiredDock);
  if (interval <= 0) return null;
  return daysBetween(createdDate, demoDate) / interval;
}

/** The first reason a delivery quantity is excluded from automatic outreach, or null if eligible. */
export function exclusionReason(d: OutreachDelivery, clock: string, settings: OutreachSettings): ExclusionReason | null {
  const demoDate = localDate(clock);
  if (d.state === 'received') return 'received';
  // Tracked portions defer to the carrier; an unshipped remainder of the same item is still eligible.
  if (d.trackingUsable) return 'tracked';
  if (d.awaitingResponse) return 'awaiting_response';
  if (!d.poCreatedDate) return 'missing_created_date';
  const fraction = elapsedFraction(demoDate, d.poCreatedDate, d.requiredDock);
  if (fraction === null) return 'invalid_interval';
  // Equality is eligible. Overdue items with a valid interval remain eligible.
  if (fraction < settings.elapsedThreshold) return 'below_half';
  // Exactly `staleBusinessDays` old is stale. An unanswered outgoing email is not an update.
  if (d.lastUpdateAt && businessDaysBetween(localDate(d.lastUpdateAt), demoDate) < settings.staleBusinessDays) return 'recent_update';
  return null;
}

/** Earlier non-null of required dock and expected arrival. */
const keyDate = (d: OutreachDelivery) => (d.expectedArrival !== null && d.expectedArrival < d.requiredDock ? d.expectedArrival : d.requiredDock);

/**
 * Ranking: overdue key dates first (earliest first), then nearest upcoming key date, then oldest or
 * missing substantive update, then stable PO / line / delivery order.
 */
export function compareCandidates(demoDate: string) {
  return (a: OutreachDelivery, b: OutreachDelivery): number => {
    const ka = keyDate(a);
    const kb = keyDate(b);
    const overdue = Number(kb < demoDate) - Number(ka < demoDate);
    if (overdue !== 0) return overdue;
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.lastUpdateAt !== b.lastUpdateAt) {
      if (a.lastUpdateAt === null) return -1;
      if (b.lastUpdateAt === null) return 1;
      return a.lastUpdateAt < b.lastUpdateAt ? -1 : 1;
    }
    return a.poNumber.localeCompare(b.poNumber) || a.lineNo - b.lineNo || a.deliveryId - b.deliveryId;
  };
}

export interface OutreachSelection {
  suppliers: { supplierId: number; supplierName: string; items: OutreachCandidate[] }[];
  excluded: (OutreachCandidate & { reason: ExclusionReason })[];
}

/**
 * Groups eligible delivery quantities by supplier across POs, ranked, capped at `itemCap` distinct PO
 * item lines per supplier. Deliveries of an included line stay together; later lines wait for a
 * later run (excluded as `line_cap`).
 */
export function selectOutreachCandidates(deliveries: OutreachDelivery[], clock: string, settings: OutreachSettings): OutreachSelection {
  const demoDate = localDate(clock);
  const withFraction = (d: OutreachDelivery): OutreachCandidate => ({
    ...d,
    elapsedFraction: d.poCreatedDate ? elapsedFraction(demoDate, d.poCreatedDate, d.requiredDock) : null,
  });
  const excluded: OutreachSelection['excluded'] = [];
  const bySupplier = new Map<number, OutreachCandidate[]>();
  for (const d of deliveries) {
    const candidate = withFraction(d);
    const reason = exclusionReason(d, clock, settings);
    if (reason) excluded.push({ ...candidate, reason });
    else bySupplier.set(d.supplierId, [...(bySupplier.get(d.supplierId) ?? []), candidate]);
  }

  const suppliers: OutreachSelection['suppliers'] = [];
  for (const [supplierId, items] of bySupplier) {
    const ranked = items.sort(compareCandidates(demoDate));
    const lines: number[] = [];
    for (const item of ranked) if (!lines.includes(item.poLineId)) lines.push(item.poLineId);
    const included = new Set(lines.slice(0, settings.itemCap));
    suppliers.push({ supplierId, supplierName: ranked[0].supplierName, items: ranked.filter((i) => included.has(i.poLineId)) });
    for (const item of ranked) if (!included.has(item.poLineId)) excluded.push({ ...item, reason: 'line_cap' });
  }
  suppliers.sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  return { suppliers, excluded };
}
