import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../shared/dates.js';
import { assertIntegrity, DEMO } from '../server/db/seed.js';
import { getDemoDate } from '../server/db/db.js';
import { createTestContext, DEMO_DATE, impactOf, type TestContext } from './helpers.js';

const D = (days: number) => addDays(DEMO_DATE, days);

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext();
});
afterEach(() => ctx.cleanup());

async function demoDelivery() {
  const rows = await ctx.demoRows();
  expect(rows).toHaveLength(1);
  return rows[0];
}

function splitBody(version: number, parts: { quantity: number; date: string | null; a: number; b: number }[], linkIds: { a: number; b: number }) {
  return {
    version,
    source: 'supplier_call',
    note: 'Agreed split with supplier.',
    parts: parts.map((p) => ({
      quantity: p.quantity,
      expectedArrival: p.date,
      links: [
        { workOrderLinkId: linkIds.a, quantity: p.a },
        { workOrderLinkId: linkIds.b, quantity: p.b },
      ],
    })),
  };
}

async function demoLinkIds() {
  const row = await demoDelivery();
  return { a: impactOf(row, DEMO.woA)!.workOrderLinkId, b: impactOf(row, DEMO.woB)!.workOrderLinkId };
}

describe('seed', () => {
  it('creates the specified dataset shape with consistent quantities', () => {
    expect(ctx.count('suppliers')).toBe(20);
    expect(ctx.count('warehouses')).toBe(2);
    expect(ctx.count('purchase_orders')).toBe(25);
    expect(ctx.count('po_lines')).toBe(80);
    expect(ctx.count('work_orders')).toBe(40);
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
    const perSupplier = ctx.db.prepare('SELECT COUNT(*) AS c FROM purchase_orders GROUP BY supplier_id').all() as { c: number }[];
    expect(perSupplier.filter((r) => r.c === 2)).toHaveLength(5);
    expect(perSupplier.filter((r) => r.c === 1)).toHaveLength(15);
  });

  it('includes each required example', async () => {
    const { rows } = await ctx.incoming();
    expect(rows.some((r) => r.state !== 'received' && r.primaryReason === 'none')).toBe(true);
    expect(rows.some((r) => r.reasons.includes('date_conflict'))).toBe(true);
    expect(rows.some((r) => r.reasons.includes('date_unknown'))).toBe(true);
    expect(rows.some((r) => r.reasons.includes('arrival_overdue'))).toBe(true);
    expect(rows.some((r) => r.primaryReason === 'follow_up_due')).toBe(true);
    expect(rows.some((r) => r.state === 'planned' && r.affected.length === 2 && r.poNumber === DEMO.poNumber)).toBe(true);
    expect(rows.some((r) => r.state === 'in_transit' && r.source === 'carrier_update')).toBe(true);
    expect(rows.some((r) => r.state === 'received')).toBe(true);
  });

  it('does not reseed or shift the demo date on restart', async () => {
    const before = ctx.count('deliveries');
    expect(ctx.reopen()).toBe(false);
    expect(getDemoDate(ctx.db)).toBe(DEMO_DATE);
    expect(ctx.count('deliveries')).toBe(before);
  });
});

