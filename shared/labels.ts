// Display labels. PRD §5 vocabulary lives here so wording can change in one place.
import type {
  ActorType,
  CallTaskState,
  CarrierStatus,
  DeliveryState,
  ExclusionReason,
  IssueReason,
  ReplyClassification,
  ResolutionOutcome,
  ResponseState,
  UpdateSource,
} from './types.js';

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
  arrival_confirmed: 'Arrival confirmed',
  outreach_sent: 'Supplier request sent (simulated)',
  reply_processed: 'Supplier reply processed',
  reply_needs_review: 'Reply needs review',
  call_task_created: 'Call task created',
  call_task_updated: 'Call task items added',
  call_task_started: 'Call task started',
  call_task_completed: 'Call task completed',
  call_task_answered: 'Call task answered by supplier',
  carrier_event_applied: 'Carrier update applied',
  carrier_event_ignored: 'Carrier update ignored',
  carrier_update_held: 'Carrier update held for review',
  carrier_delivered: 'Carrier delivered',
  clock_advanced: 'Demo clock advanced',
};

export const DEMO_ACTOR_NOTE = 'Actor is the PO buyer (demo actor; no login).';

export const ACTOR_TYPE_LABELS: Record<ActorType, string> = {
  buyer: 'Buyer (demo)',
  simulated_automation: 'Simulated automation',
  system: 'System',
};

/** Shown wherever fixture-driven reply processing appears. It is not real extraction. */
export const SIMULATION_LABEL = 'Simulated AI reply processing';

export const TRACKING_UNAVAILABLE = 'Tracking unavailable';

export const CARRIER_STATUS_LABELS: Record<CarrierStatus, string> = {
  in_transit: 'In transit',
  delayed: 'Delayed',
  delivered: 'Delivered / receipt pending',
};

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  received: 'Received',
  tracked: 'Usable carrier tracking',
  awaiting_response: 'Awaiting supplier response',
  recent_update: 'Updated within 3 business days',
  below_half: 'Below 50% of lead time',
  invalid_interval: 'Invalid creation-to-dock interval',
  missing_created_date: 'No PO creation date',
  line_cap: 'Over 20-line cap; next run',
};

export const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  confirmed_arrival: 'Confirmed arrival',
  revised_arrival: 'Revised arrival',
  ambiguous: 'Ambiguous',
  unmatched: 'Unmatched',
  proposed_split: 'Proposed split',
  missing: 'Not mentioned',
};

export const RESPONSE_STATE_LABELS: Record<ResponseState, string> = {
  awaiting: 'Awaiting answer',
  answered: 'Answered',
  needs_review: 'Needs review',
};

export const CALL_TASK_STATE_LABELS: Record<CallTaskState, string> = {
  open: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  answered: 'Answered by supplier',
};

export const OUTREACH_REQUEST_TEXT =
  'Please confirm the expected arrival dates at our warehouse below, or provide revised dates and quantities.';

export const DATE_RULES_NOTE =
  'Late: expected arrival after required dock date. Production conflict: expected arrival after production start. Equal dates are not flagged; receiving and inspection time are not modeled.';
