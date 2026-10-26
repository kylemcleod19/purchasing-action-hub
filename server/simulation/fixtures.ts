// Deterministic simulation fixtures (PRD §13, ARCHITECTURE §14). These are not an extractor: each
// fixture carries its raw source text and the explicit structured result it stands for, both
// generated from the same scenario anchor date. Unknown text has no fixture and gets no extracted
// result. A future real extractor can implement `ReplySource`; its output must still pass the same
// domain validation in services/replies.ts. Expected effects live separately in tests/.
import { addDays, formatDate } from '../../shared/dates.js';
import type { CarrierStatus, DateType, ReplyClassification } from '../../shared/types.js';
import { CASE_A, CASE_B } from '../db/seed.js';

/** One requested item in the reply thread, as the adapter may refer to it. */
export interface ThreadItem {
  poNumber: string;
  lineNo: number;
  partNumber: string;
  requestedQty: number;
}

export interface ExtractedResult {
  /** The PO/line the text refers to. Matching happens only against items requested in this thread. */
  ref: { poNumber: string; lineNo: number };
  classification: ReplyClassification;
  dateType: DateType;
  proposedDate: string | null;
  proposedQty: number | null;
  evidence: string;
}

export interface ReplySource {
  readonly name: string;
  /** Returns null when it has nothing trustworthy to say about the message. */
  extract(fixtureKey: string, anchor: string, items: ThreadItem[]): ExtractedResult[] | null;
}

export interface ReplyFixture {
  key: string;
  label: string;
  supplier: string;
  externalMessageId: string;
  body(anchor: string, items: ThreadItem[], buyer: string): string;
  results(anchor: string, items: ThreadItem[]): ExtractedResult[];
}

const [PO_1, PO_2] = CASE_A.poNumbers;
const day = (anchor: string, n: number) => formatDate(addDays(anchor, n));
const iso = (anchor: string, n: number) => addDays(anchor, n);
const qtyOf = (items: ThreadItem[], poNumber: string, lineNo: number) =>
  items.find((i) => i.poNumber === poNumber && i.lineNo === lineNo)?.requestedQty ?? null;
const part = (items: ThreadItem[], poNumber: string, lineNo: number) =>
  items.find((i) => i.poNumber === poNumber && i.lineNo === lineNo)?.partNumber ?? '';

const SIGNATURE = ['Dana Whitfield', 'Customer Service · Kestrel Precision Machining', 'orders@kestrel-precision.example.com'].join('\n');

export const REPLY_FIXTURES: Record<string, ReplyFixture> = {
  // Partial reply: four confirmations, two revisions, one vague ship-date line, one item not mentioned.
  'case-a-reply-1': {
    key: 'case-a-reply-1',
    label: 'Supplier reply (partial)',
    supplier: CASE_A.supplier,
    externalMessageId: 'FIXTURE-CASE-A-REPLY-1',
    body: (a, items, buyer) =>
      [
        `Hi ${buyer},`,
        '',
        "Thanks for the nudge. Here's where we are:",
        '',
        `${PO_1} lines 1-4: Confirmed arrival ${day(a, 2)}, full quantities as listed.`,
        `${PO_1} line 5 (${part(items, PO_1, 5)}): All 24 will arrive ${day(a, 4)}.`,
        `${PO_2} line 1 (${part(items, PO_2, 1)}): All 12 now arriving ${day(a, 7)}.`,
        `${PO_1} line 6: The remaining 10 should ship Friday; checking with the floor.`,
        '',
        'Sorry about the two slips, heat treat is backed up this week.',
        '',
        SIGNATURE,
        '',
        `> On ${day(a, -7)}, Dana Whitfield wrote:`,
        `> ${PO_1} line 5 and ${PO_2} line 1 are on track for ${day(a, 2)}.`,
      ].join('\n'),
    results: (a, items) => [
      ...[1, 2, 3, 4].map(
        (lineNo): ExtractedResult => ({
          ref: { poNumber: PO_1, lineNo },
          classification: 'confirmed_arrival',
          dateType: 'arrival',
          proposedDate: iso(a, 2),
          // "Full quantities as listed" binds to the quantity requested in this thread.
          proposedQty: qtyOf(items, PO_1, lineNo),
          evidence: `${PO_1} lines 1-4: Confirmed arrival ${day(a, 2)}, full quantities as listed.`,
        }),
      ),
      {
        ref: { poNumber: PO_1, lineNo: 5 },
        classification: 'revised_arrival',
        dateType: 'arrival',
        proposedDate: iso(a, 4),
        proposedQty: 24,
        evidence: `${PO_1} line 5: All 24 will arrive ${day(a, 4)}.`,
      },
      {
        ref: { poNumber: PO_2, lineNo: 1 },
        classification: 'revised_arrival',
        dateType: 'arrival',
        proposedDate: iso(a, 7),
        proposedQty: 12,
        evidence: `${PO_2} line 1: All 12 now arriving ${day(a, 7)}.`,
      },
      {
        // A relative ship date and "remaining 10" are not an arrival commitment for the requested 16.
        ref: { poNumber: PO_1, lineNo: 6 },
        classification: 'ambiguous',
        dateType: 'ship',
        proposedDate: null,
        proposedQty: 10,
        evidence: `${PO_1} line 6: The remaining 10 should ship Friday; checking with the floor.`,
      },
    ],
  },
  // Clarifying reply: clear arrival and exact quantity for the two items still open.
  'case-a-reply-2': {
    key: 'case-a-reply-2',
    label: 'Clarifying reply',
    supplier: CASE_A.supplier,
    externalMessageId: 'FIXTURE-CASE-A-REPLY-2',
    body: (a, items, buyer) =>
      [
        `Hi ${buyer},`,
        '',
        'Following up on the two open items:',
        '',
        `${PO_1} line 6: All ${qtyOf(items, PO_1, 6)} will arrive at your warehouse ${day(a, 2)}, as planned.`,
        `${PO_2} line 2: All ${qtyOf(items, PO_2, 2)} confirmed for arrival ${day(a, 2)}.`,
        '',
        SIGNATURE,
      ].join('\n'),
    results: (a, items) => [
      {
        ref: { poNumber: PO_1, lineNo: 6 },
        classification: 'confirmed_arrival',
        dateType: 'arrival',
        proposedDate: iso(a, 2),
        proposedQty: qtyOf(items, PO_1, 6),
        evidence: `${PO_1} line 6: All ${qtyOf(items, PO_1, 6)} will arrive at your warehouse ${day(a, 2)}, as planned.`,
      },
      {
        ref: { poNumber: PO_2, lineNo: 2 },
        classification: 'confirmed_arrival',
        dateType: 'arrival',
        proposedDate: iso(a, 2),
        proposedQty: qtyOf(items, PO_2, 2),
        evidence: `${PO_2} line 2: All ${qtyOf(items, PO_2, 2)} confirmed for arrival ${day(a, 2)}.`,
      },
    ],
  },
  // Optional test event: the supplier confirms a past arrival for material with no recorded receipt.
  'case-a-reply-past': {
    key: 'case-a-reply-past',
    label: 'Optional: past-date confirmation',
    supplier: CASE_A.supplier,
    externalMessageId: 'FIXTURE-CASE-A-REPLY-PAST',
    body: (a, items, buyer) =>
      [`Hi ${buyer},`, '', `${PO_2} line 2: Our carrier shows all ${qtyOf(items, PO_2, 2)} arriving at your dock ${day(a, -1)}.`, '', SIGNATURE].join('\n'),
    results: (a, items) => [
      {
        ref: { poNumber: PO_2, lineNo: 2 },
        classification: 'revised_arrival',
        dateType: 'arrival',
        proposedDate: iso(a, -1),
        proposedQty: qtyOf(items, PO_2, 2),
        evidence: `${PO_2} line 2: Our carrier shows all ${qtyOf(items, PO_2, 2)} arriving at your dock ${day(a, -1)}.`,
      },
    ],
  },
};

