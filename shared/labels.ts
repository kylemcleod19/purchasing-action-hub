// Display labels. PRD §5 vocabulary lives here so wording can change in one place.
import type { DeliveryState, IssueReason, ResolutionOutcome, UpdateSource } from './types.js';

export const DELIVERY_STATE_LABELS: Record<DeliveryState, string> = {
  planned: 'Not shipped',
  in_transit: 'In transit',
  received: 'Received',
};

export const REASON_LABELS: Record<IssueReason, string> = {
  production_conflict: 'Production conflict',
  late: 'Late',
  overdue: 'Overdue',
  unknown: 'Date unknown',
  moved_later: 'Estimate moved later',
};

export const OUTCOME_LABELS: Record<ResolutionOutcome, string> = {
  accepted_delay: 'Accepted delay',
  date_restored: 'Date restored',
  split_agreed: 'Split delivery agreed',
  reviewed: 'Reviewed / no further action',
};

export const SOURCE_LABELS: Record<UpdateSource | 'po_schedule', string> = {
  supplier_email: 'Supplier email',
  supplier_call: 'Supplier call',
  carrier_update: 'Carrier update',
  other: 'Other',
  po_schedule: 'Initial schedule',
};

export function sourceLabel(source: string | null): string {
  if (!source) return '—';
  return (SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

export const EVENT_LABELS: Record<string, string> = {
  arrival_updated: 'Arrival updated',
  delivery_split: 'Delivery split',
  issue_opened: 'Issue opened',
  issue_updated: 'Issue reasons changed',
  issue_resolved: 'Issue resolved',
  issue_superseded: 'Issue carried to split',
  follow_up_added: 'Reminder added',
  follow_up_edited: 'Reminder edited',
  follow_up_completed: 'Reminder completed',
  follow_up_moved: 'Reminder moved to PO level',
};

export const DEMO_ACTOR_NOTE = 'Actor is the PO buyer (demo actor; no login).';

export const DATE_RULES_NOTE =
  'Late: expected arrival after required dock date. Production conflict: expected arrival after production start. Equal dates are not flagged; receiving and inspection time are not modeled.';
