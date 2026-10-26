import { describe, expect, it } from 'vitest';
import { addBusinessDays, businessDaysBetween, localDate, zonedTimeToUtc } from '../shared/clock.js';
import { addDays } from '../shared/dates.js';
import {
  compareBySort,
  EMPTY_FILTERS,
  matchesFilters,
  nextSort,
  parseIncomingQuery,
  parseSort,
  serializeIncomingQuery,
  viewCounts,
} from '../shared/incomingFilters.js';
import { DEFAULT_OUTREACH_SETTINGS, elapsedFraction, exclusionReason, selectOutreachCandidates } from '../shared/outreach.js';
import type { DeliveryRow, OutreachDelivery } from '../shared/types.js';

// Monday Oct 26, 2026, 10:00 in Chicago (CDT).
const CLOCK = '2026-10-26T15:00:00.000Z';
const D = (n: number) => addDays('2026-10-26', n);
const settings = DEFAULT_OUTREACH_SETTINGS;

let nextId = 1;
const item = (extra: Partial<OutreachDelivery> = {}): OutreachDelivery => {
  const id = nextId++;
  return {
    deliveryId: id,
    version: 1,
    poId: 1,
    poNumber: 'PO-1',
    poLineId: id,
    lineNo: id,
    supplierId: 1,
    supplierName: 'Supplier',
    partNumber: `P-${id}`,
    description: 'Part',
    unit: 'EA',
    quantity: 10,
    state: 'planned',
    expectedArrival: D(5),
    requiredDock: D(10),
    poCreatedDate: D(-10),
    lastUpdateAt: `${D(-7)}T15:00:00.000Z`,
    trackingUsable: false,
    awaitingResponse: false,
    ...extra,
  };
};

