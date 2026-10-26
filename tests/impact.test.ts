import { describe, expect, it } from 'vitest';
import { attentionReasons, compareAttention, linkStatus, workOrderImpact } from '../shared/impact.js';
import { addDays, formatDate, isIsoDate } from '../shared/dates.js';

const D = '2026-10-26';

describe('linkStatus', () => {
  it('treats unknown arrival as unknown, never on time', () => {
    expect(linkStatus('planned', null, '2027-12-31')).toBe('unknown');
    expect(linkStatus('in_transit', null, '2027-12-31')).toBe('unknown');
  });

  it('flags arrival later than start as late; same date is not a conflict', () => {
    expect(linkStatus('planned', '2026-11-02', '2026-11-01')).toBe('late');
    expect(linkStatus('planned', '2026-11-01', '2026-11-01')).toBe('no_conflict');
    expect(linkStatus('planned', '2026-10-31', '2026-11-01')).toBe('no_conflict');
  });

  it('received deliveries carry no date status', () => {
    expect(linkStatus('received', '2026-12-31', '2026-11-01')).toBe('received');
  });
});

describe('attentionReasons', () => {
  const starts = ['2026-11-02', '2026-11-09'];

  it('orders reasons strongest first', () => {
    expect(attentionReasons({ state: 'planned', expectedArrival: '2026-10-20', productionStarts: ['2026-10-19'] }, D, 1)).toEqual([
      'date_conflict',
      'arrival_overdue',
      'follow_up_due',
    ]);
  });

  it('marks unknown dates and never reports them as clear', () => {
    expect(attentionReasons({ state: 'planned', expectedArrival: null, productionStarts: starts }, D, 0)).toEqual(['date_unknown']);
  });

  it('evaluates each linked work order separately', () => {
    // Late for the first start only, still a date conflict for the delivery.
    expect(attentionReasons({ state: 'planned', expectedArrival: '2026-11-05', productionStarts: starts }, D, 0)[0]).toBe('date_conflict');
  });

  it('reports follow-up due with an otherwise timely arrival', () => {
    expect(attentionReasons({ state: 'planned', expectedArrival: '2026-10-30', productionStarts: starts }, D, 1)).toEqual(['follow_up_due']);
  });

  it('received deliveries have no active alerts', () => {
    expect(attentionReasons({ state: 'received', expectedArrival: '2026-10-01', productionStarts: ['2026-09-01'] }, D, 2)).toEqual(['none']);
  });
});

describe('workOrderImpact', () => {
  it('separates late and unknown quantities instead of labeling the whole work order late', () => {
    const result = workOrderImpact('2026-11-09', [
      { state: 'planned', expectedArrival: '2026-11-01', quantity: 30 },
      { state: 'planned', expectedArrival: '2026-11-11', quantity: 60 },
      { state: 'planned', expectedArrival: null, quantity: 10 },
      { state: 'received', expectedArrival: '2026-10-01', quantity: 5 },
    ]);
    expect(result).toEqual({ linkedQty: 100, lateQty: 60, unknownQty: 10 });
  });
});

describe('compareAttention', () => {
  it('sorts by reason, then earliest start with unknown starts last', () => {
    const rows = [
      { id: 1, primaryReason: 'none' as const, earliestStart: '2026-10-28' },
      { id: 2, primaryReason: 'date_conflict' as const, earliestStart: null },
      { id: 3, primaryReason: 'date_conflict' as const, earliestStart: '2026-11-03' },
      { id: 4, primaryReason: 'date_conflict' as const, earliestStart: '2026-10-29' },
    ];
    expect(rows.sort(compareAttention).map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });
});

describe('date helpers', () => {
  it('do date-only arithmetic independent of the local timezone', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-03-14', 1)).toBe('2027-03-15'); // US DST change
    expect(formatDate('2026-11-01')).toBe('Nov 1, 2026');
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-11-01')).toBe(true);
  });

  it('give the same results in far-apart timezones', () => {
    const original = process.env.TZ;
    const results = ['Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago'].map((tz) => {
      process.env.TZ = tz;
      return [formatDate('2026-11-01'), addDays('2026-11-01', -1), linkStatus('planned', '2026-11-01', '2026-11-01')];
    });
    process.env.TZ = original;
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});
