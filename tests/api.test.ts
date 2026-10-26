import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { addDays } from '../shared/dates.js';
import { assertIntegrity, DEMO, SEED_VERSION } from '../server/db/seed.js';
import { getDemoDate, getMeta, initializeDatabase, openDatabase } from '../server/db/db.js';
import { createTestContext, DEMO_DATE, tempDbPath, type TestContext } from './helpers.js';

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

const splitBody = (version: number, parts: { quantity: number; date: string | null }[]) => ({
  version,
  source: 'supplier_call',
  note: 'Agreed split with supplier.',
  parts: parts.map((p) => ({ quantity: p.quantity, expectedArrival: p.date })),
});

const DEMO_SPLIT = [
  { quantity: 40, date: D(6) },
  { quantity: 60, date: D(16) },
];

describe('seed', () => {
  it('creates the specified dataset shape with one work order per PO', () => {
    expect(ctx.count('suppliers')).toBe(20);
    expect(ctx.count('warehouses')).toBe(2);
    expect(ctx.count('purchase_orders')).toBe(25);
    expect(ctx.count('po_lines')).toBe(80);
    expect(ctx.count('work_orders')).toBe(20);
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
    const counts = (sql: string) => (ctx.db.prepare(sql).all() as { c: number }[]).map((r) => r.c);
    const perSupplier = counts('SELECT COUNT(*) AS c FROM purchase_orders GROUP BY supplier_id');
    expect(perSupplier.filter((c) => c === 2)).toHaveLength(5);
    expect(perSupplier.filter((c) => c === 1)).toHaveLength(15);
    const perWorkOrder = counts('SELECT COUNT(*) AS c FROM purchase_orders GROUP BY work_order_id');
    expect(perWorkOrder).toHaveLength(20);
    expect(perWorkOrder.filter((c) => c === 2)).toHaveLength(5);
    expect(perWorkOrder.filter((c) => c === 1)).toHaveLength(15);
    const lineCounts = counts('SELECT COUNT(*) AS c FROM po_lines GROUP BY po_id');
    expect(lineCounts.filter((c) => c === 10)).toHaveLength(5);
    expect(lineCounts.filter((c) => c === 1)).toHaveLength(10);
    expect(lineCounts.filter((c) => c === 2)).toHaveLength(10);
  });

  it('has no allocation tables', () => {
    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).not.toContain('work_order_links');
    expect(tables).not.toContain('delivery_links');
  });

  it('every incoming row inherits its PO work order and production start', async () => {
    const { rows } = await ctx.incoming();
    const poWorkOrder = new Map(
      (ctx.db
        .prepare('SELECT p.id, wo.number, wo.production_start AS start FROM purchase_orders p JOIN work_orders wo ON wo.id = p.work_order_id')
        .all() as { id: number; number: string; start: string }[]).map((r) => [r.id, r]),
    );
    for (const row of rows) {
      expect(row.workOrderNumber).toBe(poWorkOrder.get(row.poId)!.number);
      expect(row.productionStart).toBe(poWorkOrder.get(row.poId)!.start);
    }
  });

  it('includes each required example', async () => {
    const { rows } = await ctx.incoming();
    expect(rows.some((r) => r.state !== 'received' && r.primaryReason === 'none')).toBe(true);
    expect(rows.some((r) => r.reasons.includes('date_conflict'))).toBe(true);
    expect(rows.some((r) => r.reasons.includes('date_unknown'))).toBe(true);
    expect(rows.some((r) => r.reasons.includes('arrival_overdue'))).toBe(true);
    expect(rows.some((r) => r.primaryReason === 'follow_up_due')).toBe(true);
    expect(rows.some((r) => r.state === 'in_transit' && r.source === 'carrier_update')).toBe(true);
    expect(rows.some((r) => r.state === 'received')).toBe(true);
    // A PO item with several deliveries on different dates for the same work order.
    const byLine = new Map<number, typeof rows>();
    for (const r of rows) byLine.set(r.poLineId, [...(byLine.get(r.poLineId) ?? []), r]);
    expect(
      [...byLine.values()].some((ds) => ds.length > 1 && new Set(ds.map((d) => d.expectedArrival)).size > 1),
    ).toBe(true);
  });

  it('seeds explicit last-update timestamps and never labels seed data as email or call', async () => {
    const { rows } = await ctx.incoming();
    expect(rows.every((r) => typeof r.updatedAt === 'string')).toBe(true);
    expect(rows.every((r) => ['po_schedule', 'carrier_update'].includes(r.source))).toBe(true);
  });

  it('does not reseed or shift the demo date on restart', async () => {
    const before = ctx.count('deliveries');
    expect(ctx.reopen()).toBe(false);
    expect(getDemoDate(ctx.db)).toBe(DEMO_DATE);
    expect(ctx.count('deliveries')).toBe(before);
  });
});

