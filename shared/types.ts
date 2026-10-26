/** Internal delivery states; `planned` is displayed as "Not shipped". */
export type DeliveryState = 'planned' | 'in_transit' | 'received';
export const DELIVERY_STATES: DeliveryState[] = ['planned', 'in_transit', 'received'];
export type UpdateSource = 'supplier_email' | 'supplier_call' | 'carrier_update' | 'other';
export const UPDATE_SOURCES: UpdateSource[] = ['supplier_email', 'supplier_call', 'carrier_update', 'other'];

/** Physical date risk, derived from dates (PRD §5, §8). Ordered strongest first for display. */
export const RISK_REASONS = ['production_conflict', 'late', 'overdue', 'unknown'] as const;
export type RiskReason = (typeof RISK_REASONS)[number];

/** Reasons an issue can carry: physical risks plus an estimate that moved later. */
export type IssueReason = RiskReason | 'moved_later';

export const RESOLUTION_OUTCOMES = ['accepted_delay', 'date_restored', 'split_agreed', 'reviewed'] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export interface DeliveryFacts {
  state: DeliveryState;
  expectedArrival: string | null;
  quantity: number;
  requiredDock: string;
  productionStart: string;
}

/** Snapshot stored with a disposition: the exact facts the buyer reviewed. */
export interface ReviewedFacts extends DeliveryFacts {
  reasons: RiskReason[];
  demoDate: string;
}

export interface PhysicalRisk {
  reasons: RiskReason[];
  /** Days after required dock date; null unless late. */
  daysLate: number | null;
  /** Days after production start; null unless conflicting. */
  daysAfterStart: number | null;
  /** Days past expected arrival; null unless overdue. */
  daysOverdue: number | null;
}

export interface OpenIssue {
  id: number;
  version: number;
  reasons: IssueReason[];
  openedAt: string;
  previousIssueId: number | null;
  parentIssueId: number | null;
}

export interface Resolution {
  issueId: number;
  outcome: ResolutionOutcome;
  resolvedAt: string;
  resolvedBy: string;
  note: string | null;
}

/** Shipment linked to a delivery. Carrier status is separate from warehouse receipt. */
export type CarrierStatus = 'in_transit' | 'delayed' | 'delivered';

export interface ShipmentInfo {
  id: number;
  number: string;
  /** Null for the dispatched quantity whose carrier and tracking number are unknown. */
  carrier: string | null;
  trackingNumber: string | null;
  trackingUsable: boolean;
  carrierStatus: CarrierStatus;
  expectedArrival: string | null;
  dispatchedAt: string | null;
  carrierDeliveredAt: string | null;
  latestEventAt: string | null;
}

export interface DeliveryRow extends DeliveryFacts {
  deliveryId: number;
  version: number;
  poId: number;
  poNumber: string;
  buyer: string;
  supplierId: number;
  supplierName: string;
  poLineId: number;
  lineNo: number;
  partNumber: string;
  description: string;
  unit: string;
  warehouseId: number;
  warehouseName: string;
  /** Inherited from the PO's single work order. */
  workOrderId: number;
  workOrderNumber: string;
  program: string;
  receivedAt: string | null;
  /** Source and time of the latest arrival-information update. */
  source: string;
  arrivalUpdatedAt: string | null;
  /** Latest substantive supplier confirmation; outgoing requests never set it. */
  lastSupplierConfirmationAt: string | null;
  shipment: ShipmentInfo | null;
  risk: PhysicalRisk;
  issue: OpenIssue | null;
  /** Most recent resolution, shown when no issue is open. */
  lastResolution: Resolution | null;
  openFollowUps: number;
  dueFollowUps: number;
}

export interface FilterOptions {
  destinations: { id: number; name: string }[];
  /** Existing work-order program values, displayed as "Program line". */
  programs: string[];
}

export interface IncomingResponse {
  demoDate: string;
  rows: DeliveryRow[];
  filterOptions: FilterOptions;
}

export interface FollowUp {
  id: number;
  poId: number;
  deliveryId: number | null;
  originalDeliveryId: number | null;
  dueDate: string;
  note: string;
  state: 'open' | 'completed';
  completionNote: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  isDue: boolean;
}

export interface HistoryEntry {
  id: number;
  deliveryId: number | null;
  eventType: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string | null;
  actorType: ActorType | null;
  source: string | null;
  sourceRef: string | null;
  note: string | null;
  createdAt: string;
}

export type ActorType = 'buyer' | 'simulated_automation' | 'system';

export interface PoLineDetail {
  id: number;
  lineNo: number;
  partNumber: string;
  description: string;
  unit: string;
  requiredDock: string;
  /** Full item totals: Received <= Shipped <= Ordered. Shipped includes received units. */
  orderedQty: number;
  shippedQty: number;
  receivedQty: number;
  openIssueCount: number;
  deliveries: DeliveryRow[];
}

