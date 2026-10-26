export type DeliveryState = 'planned' | 'in_transit' | 'received';
export const DELIVERY_STATES: DeliveryState[] = ['planned', 'in_transit', 'received'];
export type UpdateSource = 'supplier_email' | 'supplier_call' | 'carrier_update' | 'other';
export const UPDATE_SOURCES: UpdateSource[] = ['supplier_email', 'supplier_call', 'carrier_update', 'other'];

/** Ordered strongest first; the order is the demo's attention ranking (PRD §6A). */
export const ATTENTION_ORDER = ['date_conflict', 'arrival_overdue', 'date_unknown', 'follow_up_due', 'none'] as const;
export type AttentionReason = (typeof ATTENTION_ORDER)[number];

export type DateStatus = 'late' | 'unknown' | 'no_conflict' | 'received';

export interface FollowUpSummary {
  id: number;
  dueDate: string;
  note: string;
  deliveryId: number | null;
}

export interface DeliveryRow {
  deliveryId: number;
  version: number;
  poId: number;
  poNumber: string;
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
  productionStart: string;
  quantity: number;
  state: DeliveryState;
  expectedArrival: string | null;
  receivedDate: string | null;
  /** Source and time of the latest arrival-information update. */
  source: string;
  updatedAt: string | null;
  dateStatus: DateStatus;
  reasons: AttentionReason[];
  primaryReason: AttentionReason;
  nextFollowUp: FollowUpSummary | null;
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
  orderedQty: number;
  plannedQty: number;
  inTransitQty: number;
  receivedQty: number;
  lateQty: number;
  unknownQty: number;
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
}

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}