describe('v1 to v2 migration', () => {
  it('resets a v1 database once to the v2 baseline, then keeps later edits', () => {
    const { dir, dbPath } = tempDbPath();
    try {
      // Build a database as v1 left it: migration 001 applied and seeded.
      let db = openDatabase(dbPath);
      db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      db.exec(readFileSync('server/db/migrations/001_init.sql', 'utf8'));
      db.prepare("INSERT INTO schema_migrations VALUES ('001_init.sql', '2026-10-26T00:00:00Z')").run();
      db.prepare("INSERT INTO app_metadata VALUES ('demo_date', '2026-10-20'), ('seeded_at', '2026-10-20T00:00:00Z')").run();

      expect(initializeDatabase(db, DEMO_DATE)).toBe(true);
      expect(getMeta(db, 'seed_version')).toBe(SEED_VERSION);
      expect((db.prepare('SELECT COUNT(*) AS c FROM work_orders').get() as { c: number }).c).toBe(20);
      db.prepare("UPDATE deliveries SET expected_arrival = '2027-01-01' WHERE id = 1").run();
      db.close();

      db = openDatabase(dbPath);
      expect(initializeDatabase(db, '2030-01-01')).toBe(false);
      expect((db.prepare('SELECT expected_arrival AS a FROM deliveries WHERE id = 1').get() as { a: string }).a).toBe('2027-01-01');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('primary demo', () => {
  it('runs end to end and persists across restart; reset restores the baseline', async () => {
    // 1. Baseline: 100 units for WO-A starting D+7, arrival D+5.
    let row = await demoDelivery();
    expect(row).toMatchObject({
      quantity: 100,
      expectedArrival: D(5),
      workOrderNumber: DEMO.workOrder,
      productionStart: D(7),
      dateStatus: 'no_conflict',
      primaryReason: 'none',
    });
    const baselineUpdate = row.updatedAt;

    // 2. Supplier delay to D+16: all 100 units late against D+7.
    await ctx.http
      .patch(`/api/deliveries/${row.deliveryId}`)
      .send({ expectedArrival: D(16), source: 'supplier_email', note: 'Supplier reports delay.', version: row.version })
      .expect(200);
    row = await demoDelivery();
    expect(row).toMatchObject({ quantity: 100, dateStatus: 'late', primaryReason: 'date_conflict', source: 'supplier_email' });
    expect(row.updatedAt).not.toBe(baselineUpdate);
    expect((await ctx.po(row.poId)).lines[0]).toMatchObject({ lateQty: 100, unknownQty: 0 });

    // 3. Agreed split: 40 at D+6 and 60 at D+16, both for WO-A.
    const split = await ctx.http.post(`/api/deliveries/${row.deliveryId}/split`).send(splitBody(row.version, DEMO_SPLIT)).expect(201);
    expect(split.body.deliveryIds).toHaveLength(2);

    // 4. First 40 no conflict; remaining 60 late; same work order; order total stays 100.
    let [first, second] = await ctx.demoRows();
    expect(first).toMatchObject({ quantity: 40, expectedArrival: D(6), dateStatus: 'no_conflict', primaryReason: 'none', workOrderNumber: DEMO.workOrder });
    expect(second).toMatchObject({ quantity: 60, expectedArrival: D(16), dateStatus: 'late', primaryReason: 'date_conflict', workOrderNumber: DEMO.workOrder });
    let detail = await ctx.po(first.poId);
    expect(detail.po).toMatchObject({ workOrderNumber: DEMO.workOrder, productionStart: D(7) });
    expect(detail.lines[0]).toMatchObject({ orderedQty: 100, plannedQty: 100, inTransitQty: 0, receivedQty: 0, lateQty: 60, unknownQty: 0 });
    expect(detail.history.map((h) => h.eventType)).toEqual(['delivery_split', 'arrival_updated']);

    // 5. Add and complete a follow-up without improving the late date: the 60-unit conflict remains,
    // and the follow-up does not refresh Last update.
    const updatedBefore = second.updatedAt;
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
    expect(second).toMatchObject({ reasons: ['date_conflict'], dateStatus: 'late', quantity: 60, updatedAt: updatedBefore });

    // 6. Restart: changes persist. Reset restores the baseline.
    ctx.reopen();
    [first, second] = await ctx.demoRows();
    expect(second).toMatchObject({ quantity: 60, expectedArrival: D(16), primaryReason: 'date_conflict' });
    detail = await ctx.po(first.poId);
    expect(detail.lines[0].lateQty).toBe(60);
    await ctx.http.post('/api/demo/reset').send({}).expect(400);
    await ctx.http.post('/api/demo/reset').send({ confirm: 'RESET' }).expect(200);
    const reset = await ctx.demoRows();
    expect(reset).toHaveLength(1);
    expect(reset[0]).toMatchObject({ quantity: 100, primaryReason: 'none' });
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
  });
});

describe('arrival updates', () => {
  it('saves with a blank note', async () => {
    const row = await demoDelivery();
    await ctx.http
      .patch(`/api/deliveries/${row.deliveryId}`)
      .send({ expectedArrival: D(4), source: 'supplier_call', note: '', version: row.version })
      .expect(200);
    await ctx.http
      .patch(`/api/deliveries/${row.deliveryId}`)
      .send({ expectedArrival: D(3), source: 'other', version: row.version + 1 })
      .expect(200);
    expect((await demoDelivery()).expectedArrival).toBe(D(3));
  });

  it('rejects a stale version instead of overwriting', async () => {
    const row = await demoDelivery();
    const body = { expectedArrival: D(9), source: 'supplier_call', note: 'First update.', version: row.version };
    await ctx.http.patch(`/api/deliveries/${row.deliveryId}`).send(body).expect(200);
    const res = await ctx.http.patch(`/api/deliveries/${row.deliveryId}`).send({ ...body, expectedArrival: D(3) }).expect(409);
    expect(res.body.error).toMatch(/changed/);
    expect((await demoDelivery()).expectedArrival).toBe(D(9));
  });

  it('accepts an explicit unknown date and treats it as needing attention', async () => {
    const row = await demoDelivery();
    await ctx.http
      .patch(`/api/deliveries/${row.deliveryId}`)
      .send({ expectedArrival: null, source: 'other', version: row.version })
      .expect(200);
    expect(await demoDelivery()).toMatchObject({ primaryReason: 'date_unknown', dateStatus: 'unknown' });
  });

  it('validates input and refuses received deliveries', async () => {
    const row = await demoDelivery();
    const bad = await ctx.http
      .patch(`/api/deliveries/${row.deliveryId}`)
      .send({ expectedArrival: '2026-02-30', source: 'fax', version: row.version })
      .expect(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['expectedArrival', 'source']));
    const received = (await ctx.incoming()).rows.find((r) => r.state === 'received')!;
    await ctx.http
      .patch(`/api/deliveries/${received.deliveryId}`)
      .send({ expectedArrival: D(1), source: 'other', version: received.version })
      .expect(422);
  });
});

describe('splits', () => {
  it.each([99, 101])('rejects a split totaling %i and leaves data unchanged', async (total) => {
    const row = await demoDelivery();
    const historyBefore = ctx.count('change_history');
    const deliveriesBefore = ctx.count('deliveries');
    const res = await ctx.http
      .post(`/api/deliveries/${row.deliveryId}/split`)
      .send(splitBody(row.version, [{ quantity: 40, date: D(6) }, { quantity: total - 40, date: D(16) }]))
      .expect(422);
    expect(res.body.fields.parts).toMatch(/must total the original 100/);
    expect(ctx.count('deliveries')).toBe(deliveriesBefore);
    expect(ctx.count('change_history')).toBe(historyBefore);
    expect(await demoDelivery()).toMatchObject({ deliveryId: row.deliveryId, version: row.version, quantity: 100 });
  });

  it('keeps every split delivery on the original PO item and work order', async () => {
    const row = await demoDelivery();
    await ctx.http.post(`/api/deliveries/${row.deliveryId}/split`).send(splitBody(row.version, DEMO_SPLIT)).expect(201);
    const rows = await ctx.demoRows();
    expect(rows.map((r) => [r.poLineId, r.workOrderNumber, r.productionStart])).toEqual([
      [row.poLineId, DEMO.workOrder, D(7)],
      [row.poLineId, DEMO.workOrder, D(7)],
    ]);
    expect(ctx.count('purchase_orders')).toBe(25);
    expect(ctx.count('po_lines')).toBe(80);
  });

  it('a repeated or stale split cannot create extra deliveries', async () => {
    const row = await demoDelivery();
    const body = splitBody(row.version, DEMO_SPLIT);
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
        .send(splitBody(target.version, [{ quantity: half, date: D(3) }, { quantity: target.quantity - half, date: D(4) }]))
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
    await ctx.http.post(`/api/deliveries/${row.deliveryId}/split`).send(splitBody(row.version, DEMO_SPLIT)).expect(201);
    const detail = await ctx.po(row.poId);
    expect(detail.followUps[0]).toMatchObject({ deliveryId: null, originalDeliveryId: row.deliveryId, state: 'open' });
    expect(detail.history.map((h) => h.eventType)).toContain('follow_up_moved');
  });
});

describe('follow-ups', () => {
  it('completing a follow-up never clears date risk, changes arrivals, or refreshes Last update', async () => {
    const { rows } = await ctx.incoming();
    const late = rows.find((r) => r.primaryReason === 'date_conflict' && r.openFollowUps > 0)!;
    const detail = await ctx.po(late.poId);
    for (const f of detail.followUps.filter((f) => f.state === 'open')) {
      await ctx.http.patch(`/api/follow-ups/${f.id}`).send({ action: 'complete', version: f.version }).expect(200);
    }
    const after = (await ctx.incoming()).rows.find((r) => r.deliveryId === late.deliveryId)!;
    expect(after).toMatchObject({
      primaryReason: 'date_conflict',
      expectedArrival: late.expectedArrival,
      version: late.version,
      updatedAt: late.updatedAt,
      source: late.source,
    });
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