describe('primary demo', () => {
  it('runs end to end and persists across restart; reset restores the baseline', async () => {
    // 1. Baseline: 100 units, A 40 starts D+7, B 60 starts D+14, arrival D+5.
    let row = await demoDelivery();
    expect(row.quantity).toBe(100);
    expect(row.expectedArrival).toBe(D(5));
    expect(impactOf(row, DEMO.woA)).toMatchObject({ quantity: 40, productionStart: D(7), status: 'no_conflict' });
    expect(impactOf(row, DEMO.woB)).toMatchObject({ quantity: 60, productionStart: D(14), status: 'no_conflict' });

    // 2. Supplier delay to D+16: A late 40, B late 60.
    await ctx.http
      .patch(`/api/deliveries/${row.deliveryId}`)
      .send({ expectedArrival: D(16), source: 'supplier_email', note: 'Supplier reports delay.', version: row.version })
      .expect(200);
    row = await demoDelivery();
    expect(row.primaryReason).toBe('date_conflict');
    expect(impactOf(row, DEMO.woA)).toMatchObject({ status: 'late', quantity: 40 });
    expect(impactOf(row, DEMO.woB)).toMatchObject({ status: 'late', quantity: 60 });
    expect(impactOf(row, DEMO.woA)!.summary.lateQty).toBe(40);
    expect(impactOf(row, DEMO.woB)!.summary.lateQty).toBe(60);

    // 3. Agreed split: 40 at D+6 for A, 60 at D+16 for B.
    const links = await demoLinkIds();
    const split = await ctx.http
      .post(`/api/deliveries/${row.deliveryId}/split`)
      .send(splitBody(row.version, [{ quantity: 40, date: D(6), a: 40, b: 0 }, { quantity: 60, date: D(16), a: 0, b: 60 }], links))
      .expect(201);
    expect(split.body.deliveryIds).toHaveLength(2);

    // 4. A has no calculated date conflict; B remains late 60; order total stays 100.
    let [first, second] = await ctx.demoRows();
    expect(first).toMatchObject({ quantity: 40, expectedArrival: D(6), primaryReason: 'none' });
    expect(impactOf(first, DEMO.woA)).toMatchObject({ status: 'no_conflict', quantity: 40 });
    expect(impactOf(first, DEMO.woA)!.summary.lateQty).toBe(0);
    expect(second).toMatchObject({ quantity: 60, expectedArrival: D(16), primaryReason: 'date_conflict' });
    expect(impactOf(second, DEMO.woB)).toMatchObject({ status: 'late', quantity: 60 });
    expect(impactOf(second, DEMO.woB)!.summary.lateQty).toBe(60);
    const detail = await ctx.po(first.poId);
    expect(detail.lines[0]).toMatchObject({ orderedQty: 100, plannedQty: 100, inTransitQty: 0, receivedQty: 0 });
    expect(detail.history.map((h) => h.eventType)).toEqual(['delivery_split', 'arrival_updated']);

    // 5. Add and complete a follow-up without improving B's date: B remains late.
    const created = await ctx.http
      .post(`/api/purchase-orders/${first.poId}/follow-ups`)
      .send({ deliveryId: second.deliveryId, dueDate: D(0), note: 'Ask for expedite on remaining 60.' })
      .expect(201);
    expect((await ctx.demoRows())[1].reasons).toEqual(['date_conflict', 'follow_up_due']);
    const followUp = (await ctx.po(first.poId)).followUps.find((f) => f.id === created.body.id)!;
    await ctx.http
      .patch(`/api/follow-ups/${followUp.id}`)
      .send({ action: 'complete', version: followUp.version, completionNote: 'Supplier cannot expedite.' })
      .expect(200);
    [first, second] = await ctx.demoRows();
    expect(second.reasons).toEqual(['date_conflict']);
    expect(impactOf(second, DEMO.woB)).toMatchObject({ status: 'late', quantity: 60 });

    // 6. Restart: changes persist. Reset restores the baseline.
    ctx.reopen();
    [first, second] = await ctx.demoRows();
    expect(second).toMatchObject({ quantity: 60, expectedArrival: D(16), primaryReason: 'date_conflict' });
    await ctx.http.post('/api/demo/reset').send({}).expect(400);
    await ctx.http.post('/api/demo/reset').send({ confirm: 'RESET' }).expect(200);
    const reset = await ctx.demoRows();
    expect(reset).toHaveLength(1);
    expect(reset[0]).toMatchObject({ quantity: 100, primaryReason: 'none' });
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
  });
});