/** The fixture adapter: returns the fixture's explicit results, and nothing for unknown messages. */
export const fixtureReplySource: ReplySource = {
  name: 'Simulated AI reply processing (fixture playback)',
  extract(fixtureKey, anchor, items) {
    const fixture = REPLY_FIXTURES[fixtureKey];
    return fixture ? fixture.results(anchor, items) : null;
  },
};

export interface CarrierPayload {
  status: CarrierStatus;
  /** Explicit ETA confirmation; absent means this event carries no arrival information. */
  eta?: string;
  /** Explicit ETA withdrawal by the carrier. Omitting `eta` is not a withdrawal. */
  etaWithdrawn?: boolean;
  deliveredAt?: string;
}

export interface CarrierFixture {
  key: string;
  label: string;
  externalEventId: string;
  shipmentNumber: string;
  occurredAt(anchor: string): string;
  payload(anchor: string): CarrierPayload;
}

const at = (anchor: string, n: number, time: string) => `${addDays(anchor, n)}T${time}.000Z`;

const DELAY: Omit<CarrierFixture, 'key' | 'label'> = {
  externalEventId: 'EVT-DEMO-TRACK-001-0002',
  shipmentNumber: CASE_B.shipment,
  occurredAt: (a) => at(a, 0, '14:00:00'),
  payload: (a) => ({ status: 'delayed', eta: iso(a, 6) }),
};

export const CARRIER_FIXTURES: Record<string, CarrierFixture> = {
  'case-b-delay': { key: 'case-b-delay', label: 'Carrier delay: ETA moves to D+6', ...DELAY },
  // The identical event delivered again (same event ID and payload).
  'case-b-delay-replay': { key: 'case-b-delay-replay', label: 'Replay the identical delay event', ...DELAY },
  'case-b-older': {
    key: 'case-b-older',
    label: 'Older, previously unseen event (ETA D+1)',
    externalEventId: 'EVT-DEMO-TRACK-001-0001',
    shipmentNumber: CASE_B.shipment,
    occurredAt: (a) => at(a, -1, '20:00:00'),
    payload: (a) => ({ status: 'in_transit', eta: iso(a, 1) }),
  },
  'case-b-later': {
    key: 'case-b-later',
    label: 'Later delay: ETA moves to D+8',
    externalEventId: 'EVT-DEMO-TRACK-001-0003',
    shipmentNumber: CASE_B.shipment,
    occurredAt: (a) => at(a, 0, '14:45:00'),
    payload: (a) => ({ status: 'delayed', eta: iso(a, 8) }),
  },
  'case-b-delivered': {
    key: 'case-b-delivered',
    label: 'Carrier reports Delivered (no ETA)',
    externalEventId: 'EVT-DEMO-TRACK-001-0004',
    shipmentNumber: CASE_B.shipment,
    occurredAt: (a) => at(a, 8, '16:00:00'),
    payload: (a) => ({ status: 'delivered', deliveredAt: at(a, 8, '16:00:00') }),
  },
};
