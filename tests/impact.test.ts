import { describe, expect, it } from 'vitest';
import { compareDeliveries, meetsDateRestored, physicalRisk } from '../shared/impact.js';
import { evaluateIssueTransition } from '../shared/issues.js';
import { compareItems, DEFAULT_ITEM_SORT, itemQuantities, itemSortParams, nextItemSort, parseItemSort, prioritizeArrivals } from '../shared/arrivals.js';
import { addDays, formatDate, isIsoDate } from '../shared/dates.js';
import type { DeliveryFacts, ReviewedFacts } from '../shared/types.js';

const D = '2026-10-26';
const base: DeliveryFacts = { state: 'planned', expectedArrival: '2026-11-01', quantity: 10, requiredDock: '2026-11-05', productionStart: '2026-11-08' };
const at = (expectedArrival: string | null, extra: Partial<DeliveryFacts> = {}): DeliveryFacts => ({ ...base, expectedArrival, ...extra });

describe('physicalRisk', () => {
  it('keeps late (after required dock) separate from production conflict (after start)', () => {
    expect(physicalRisk(at('2026-11-07'), D)).toMatchObject({ reasons: ['late'], daysLate: 2, daysAfterStart: null });
    expect(physicalRisk(at('2026-11-10'), D)).toMatchObject({ reasons: ['production_conflict', 'late'], daysLate: 5, daysAfterStart: 2 });
  });

  it('does not flag equal dates', () => {
    expect(physicalRisk(at('2026-11-05'), D).reasons).toEqual([]);
    expect(physicalRisk(at('2026-11-08', { requiredDock: '2026-11-08' }), D).reasons).toEqual([]);
  });

  it('treats unknown as never on time and flags overdue against the demo date', () => {
    expect(physicalRisk(at(null), D).reasons).toEqual(['unknown']);
    expect(physicalRisk(at('2026-10-24'), D)).toMatchObject({ reasons: ['overdue'], daysOverdue: 2 });
  });

  it('gives received deliveries no active alerts', () => {
    expect(physicalRisk(at('2026-12-31', { state: 'received' }), D).reasons).toEqual([]);
  });
});

describe('meetsDateRestored', () => {
  it('accepts only an arrival on or before the dock date that is not overdue', () => {
    expect(meetsDateRestored(at('2026-11-05'), D)).toBe(true);
    expect(meetsDateRestored(at('2026-11-06'), D)).toBe(false);
    expect(meetsDateRestored(at(null), D)).toBe(false);
    expect(meetsDateRestored(at('2026-10-25'), D)).toBe(false);
  });
});

describe('evaluateIssueTransition', () => {
  const reviewed = (facts: DeliveryFacts): ReviewedFacts => ({ ...facts, reasons: physicalRisk(facts, D).reasons, demoDate: D });

  it('opens for a first exception, including an on-time estimate that moved later', () => {
    expect(evaluateIssueTransition({ before: at('2026-11-01'), after: at('2026-11-07'), demoDate: D, openIssueReasons: null, lastReviewed: null })).toEqual({
      action: 'open',
      reasons: ['late', 'moved_later'],
    });
    expect(evaluateIssueTransition({ before: at('2026-11-01'), after: at('2026-11-03'), demoDate: D, openIssueReasons: null, lastReviewed: null })).toEqual({
      action: 'open',
      reasons: ['moved_later'],
    });
    expect(evaluateIssueTransition({ before: at('2026-11-03'), after: at('2026-11-01'), demoDate: D, openIssueReasons: null, lastReviewed: null }).action).toBe('none');
  });

  it('keeps an open issue open even when the date becomes on time', () => {
    expect(evaluateIssueTransition({ before: at('2026-11-10'), after: at('2026-11-01'), demoDate: D, openIssueReasons: ['late'], lastReviewed: null }).action).toBe('none');
    expect(evaluateIssueTransition({ before: at('2026-11-07'), after: at('2026-11-10'), demoDate: D, openIssueReasons: ['late'], lastReviewed: null })).toEqual({
      action: 'update',
      reasons: ['production_conflict', 'late', 'moved_later'],
    });
  });

  it('after a resolution, ignores identical facts, source-only edits, and improvements with the same accepted risk', () => {
    const accepted = reviewed(at('2026-11-12'));
    const run = (before: string | null, after: string | null) =>
      evaluateIssueTransition({ before: at(before), after: at(after), demoDate: D, openIssueReasons: null, lastReviewed: accepted }).action;
    expect(run('2026-11-12', '2026-11-12')).toBe('none');
    expect(run('2026-11-12', '2026-11-10')).toBe('none');
  });

  it('reopens for a later estimate, a new unknown, or a newly active reason', () => {
    const accepted = reviewed(at('2026-11-12'));
    const run = (before: string | null, after: string | null, lastReviewed = accepted) =>
      evaluateIssueTransition({ before: at(before), after: at(after), demoDate: D, openIssueReasons: null, lastReviewed });
    expect(run('2026-11-12', '2026-11-14')).toEqual({ action: 'open', reasons: ['production_conflict', 'late', 'moved_later'] });
    expect(run('2026-11-12', null)).toEqual({ action: 'open', reasons: ['unknown'] });
    expect(run('2026-11-12', '2026-10-20')).toEqual({ action: 'open', reasons: ['overdue'] });
    // An accepted late-only delivery with unchanged facts stays resolved.
    expect(run('2026-11-07', '2026-11-07', reviewed(at('2026-11-07', { productionStart: '2026-11-08' }))).action).toBe('none');
  });
});