describe('arrival updates', () => {
  it('rejects a stale version instead of overwriting', async () => {
    const row = await demoDelivery();
    const body = { expectedArrival: D(9), source: 'supplier_call', note: 'First update.', version: row.version };
    await ctx.http.patch(`/api/deliveries/${row.deliveryId}`).send(body).expect(200);
    const res = await ctx.http.patch(`/api/deliveries/${row.deliveryId}`).send({ ...body, expectedArrival: D(3), note: 'Second' }).expect(409);
    expect(res.body.error).toMatch(/changed/);
    expect((await demoDelivery()).expectedArrival).toBe(D(9));
  });

  it('accepts an explicit unknown date and treats it as needing attention', async () => {
    const row = await demoDelivery();
    await ctx.http
      .patch(`/api/deliveries/${row.deliveryId}`)
      .send({ expectedArrival: null, source: 'other', note: 'Supplier could not commit.', version: row.version })
      .expect(200);
    const updated = await demoDelivery();
    expect(updated.primaryReason).toBe('date_unknown');
    expect(updated.affected.every((a) => a.status === 'unknown')).toBe(true);
  });

  it('validates input and refuses received deliveries', async () => {
    const row = await demoDelivery();
    const bad = await ctx.http.patch(`/api/deliveries/${row.deliveryId}`).send({ expectedArrival: '2026-02-30', source: 'fax', note: '', version: row.version }).expect(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['expectedArrival', 'source', 'note']));
    const received = (await ctx.incoming()).rows.find((r) => r.state === 'received')!;
    await ctx.http
      .patch(`/api/deliveries/${received.deliveryId}`)
      .send({ expectedArrival: D(1), source: 'other', note: 'x', version: received.version })
      .expect(422);
  });
});

describe('splits', () => {
  it.each([99, 101])('rejects a split totaling %i and leaves data unchanged', async (total) => {
    const row = await demoDelivery();
    const links = await demoLinkIds();
    const historyBefore = ctx.count('change_history');
    const deliveriesBefore = ctx.count('deliveries');
    await ctx.http
      .post(`/api/deliveries/${row.deliveryId}/split`)
      .send(splitBody(row.version, [{ quantity: 40, date: D(6), a: 40, b: 0 }, { quantity: total - 40, date: D(16), a: 0, b: 60 }], links))
      .expect(422);
    expect(ctx.count('deliveries')).toBe(deliveriesBefore);
    expect(ctx.count('change_history')).toBe(historyBefore);
    expect(await demoDelivery()).toMatchObject({ deliveryId: row.deliveryId, version: row.version, quantity: 100 });
  });

  it('rejects invalid work-order distributions', async () => {
    const row = await demoDelivery();
    const links = await demoLinkIds();
    // A over-assigned, B under-assigned.
    await ctx.http
      .post(`/api/deliveries/${row.deliveryId}/split`)
      .send(splitBody(row.version, [{ quantity: 40, date: D(6), a: 50, b: 0 }, { quantity: 60, date: D(16), a: 0, b: 50 }], links))
      .expect(422);
    // Totals balance per work order, but a part is assigned more than its quantity.
    const res = await ctx.http
      .post(`/api/deliveries/${row.deliveryId}/split`)
      .send(splitBody(row.version, [{ quantity: 30, date: D(6), a: 40, b: 0 }, { quantity: 70, date: D(16), a: 0, b: 60 }], links))
      .expect(422);
    expect(res.body.fields['parts.0.quantity']).toMatch(/exceeds/);
    // A link from another PO line.
    const other = (await ctx.incoming()).rows.find((r) => r.poNumber !== DEMO.poNumber && r.affected.length > 0)!;
    await ctx.http
      .post(`/api/deliveries/${row.deliveryId}/split`)
      .send({
        ...splitBody(row.version, [{ quantity: 40, date: D(6), a: 40, b: 0 }, { quantity: 60, date: D(16), a: 0, b: 60 }], links),
        parts: [
          { quantity: 40, expectedArrival: D(6), links: [{ workOrderLinkId: other.affected[0].workOrderLinkId, quantity: 40 }] },
          { quantity: 60, expectedArrival: D(16), links: [{ workOrderLinkId: links.b, quantity: 60 }] },
        ],
      })
      .expect(422);
    expect(await ctx.demoRows()).toHaveLength(1);
  });

  it('a repeated or stale split cannot create extra deliveries', async () => {
    const row = await demoDelivery();
    const links = await demoLinkIds();
    const body = splitBody(row.version, [{ quantity: 40, date: D(6), a: 40, b: 0 }, { quantity: 60, date: D(16), a: 0, b: 60 }], links);
    await ctx.http.post(`/api/deliveries/${row.deliveryId}/split`).send(body).expect(201);
    await ctx.http.post(`/api/deliveries/${row.deliveryId}/split`).send(body).expect(409);
    await ctx.http.post(`/api/deliveries/${row.deliveryId}/split`).send({ ...body, version: row.version + 1 }).expect(409);
    const rows = await ctx.demoRows();
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.quantity, 0)).toBe(100);
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
  });

  it('blocks splitting in-transit and received deliveries', async () => {
    const { rows } = await ctx.incoming();
    for (const state of ['in_transit', 'received'] as const) {
      const target = rows.find((r) => r.state === state && r.quantity >= 2)!;
      const half = Math.floor(target.quantity / 2);
      const res = await ctx.http
        .post(`/api/deliveries/${target.deliveryId}/split`)
        .send({
          version: target.version,
          source: 'other',
          note: 'Attempted split.',
          parts: [
            { quantity: half, expectedArrival: D(3), links: [] },
            { quantity: target.quantity - half, expectedArrival: D(4), links: [] },
          ],
        })
        .expect(422);
      expect(res.body.error).toMatch(/Only planned deliveries/);
    }
  });

  it('moves open delivery-level follow-ups to the PO level and keeps history', async () => {
    const row = await demoDelivery();
    await ctx.http
      .post(`/api/purchase-orders/${row.poId}/follow-ups`)
      .send({ deliveryId: row.deliveryId, dueDate: D(3), note: 'Confirm split dates.' })
      .expect(201);
    const links = await demoLinkIds();
    await ctx.http
      .post(`/api/deliveries/${row.deliveryId}/split`)
      .send(splitBody(row.version, [{ quantity: 40, date: D(6), a: 40, b: 0 }, { quantity: 60, date: D(16), a: 0, b: 60 }], links))
      .expect(201);
    const detail = await ctx.po(row.poId);
    expect(detail.followUps[0]).toMatchObject({ deliveryId: null, originalDeliveryId: row.deliveryId, state: 'open' });
    expect(detail.history.map((h) => h.eventType)).toContain('follow_up_moved');
  });
});

