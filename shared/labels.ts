// Display labels. PRD §5 vocabulary lives here so wording can change in one place.
import type { AttentionReason, DateStatus, DeliveryState, UpdateSource } from './types.js';

export const DELIVERY_STATE_LABELS: Record<DeliveryState, string> = {
  planned: 'Planned delivery',
  in_transit: 'In transit',
  received: 'Received',
};

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  date_conflict: 'Late',
  arrival_overdue: 'Arrival overdue',
  date_unknown: 'Date unknown',
  follow_up_due: 'Follow-up due',
  none: 'No identified date issue',
};

export const DATE_STATUS_LABELS: Record<DateStatus, string> = {
  late: 'Late',
  unknown: 'Date unknown',
  no_conflict: 'No date conflict',
  received: 'Received',
};

export const SOURCE_LABELS: Record<UpdateSource | 'po_schedule', string> = {
  supplier_email: 'Supplier email',
  supplier_call: 'Supplier call',
  carrier_update: 'Carrier update',
  other: 'Other',
  po_schedule: 'Initial PO schedule',
};

export function sourceLabel(source: string | null): string {
  if (!source) return '—';
  return (SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

export const EVENT_LABELS: Record<string, string> = {
  arrival_updated: 'Expected arrival updated',
  delivery_split: 'Planned delivery split',
  follow_up_added: 'Follow-up added',
  follow_up_edited: 'Follow-up edited',
  follow_up_completed: 'Follow-up completed',
  follow_up_moved: 'Follow-up moved to PO level',
};

export const PROCESSING_TIME_NOTE =
  'Date checks compare expected arrival with the work order’s production start only. All material is assumed needed at start. Receiving and inspection time are not modeled, so an arrival on the start date is not flagged.';