describe('outreach eligibility', () => {
  it('is eligible at exactly 50% elapsed and excluded just below', () => {
    expect(elapsedFraction(D(0), D(-10), D(10))).toBe(0.5);
    expect(exclusionReason(item({ poCreatedDate: D(-10), requiredDock: D(10) }), CLOCK, settings)).toBeNull();
    expect(exclusionReason(item({ poCreatedDate: D(-10), requiredDock: D(11) }), CLOCK, settings)).toBe('below_half');
  });

  it('excludes zero or negative creation-to-dock intervals and missing creation dates; keeps valid overdue items', () => {
    expect(exclusionReason(item({ poCreatedDate: D(3), requiredDock: D(3) }), CLOCK, settings)).toBe('invalid_interval');
    expect(exclusionReason(item({ poCreatedDate: D(4), requiredDock: D(3) }), CLOCK, settings)).toBe('invalid_interval');
    expect(exclusionReason(item({ poCreatedDate: null }), CLOCK, settings)).toBe('missing_created_date');
    expect(exclusionReason(item({ poCreatedDate: D(-20), requiredDock: D(-2), expectedArrival: D(-2) }), CLOCK, settings)).toBeNull();
  });

  it('treats exactly three business days without a confirmation as stale', () => {
    // Monday demo date: Wednesday is three business days back (Thu, Fri, Mon); Thursday is two.
    expect(exclusionReason(item({ lastUpdateAt: '2026-10-21T15:00:00.000Z' }), CLOCK, settings)).toBeNull();
    expect(exclusionReason(item({ lastUpdateAt: '2026-10-22T15:00:00.000Z' }), CLOCK, settings)).toBe('recent_update');
    expect(exclusionReason(item({ lastUpdateAt: null }), CLOCK, settings)).toBeNull();
  });

  it('excludes received, tracked, and awaiting quantities but keeps an unshipped remainder of a tracked item', () => {
    const tracked = item({ state: 'in_transit', trackingUsable: true });
    const remainder = item({ poLineId: tracked.poLineId, lineNo: tracked.lineNo, quantity: 20 });
    const result = selectOutreachCandidates(
      [item({ state: 'received' }), tracked, remainder, item({ awaitingResponse: true }), item({ state: 'in_transit', trackingUsable: false })],
      CLOCK,
      settings,
    );
    expect(result.excluded.map((e) => e.reason).sort()).toEqual(['awaiting_response', 'received', 'tracked']);
    expect(result.suppliers[0].items.map((i) => [i.deliveryId, i.quantity])).toContainEqual([remainder.deliveryId, 20]);
    // A dispatched quantity without tracking stays eligible so outreach can ask for a tracking number.
    expect(result.suppliers[0].items.some((i) => i.state === 'in_transit')).toBe(true);
  });

  it('caps one supplier at 20 distinct PO lines, keeping each line’s deliveries together', () => {
    const lines = Array.from({ length: 21 }, (_, i) => item({ requiredDock: D(10 + i), poCreatedDate: D(-30) }));
    const secondDelivery = item({ poLineId: lines[0].poLineId, lineNo: lines[0].lineNo, requiredDock: lines[0].requiredDock, poCreatedDate: D(-30) });
    const result = selectOutreachCandidates([...lines, secondDelivery], CLOCK, settings);
    const included = result.suppliers[0].items;
    expect(new Set(included.map((i) => i.poLineId)).size).toBe(20);
    expect(included.filter((i) => i.poLineId === lines[0].poLineId)).toHaveLength(2);
    expect(result.excluded.filter((e) => e.reason === 'line_cap').map((e) => e.deliveryId)).toEqual([lines[20].deliveryId]);
  });

  it('ranks overdue first, then nearest date, then oldest update, then PO/line', () => {
    const far = item({ requiredDock: D(9), expectedArrival: D(9), poCreatedDate: D(-30) });
    const near = item({ requiredDock: D(4), expectedArrival: D(6), poCreatedDate: D(-30) });
    const overdue = item({ requiredDock: D(8), expectedArrival: D(-1), poCreatedDate: D(-30) });
    const nearOlder = item({ requiredDock: D(4), expectedArrival: D(4), poCreatedDate: D(-30), lastUpdateAt: `${D(-20)}T15:00:00.000Z` });
    const ranked = selectOutreachCandidates([far, near, overdue, nearOlder], CLOCK, settings).suppliers[0].items.map((i) => i.deliveryId);
    expect(ranked).toEqual([overdue.deliveryId, nearOlder.deliveryId, near.deliveryId, far.deliveryId]);
  });
});

describe('demo clock business days (America/Chicago, weekdays only)', () => {
  it('derives the local date from the UTC timestamp', () => {
    expect(localDate('2026-10-27T03:00:00.000Z')).toBe('2026-10-26');
    expect(localDate('2026-10-27T06:00:00.000Z')).toBe('2026-10-27');
  });

  it('moves a Friday send to Monday at the same local time, across the DST change', () => {
    // Fri Oct 30 10:00 CDT (15:00Z) → Mon Nov 2 10:00 CST (16:00Z); DST ends Nov 1, 2026.
    expect(addBusinessDays('2026-10-30T15:00:00.000Z', 1)).toBe('2026-11-02T16:00:00.000Z');
    expect(addBusinessDays(CLOCK, 1)).toBe('2026-10-27T15:00:00.000Z');
    expect(zonedTimeToUtc('2026-11-02', 10)).toBe('2026-11-02T16:00:00.000Z');
  });

  it('counts business days between local dates, skipping weekends', () => {
    expect(businessDaysBetween('2026-10-23', '2026-10-26')).toBe(1);
    expect(businessDaysBetween('2026-10-21', '2026-10-26')).toBe(3);
    expect(businessDaysBetween('2026-10-26', '2026-10-26')).toBe(0);
  });
});

