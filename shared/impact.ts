// Physical date risk (PRD §5, §8). One pure function shared by server and client previews; the
// server's result is authoritative. Physical risk is derived from dates and is independent of whether
// the buyer has dispositioned an issue.
import { daysBetween } from './dates.js';
import { RISK_REASONS, type DeliveryFacts, type PhysicalRisk, type RiskReason } from './types.js';

export function physicalRisk(facts: Pick<DeliveryFacts, 'state' | 'expectedArrival' | 'requiredDock' | 'productionStart'>, demoDate: string): PhysicalRisk {
  const none: PhysicalRisk = { reasons: [], daysLate: null, daysAfterStart: null, daysOverdue: null };
  // Received deliveries carry no active inbound alerts.
  if (facts.state === 'received') return none;
  const arrival = facts.expectedArrival;
  // Unknown is never treated as on time.
  if (arrival === null) return { ...none, reasons: ['unknown'] };
  const reasons = new Set<RiskReason>();
  const risk = { ...none };
  // Equal dates are not flagged; receiving/inspection time is not modeled.
  if (arrival > facts.requiredDock) {
    reasons.add('late');
    risk.daysLate = daysBetween(facts.requiredDock, arrival);
  }
  if (arrival > facts.productionStart) {
    reasons.add('production_conflict');
    risk.daysAfterStart = daysBetween(facts.productionStart, arrival);
  }
  if (arrival < demoDate) {
    reasons.add('overdue');
    risk.daysOverdue = daysBetween(arrival, demoDate);
  }
  return { ...risk, reasons: RISK_REASONS.filter((r) => reasons.has(r)) };
}

/** "Date restored" requires an arrival that meets the required dock date and is not overdue. */
export function meetsDateRestored(facts: Pick<DeliveryFacts, 'state' | 'expectedArrival' | 'requiredDock'>, demoDate: string): boolean {
  if (facts.state === 'received') return true;
  const arrival = facts.expectedArrival;
  return arrival !== null && arrival <= facts.requiredDock && arrival >= demoDate;
}

export interface SortableRow {
  deliveryId: number;
  issue: unknown | null;
  risk: PhysicalRisk;
  productionStart: string | null;
  requiredDock: string | null;
}

/**
 * Demo ordering rule for delivery rows: open issues first; then production conflict; then production
 * start, required dock date (unknown dates last), and stable ID. Not an optimized priority.
 */
export function compareDeliveries(a: SortableRow, b: SortableRow): number {
  return (
    Number(b.issue !== null) - Number(a.issue !== null) ||
    Number(b.risk.reasons.includes('production_conflict')) - Number(a.risk.reasons.includes('production_conflict')) ||
    compareDates(a.productionStart, b.productionStart) ||
    compareDates(a.requiredDock, b.requiredDock) ||
    a.deliveryId - b.deliveryId
  );
}

function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