describe('follow-ups', () => {
  it('completing a follow-up never clears date risk or changes arrivals', async () => {
    const { rows } = await ctx.incoming();
    const late = rows.find((r) => r.primaryReason === 'date_conflict' && r.openFollowUps > 0)!;
    const detail = await ctx.po(late.poId);
    for (const f of detail.followUps.filter((f) => f.state === 'open')) {
      await ctx.http.patch(`/api/follow-ups/${f.id}`).send({ action: 'complete', version: f.version }).expect(200);
    }
    const after = (await ctx.incoming()).rows.find((r) => r.deliveryId === late.deliveryId)!;
    expect(after.primaryReason).toBe('date_conflict');
    expect(after.expectedArrival).toBe(late.expectedArrival);
    expect(after.version).toBe(late.version);
  });

  it('rejects stale and repeated completion', async () => {
    const row = await demoDelivery();
    const { body } = await ctx.http
      .post(`/api/purchase-orders/${row.poId}/follow-ups`)
      .send({ deliveryId: null, dueDate: D(1), note: 'Check status.' })
      .expect(201);
    await ctx.http.patch(`/api/follow-ups/${body.id}`).send({ action: 'complete', version: 1 }).expect(200);
    await ctx.http.patch(`/api/follow-ups/${body.id}`).send({ action: 'complete', version: 1 }).expect(409);
    await ctx.http
      .patch(`/api/follow-ups/${body.id}`)
      .send({ action: 'edit', version: 1, deliveryId: null, dueDate: D(2), note: 'Edit' })
      .expect(409);
  });
});

describe('API surface', () => {
  it('returns JSON 404 for unknown API routes and missing POs', async () => {
    const res = await ctx.http.get('/api/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/json/);
    await ctx.http.get('/api/purchase-orders/99999').expect(404);
    await ctx.http.get('/api/purchase-orders/abc').expect(404);
  });

  it('reports health once initialized', async () => {
    await ctx.http.get('/api/health').expect(200, { status: 'ok' });
  });
});