describe('incoming filters', () => {
  const row = (extra: Partial<DeliveryRow>) =>
    ({
      poNumber: 'PO-1',
      partNumber: 'X-1',
      description: 'Part',
      supplierName: 'S',
      state: 'planned',
      warehouseId: 1,
      program: 'Program Atlas',
      issue: null,
      risk: { reasons: [], daysLate: null, daysAfterStart: null, daysOverdue: null },
      ...extra,
    }) as DeliveryRow;
  const rows = [
    row({ warehouseId: 1, program: 'Program Atlas' }),
    row({ warehouseId: 2, program: 'Program Atlas' }),
    row({ warehouseId: 1, program: 'Program Cinder', issue: { id: 1 } as DeliveryRow['issue'] }),
    row({ warehouseId: 2, program: 'Program Dune' }),
  ];

  it('combines values with OR within a filter and AND across filters', () => {
    const count = (f: Partial<typeof EMPTY_FILTERS>) => rows.filter((r) => matchesFilters(r, { ...EMPTY_FILTERS, ...f })).length;
    expect(count({})).toBe(4);
    expect(count({ destinations: [1, 2] })).toBe(4);
    expect(count({ programs: ['Program Atlas', 'Program Dune'] })).toBe(3);
    expect(count({ destinations: [2], programs: ['Program Atlas', 'Program Dune'] })).toBe(2);
    expect(count({ destinations: [1], programs: ['Program Dune'] })).toBe(0);
  });

  it('counts views with the other filters but not the view itself', () => {
    expect(viewCounts(rows, { ...EMPTY_FILTERS, destinations: [1] })).toMatchObject({ action: 1, outstanding: 2 });
  });

  it('round-trips through URL parameters and drops unknown values instead of picking another', () => {
    const options = { destinations: [{ id: 1, name: 'North' }, { id: 2, name: 'South' }], programs: ['Program Atlas', 'Program B & C'] };
    const params = serializeIncomingQuery('late', { ...EMPTY_FILTERS, search: 'a&b', destinations: [2], programs: ['Program B & C'] });
    const parsed = parseIncomingQuery(new URLSearchParams(params.toString()), options);
    expect(parsed).toEqual({ view: 'late', filters: { ...EMPTY_FILTERS, search: 'a&b', destinations: [2], programs: ['Program B & C'] } });
    const stale = parseIncomingQuery(new URLSearchParams('view=nope&destination=9&program=Program%20Zed&program=Program%20Atlas&state=lost'), options);
    expect(stale).toEqual({ view: 'action', filters: { ...EMPTY_FILTERS, programs: ['Program Atlas'] } });
  });

  it('sorts by a column with unknown dates last in both directions, and round-trips the sort', () => {
    const dated = (id: number, expectedArrival: string | null, state: DeliveryRow['state'] = 'planned', receivedAt: string | null = null) =>
      row({ deliveryId: id, expectedArrival, state, receivedAt });
    const list = [dated(1, '2026-11-05'), dated(2, null), dated(3, '2026-10-20', 'received', '2026-10-18'), dated(4, '2026-11-01')];
    const byId = (a: DeliveryRow, b: DeliveryRow) => a.deliveryId - b.deliveryId;
    const order = (dir: 'asc' | 'desc') => [...list].sort(compareBySort({ key: 'arrival', dir }, byId)).map((r) => r.deliveryId);
    // Received rows sort by the receipt date they display.
    expect(order('asc')).toEqual([3, 4, 1, 2]);
    expect(order('desc')).toEqual([1, 4, 3, 2]);
    expect(nextSort(null, 'qty')).toEqual({ key: 'qty', dir: 'asc' });
    expect(nextSort({ key: 'qty', dir: 'asc' }, 'qty')).toEqual({ key: 'qty', dir: 'desc' });
    expect(nextSort({ key: 'qty', dir: 'desc' }, 'qty')).toBeNull();
    expect(nextSort({ key: 'qty', dir: 'desc' }, 'dock')).toEqual({ key: 'dock', dir: 'asc' });
    const params = serializeIncomingQuery('action', EMPTY_FILTERS, { key: 'dock', dir: 'desc' });
    expect(parseSort(new URLSearchParams(params.toString()))).toEqual({ key: 'dock', dir: 'desc' });
    expect(parseSort(new URLSearchParams('sort=bogus&dir=desc'))).toBeNull();
  });
});