describe('item table rules', () => {
  it('computes cumulative shipped and received: 30 in transit, 20 received, 50 not shipped', () => {
    expect(
      itemQuantities([
        { state: 'in_transit', quantity: 30 },
        { state: 'received', quantity: 20 },
        { state: 'planned', quantity: 50 },
      ]),
    ).toEqual({ shippedQty: 50, receivedQty: 20 });
  });

  it('prioritizes arrivals: open issues, other risk, other outstanding, received; then date and id', () => {
    const row = (deliveryId: number, extra: object) => ({
      deliveryId,
      state: 'planned' as const,
      expectedArrival: '2026-11-01',
      receivedAt: null,
      risk: { reasons: [], daysLate: null, daysAfterStart: null, daysOverdue: null },
      issue: null,
      ...extra,
    });
    const ordered = prioritizeArrivals([
      row(1, { state: 'received', receivedAt: '2026-10-01', expectedArrival: '2026-10-01' }),
      row(2, { expectedArrival: '2026-11-03' }),
      row(3, { expectedArrival: null, risk: { reasons: ['unknown'], daysLate: null, daysAfterStart: null, daysOverdue: null } }),
      row(4, { issue: { id: 9 } }),
      row(5, { expectedArrival: '2026-11-02' }),
    ]);
    expect(ordered.map((d) => d.deliveryId)).toEqual([4, 3, 5, 2, 1]);
  });

  it('sorts PO items by line by default, by a chosen column otherwise, with empty arrivals last', () => {
    const arrival = (expectedArrival: string | null) =>
      ({ deliveryId: 1, state: 'planned', expectedArrival, receivedAt: null, risk: { reasons: [] }, issue: null }) as never;
    const item = (lineNo: number, orderedQty: number, arrivals: (string | null)[]) => ({
      line: { lineNo, partNumber: `P-${lineNo}`, description: 'd', unit: 'EA', orderedQty, shippedQty: 0, receivedQty: 0, requiredDock: '2026-11-05' },
      matching: arrivals.map(arrival),
    });
    const items = [item(3, 10, ['2026-11-04']), item(1, 30, [null]), item(2, 10, ['2026-11-09', '2026-11-01'])];
    const lines = (sort: Parameters<typeof compareItems>[0]) => [...items].sort(compareItems(sort)).map((i) => i.line.lineNo);
    expect(lines(DEFAULT_ITEM_SORT)).toEqual([1, 2, 3]);
    // Ties keep line order; Arrivals uses the earliest shown date; unknown-only items go last both ways.
    expect(lines({ key: 'ordered', dir: 'asc' })).toEqual([2, 3, 1]);
    expect(lines({ key: 'arrivals', dir: 'asc' })).toEqual([2, 3, 1]);
    expect(lines({ key: 'arrivals', dir: 'desc' })).toEqual([3, 2, 1]);
    // Click cycle returns to line order; the default needs no URL parameters.
    expect(nextItemSort(DEFAULT_ITEM_SORT, 'ordered')).toEqual({ key: 'ordered', dir: 'asc' });
    expect(nextItemSort({ key: 'ordered', dir: 'desc' }, 'ordered')).toEqual(DEFAULT_ITEM_SORT);
    expect(nextItemSort(DEFAULT_ITEM_SORT, 'line')).toEqual({ key: 'line', dir: 'desc' });
    expect(itemSortParams(DEFAULT_ITEM_SORT)).toBeNull();
    expect(parseItemSort(new URLSearchParams('sort=ordered&dir=desc'))).toEqual({ key: 'ordered', dir: 'desc' });
    expect(parseItemSort(new URLSearchParams('sort=nope'))).toEqual(DEFAULT_ITEM_SORT);
  });

  it('sorts rows by open issue, production conflict, start, dock, id', () => {
    const risk = (reasons: string[]) => ({ reasons, daysLate: null, daysAfterStart: null, daysOverdue: null }) as never;
    const rows = [
      { deliveryId: 1, issue: null, risk: risk([]), productionStart: '2026-11-01', requiredDock: '2026-11-01' },
      { deliveryId: 2, issue: {}, risk: risk(['late']), productionStart: '2026-11-09', requiredDock: '2026-11-01' },
      { deliveryId: 3, issue: {}, risk: risk(['production_conflict']), productionStart: '2026-11-20', requiredDock: '2026-11-01' },
      { deliveryId: 4, issue: {}, risk: risk(['late']), productionStart: '2026-11-09', requiredDock: '2026-10-30' },
    ];
    expect(rows.sort(compareDeliveries).map((r) => r.deliveryId)).toEqual([3, 4, 2, 1]);
  });
});

describe('date helpers', () => {
  it('do date-only arithmetic independent of the local timezone', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-03-14', 1)).toBe('2027-03-15');
    expect(formatDate('2026-11-01')).toBe('Nov 1, 2026');
    expect(isIsoDate('2026-02-30')).toBe(false);
  });

  it('give the same results in far-apart timezones', () => {
    const original = process.env.TZ;
    const results = ['Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago'].map((tz) => {
      process.env.TZ = tz;
      return [formatDate('2026-11-01'), addDays('2026-11-01', -1), physicalRisk(at('2026-11-05'), D).reasons.length];
    });
    process.env.TZ = original;
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});
