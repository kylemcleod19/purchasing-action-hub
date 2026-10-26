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
  warehouseName: string;
  /** Inherited from the PO's single work order. */
  workOrderId: number;
  workOrderNumber: string;
  program: string;
  receivedAt: string | null;
  /** Source and time of the latest arrival-information update. */
  source: string;
  arrivalUpdatedAt: string | null;
  risk: PhysicalRisk;
  issue: OpenIssue | null;
  /** Most recent resolution, shown when no issue is open. */
  lastResolution: Resolution | null;
  openFollowUps: number;
  dueFollowUps: number;
}

export interface IncomingResponse {
  demoDate: string;
  rows: DeliveryRow[];
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
  source: string | null;
  note: string | null;
  createdAt: string;
}

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
}

export interface MetaResponse {
  demoDate: string;
  demoMode: boolean;
  seedVersion: string | null;
  currentSeedVersion: string;
}

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}