export interface PurchaseOrderDetail {
  demoDate: string;
  po: {
    id: number;
    number: string;
    status: string;
    buyer: string;
    supplierName: string;
    warehouseName: string;
    workOrderNumber: string;
    program: string;
    productionStart: string;
  };
  lines: PoLineDetail[];
  followUps: FollowUp[];
  history: HistoryEntry[];
  correspondence: OutreachRequestView[];
  callTasks: CallTaskView[];
  carrierEvents: CarrierEventView[];
}

export interface MetaResponse {
  demoDate: string;
  /** Simulated clock (UTC); presented in America/Chicago. */
  demoClock: string;
  demoMode: boolean;
  seedVersion: string | null;
  currentSeedVersion: string;
  /** False on upgraded data that predates the scenario fixtures; a reset installs them. */
  fixturesInstalled: boolean;
}

// ---- Supplier outreach and carrier simulation (PRD §13) ----

export type ResponseState = 'awaiting' | 'answered' | 'needs_review';
export type ReplyClassification = 'confirmed_arrival' | 'revised_arrival' | 'ambiguous' | 'unmatched' | 'proposed_split' | 'missing';
export type DateType = 'arrival' | 'ship' | 'unknown';
export type CallTaskState = 'open' | 'in_progress' | 'completed' | 'answered';

export type ExclusionReason =
  | 'received'
  | 'tracked'
  | 'awaiting_response'
  | 'recent_update'
  | 'below_half'
  | 'invalid_interval'
  | 'missing_created_date'
  | 'line_cap';

/** One delivery quantity considered for automatic supplier outreach. */
export interface OutreachDelivery {
  deliveryId: number;
  version: number;
  poId: number;
  poNumber: string;
  poLineId: number;
  lineNo: number;
  supplierId: number;
  supplierName: string;
  partNumber: string;
  description: string;
  unit: string;
  quantity: number;
  state: DeliveryState;
  expectedArrival: string | null;
  requiredDock: string;
  poCreatedDate: string | null;
  /** Latest arrival-information update or substantive confirmation. */
  lastUpdateAt: string | null;
  trackingUsable: boolean;
  awaitingResponse: boolean;
}

export interface OutreachCandidate extends OutreachDelivery {
  /** Elapsed share of the creation-to-dock interval; null when the interval is invalid. */
  elapsedFraction: number | null;
}

export interface OutreachSettings {
  staleBusinessDays: number;
  responseWindowBusinessDays: number;
  elapsedThreshold: number;
  itemCap: number;
}

export interface OutreachPreview {
  demoClock: string;
  demoDate: string;
  settings: OutreachSettings;
  suppliers: { supplierId: number; supplierName: string; sentToday: boolean; items: OutreachCandidate[] }[];
  excluded: (OutreachCandidate & { reason: ExclusionReason })[];
}

export interface MessageResultView {
  id: number;
  outreachItemId: number | null;
  classification: ReplyClassification;
  dateType: DateType;
  proposedDate: string | null;
  proposedQty: number | null;
  evidenceText: string | null;
  appliedAt: string | null;
  reviewReason: string | null;
}

export interface SupplierMessageView {
  id: number;
  direction: 'outbound' | 'inbound';
  recipient: string | null;
  subject: string;
  body: string;
  at: string;
  processingState: string;
  results: MessageResultView[];
}

export interface OutreachItemView {
  id: number;
  deliveryId: number;
  poId: number;
  poNumber: string;
  lineNo: number;
  partNumber: string;
  requestedQty: number;
  unit: string;
  expectedArrivalSnapshot: string | null;
  responseState: ResponseState;
  answeredAt: string | null;
}

export interface OutreachRequestView {
  id: number;
  supplierName: string;
  sentAt: string;
  responseDueAt: string;
  state: 'open' | 'closed';
  items: OutreachItemView[];
  messages: SupplierMessageView[];
  callTaskId: number | null;
}

export interface CallTaskView {
  id: number;
  requestId: number;
  supplierName: string;
  buyer: string;
  state: CallTaskState;
  createdAt: string;
  dueAt: string;
  completedAt: string | null;
  completionNote: string | null;
  version: number;
  items: (OutreachItemView & { taskResponseState: ResponseState })[];
}

export interface CarrierEventView {
  id: number;
  shipmentId: number;
  externalEventId: string;
  occurredAt: string;
  receivedAt: string;
  status: string;
  eta: string | null;
  appliedState: 'applied' | 'partially_applied' | 'ignored' | 'held_for_review';
  ignoredReason: string | null;
}

export interface ScenarioStep {
  key: string;
  kind: 'send' | 'reply' | 'carrier' | 'clock';
  label: string;
  /** Why the step cannot run now; null when it can. */
  blockedReason: string | null;
  done: boolean;
}

export interface ScenarioCase {
  key: 'A' | 'B';
  title: string;
  summary: string;
  supplierId: number | null;
  supplierName: string;
  poIds: number[];
  steps: ScenarioStep[];
}

export interface ScenariosResponse {
  demoClock: string;
  demoDate: string;
  fixturesInstalled: boolean;
  cases: ScenarioCase[];
}

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}
