import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { addDays } from '../shared/dates.js';
import { assertIntegrity, DEMO, SEED_VERSION } from '../server/db/seed.js';
import { getDemoDate, getMeta, initializeDatabase, openDatabase, type DB } from '../server/db/db.js';
import type { DeliveryRow } from '../shared/types.js';
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

const arrival = (row: DeliveryRow, expectedArrival: string | null, extra: object = {}) =>
  ctx.http.patch(`/api/deliveries/${row.deliveryId}`).send({ expectedArrival, source: 'supplier_email', version: row.version, ...extra });

const resolveBody = (row: DeliveryRow, outcome: string, note = '') => ({
  issueId: row.issue!.id,
  expectedIssueVersion: row.issue!.version,
  outcome,
  note,
});

const resolve = (row: DeliveryRow, outcome: string, note = '') =>
  ctx.http
    .post(`/api/deliveries/${row.deliveryId}/resolve`)
    .send({ ...resolveBody(row, outcome, note), expectedDeliveryVersion: row.version });

const split = (row: DeliveryRow, parts: [number, string | null][], extra: object = {}) =>
  ctx.http.post(`/api/deliveries/${row.deliveryId}/split`).send({
    version: row.version,
    source: 'supplier_call',
    parts: parts.map(([quantity, expectedArrival]) => ({ quantity, expectedArrival })),
    ...extra,
  });

const counts = (db: DB) => ({
  deliveries: (db.prepare('SELECT COUNT(*) AS c FROM deliveries').get() as { c: number }).c,
  issues: (db.prepare('SELECT COUNT(*) AS c FROM delivery_issues').get() as { c: number }).c,
  history: (db.prepare('SELECT COUNT(*) AS c FROM change_history').get() as { c: number }).c,
});

async function row(id: number) {
  return (await ctx.incoming()).rows.find((r) => r.deliveryId === id)!;
}

describe('seed', () => {
  it('creates the specified dataset shape with one work order per PO', () => {
    expect(ctx.count('suppliers')).toBe(20);
    expect(ctx.count('warehouses')).toBe(2);
    expect(ctx.count('purchase_orders')).toBe(25);
    expect(ctx.count('po_lines')).toBe(80);
    expect(ctx.count('work_orders')).toBe(20);
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
    const grouped = (sql: string) => (ctx.db.prepare(sql).all() as { c: number }[]).map((r) => r.c);
    const perSupplier = grouped('SELECT COUNT(*) AS c FROM purchase_orders GROUP BY supplier_id');
    expect(perSupplier.filter((c) => c === 2)).toHaveLength(5);
    expect(perSupplier.filter((c) => c === 1)).toHaveLength(15);
    const perWorkOrder = grouped('SELECT COUNT(*) AS c FROM purchase_orders GROUP BY work_order_id');
    expect(perWorkOrder).toHaveLength(20);
    expect(perWorkOrder.filter((c) => c === 2)).toHaveLength(5);
    const lineCounts = grouped('SELECT COUNT(*) AS c FROM po_lines GROUP BY po_id');
    expect([lineCounts.filter((c) => c === 10).length, lineCounts.filter((c) => c === 1).length, lineCounts.filter((c) => c === 2).length]).toEqual([5, 10, 10]);
  });

  it('gives each supplier a coherent catalog (one part family per supplier)', () => {
    const families = ctx.db
      .prepare(
        `SELECT s.name, COUNT(DISTINCT substr(l.part_number, 1, 2)) AS families
         FROM suppliers s JOIN purchase_orders p ON p.supplier_id = s.id JOIN po_lines l ON l.po_id = p.id GROUP BY s.id`,
      )
      .all() as { name: string; families: number }[];
    expect(families).toHaveLength(20);
    expect(families.filter((f) => f.families !== 1)).toEqual([]);
  });

  it('includes each required example and issue scenario', async () => {
    const { rows } = await ctx.incoming();
    const has = (pred: (r: DeliveryRow) => boolean) => expect(rows.some(pred)).toBe(true);
    has((r) => r.state !== 'received' && r.risk.reasons.length === 0 && r.expectedArrival! < r.productionStart);
    has((r) => r.risk.reasons.includes('late') && !r.risk.reasons.includes('production_conflict'));
    has((r) => r.risk.reasons.includes('production_conflict'));
    has((r) => r.risk.reasons.includes('unknown'));
    has((r) => r.risk.reasons.includes('overdue'));
    has((r) => r.state === 'in_transit' && r.source === 'carrier_update');
    has((r) => r.state === 'received' && r.receivedAt !== null);
    has((r) => r.issue !== null);
    has((r) => r.issue === null && r.lastResolution?.outcome === 'accepted_delay' && r.risk.reasons.includes('late'));
    has((r) => r.lastResolution?.outcome === 'date_restored' && r.risk.reasons.length === 0);
    has((r) => r.lastResolution?.outcome === 'split_agreed');
    expect(rows.filter((r) => r.issue).length).toBeLessThan(rows.length / 2);
    // A PO item split into deliveries with different dates for the same work order.
    const byLine = new Map<number, DeliveryRow[]>();
    for (const r of rows) byLine.set(r.poLineId, [...(byLine.get(r.poLineId) ?? []), r]);
    expect([...byLine.values()].some((ds) => ds.length > 1 && new Set(ds.map((d) => d.expectedArrival)).size > 1)).toBe(true);
    // Required dock is seeded on every item, on or before production start.
    expect(rows.every((r) => r.requiredDock && r.requiredDock <= r.productionStart)).toBe(true);
  });

  it('every row inherits its PO work order and production start', async () => {
    const { rows } = await ctx.incoming();
    const expected = new Map(
      (ctx.db.prepare('SELECT p.id, wo.number, wo.production_start AS start FROM purchase_orders p JOIN work_orders wo ON wo.id = p.work_order_id').all() as {
        id: number;
        number: string;
        start: string;
      }[]).map((r) => [r.id, r]),
    );
    for (const r of rows) expect([r.workOrderNumber, r.productionStart]).toEqual([expected.get(r.poId)!.number, expected.get(r.poId)!.start]);
  });

  it('does not reseed, shift the demo date, or create issues on restart or repeated reads', async () => {
    const before = counts(ctx.db);
    await ctx.incoming();
    await ctx.incoming();
    expect(ctx.reopen()).toBe(false);
    expect(getDemoDate(ctx.db)).toBe(DEMO_DATE);
    expect(counts(ctx.db)).toEqual(before);
  });
});

describe('primary demo', () => {
  it('runs end to end with inline resolution; state persists; reset restores the baseline', async () => {
    // 1. 100 units for WO-A: required dock D+5, production start D+7, arrival D+5.
    let demo = await demoDelivery();
    expect(demo).toMatchObject({ quantity: 100, requiredDock: D(5), productionStart: D(7), expectedArrival: D(5), workOrderNumber: DEMO.workOrder, issue: null });

    // 2. Delay to D+16: one open issue; late and production conflict.
    await arrival(demo, D(16)).expect(200);
    demo = await demoDelivery();
    expect(demo.risk).toMatchObject({ reasons: ['production_conflict', 'late'], daysLate: 11, daysAfterStart: 9 });
    expect(demo.issue?.reasons).toEqual(['production_conflict', 'late', 'moved_later']);
    expect(demo.requiredDock).toBe(D(5));

    // 3. Split 40 at D+5 and 60 at D+16 with Save and resolve (Split delivery agreed), one request.
    await split(demo, [[40, D(5)], [60, D(16)]], { resolve: resolveBody(demo, 'split_agreed') }).expect(201);

    // 4. Ordered 100, nothing shipped; two arrivals; the 60 keeps its warning; no open action.
    let [first, second] = await ctx.demoRows();
    expect(first).toMatchObject({ quantity: 40, expectedArrival: D(5), issue: null, lastResolution: { outcome: 'split_agreed' } });
    expect(first.risk.reasons).toEqual([]);
    expect(second).toMatchObject({ quantity: 60, expectedArrival: D(16), issue: null, lastResolution: { outcome: 'split_agreed' } });
    expect(second.risk.reasons).toEqual(['production_conflict', 'late']);
    let detail = await ctx.po(first.poId);
    expect(detail.lines[0]).toMatchObject({ orderedQty: 100, shippedQty: 0, receivedQty: 0, openIssueCount: 0 });
    expect(detail.lines[0].deliveries).toHaveLength(2);

    // 5. Move the 60 to D+18: a new issue opens; accept the delay without changing the date.
    await arrival(second, D(18), { source: 'supplier_call' }).expect(200);
    second = await row(second.deliveryId);
    expect(second.issue).not.toBeNull();
    expect(second.issue!.previousIssueId).not.toBeNull();
    const arrivalUpdatedAt = second.arrivalUpdatedAt;
    await resolve(second, 'accepted_delay').expect(200);
    second = await row(second.deliveryId);
    expect(second).toMatchObject({ issue: null, expectedArrival: D(18), lastResolution: { outcome: 'accepted_delay', resolvedBy: detail.po.buyer } });
    expect(second.risk.reasons).toContain('production_conflict');

    // 6. Complete a reminder: dates, Last update, and resolution unchanged.
    const reminder = await ctx.http.post(`/api/purchase-orders/${first.poId}/follow-ups`).send({ deliveryId: second.deliveryId, dueDate: D(0), note: 'Check expedite.' }).expect(201);
    await ctx.http.patch(`/api/follow-ups/${reminder.body.id}`).send({ action: 'complete', version: 1 }).expect(200);
    const afterReminder = await row(second.deliveryId);
    expect(afterReminder).toMatchObject({ expectedArrival: D(18), arrivalUpdatedAt, issue: null, lastResolution: second.lastResolution });

    ctx.reopen();
    expect(await row(second.deliveryId)).toMatchObject({ expectedArrival: D(18), issue: null });
    detail = await ctx.po(first.poId);
    expect(detail.history.map((h) => h.eventType)).toEqual(
      expect.arrayContaining(['arrival_updated', 'issue_opened', 'delivery_split', 'issue_resolved', 'follow_up_completed']),
    );
    expect(detail.history.find((h) => h.eventType === 'issue_resolved')?.actor).toBe(detail.po.buyer);

    await ctx.http.post('/api/demo/reset').send({}).expect(400);
    await ctx.http.post('/api/demo/reset').send({ confirm: 'RESET' }).expect(200);
    expect(await demoDelivery()).toMatchObject({ quantity: 100, expectedArrival: D(5), issue: null });
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
  });
});

describe('arrival updates and issues', () => {
  it('saves with blank arrival and resolution notes', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(9), { note: '' }).expect(200);
    demo = await demoDelivery();
    await arrival(demo, D(9), { note: '', resolve: resolveBody(demo, 'accepted_delay', '') }).expect(200);
    expect((await demoDelivery()).issue).toBeNull();
  });

  it('Save changes keeps an open issue even when the date becomes on time; Save and resolve closes it atomically', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(9)).expect(200);
    demo = await demoDelivery();
    await arrival(demo, D(4)).expect(200);
    demo = await demoDelivery();
    expect(demo.risk.reasons).toEqual([]);
    expect(demo.issue).not.toBeNull();
    await arrival(demo, D(4), { resolve: resolveBody(demo, 'date_restored') }).expect(200);
    demo = await demoDelivery();
    expect(demo).toMatchObject({ issue: null, lastResolution: { outcome: 'date_restored' } });
  });

  it('Date restored rejects late, unknown, and overdue estimates and leaves everything unchanged', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(9)).expect(200);
    demo = await demoDelivery();
    for (const date of [D(6), null, D(-1)]) {
      const before = counts(ctx.db);
      await arrival(demo, date, { resolve: resolveBody(demo, 'date_restored') }).expect(422);
      expect(counts(ctx.db)).toEqual(before);
    }
    await resolve(demo, 'date_restored').expect(422);
    await resolve(demo, 'split_agreed').expect(422);
    expect(await demoDelivery()).toMatchObject({ expectedArrival: D(9), version: demo.version, issue: { id: demo.issue!.id } });
  });

  it('accepted late delivery leaves Needs action but stays late with its warning', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(6)).expect(200);
    demo = await demoDelivery();
    await resolve(demo, 'accepted_delay').expect(200);
    demo = await demoDelivery();
    expect(demo.issue).toBeNull();
    expect(demo.risk.reasons).toEqual(['late']);
  });

  it('does not reopen on refresh, identical dates, or source-only edits; reopens on later, unknown, or overdue', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(10)).expect(200);
    demo = await demoDelivery();
    await resolve(demo, 'accepted_delay').expect(200);
    const resolvedIssues = counts(ctx.db).issues;
    for (const source of ['supplier_call', 'other']) {
      demo = await demoDelivery();
      await arrival(demo, D(10), { source, note: 'Reconfirmed.' }).expect(200);
    }
    demo = await demoDelivery();
    await arrival(demo, D(8)).expect(200); // improved, same accepted risk
    await ctx.incoming();
    demo = await demoDelivery();
    expect(demo.issue).toBeNull();
    expect(counts(ctx.db).issues).toBe(resolvedIssues);

    await arrival(demo, D(12)).expect(200);
    demo = await demoDelivery();
    expect(demo.issue?.reasons).toContain('moved_later');
    await resolve(demo, 'reviewed').expect(200);
    demo = await demoDelivery();
    await arrival(demo, null).expect(200);
    demo = await demoDelivery();
    expect(demo.issue?.reasons).toEqual(['unknown']);
    await resolve(demo, 'reviewed').expect(200);
    demo = await demoDelivery();
    await arrival(demo, D(-1)).expect(200);
    expect((await demoDelivery()).issue?.reasons).toContain('overdue');
  });

  it('rejects stale delivery and issue versions and a wrong issue id', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(9)).expect(200);
    await arrival(demo, D(3)).expect(409);
    demo = await demoDelivery();
    await resolve({ ...demo, issue: { ...demo.issue!, version: demo.issue!.version + 1 } }, 'accepted_delay').expect(409);
    await resolve({ ...demo, issue: { ...demo.issue!, id: demo.issue!.id + 999 } }, 'accepted_delay').expect(409);
    await resolve({ ...demo, version: demo.version + 1 }, 'accepted_delay').expect(409);
    await resolve(demo, 'accepted_delay').expect(200);
    await resolve(demo, 'accepted_delay').expect(409);
    expect((await demoDelivery()).expectedArrival).toBe(D(9));
  });

  it('refuses updates to received deliveries', async () => {
    const received = (await ctx.incoming()).rows.find((r) => r.state === 'received')!;
    await arrival(received, D(1)).expect(422);
  });
});

describe('splits', () => {
  it.each([99, 101])('rejects a split totaling %i and leaves deliveries, issues, and history unchanged', async (total) => {
    const demo = await demoDelivery();
    const before = counts(ctx.db);
    const res = await split(demo, [[40, D(5)], [total - 40, D(16)]]).expect(422);
    expect(res.body.fields.parts).toMatch(/must total the original 100/);
    expect(counts(ctx.db)).toEqual(before);
  });

  it('children keep the PO item, required dock date, and work order', async () => {
    const demo = await demoDelivery();
    await split(demo, [[40, D(5)], [60, D(16)]]).expect(201);
    const rows = await ctx.demoRows();
    expect(rows.map((r) => [r.poLineId, r.requiredDock, r.workOrderNumber, r.productionStart])).toEqual([
      [demo.poLineId, D(5), DEMO.workOrder, D(7)],
      [demo.poLineId, D(5), DEMO.workOrder, D(7)],
    ]);
    expect([ctx.count('purchase_orders'), ctx.count('po_lines')]).toEqual([25, 80]);
  });

  it('Save changes transfers the open review to every child, even an on-time one, and leaves unrelated issues open', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(16)).expect(200);
    demo = await demoDelivery();
    const unrelatedOpen = (await ctx.incoming()).rows.filter((r) => r.issue && r.deliveryId !== demo.deliveryId).map((r) => r.issue!.id);
    await split(demo, [[40, D(5)], [60, D(16)]]).expect(201);
    const children = await ctx.demoRows();
    expect(children.map((c) => c.issue?.parentIssueId)).toEqual([demo.issue!.id, demo.issue!.id]);
    expect(children[0].risk.reasons).toEqual([]);
    const parentIssue = ctx.db.prepare('SELECT state FROM delivery_issues WHERE id = ?').get(demo.issue!.id) as { state: string };
    expect(parentIssue.state).toBe('superseded');
    const stillOpen = (await ctx.incoming()).rows.filter((r) => r.issue && !children.some((c) => c.deliveryId === r.deliveryId)).map((r) => r.issue!.id);
    expect(stillOpen.sort()).toEqual(unrelatedOpen.sort());
  });

  it('a repeated or stale split cannot duplicate supply or issues', async () => {
    let demo = await demoDelivery();
    await arrival(demo, D(16)).expect(200);
    demo = await demoDelivery();
    const body = { resolve: resolveBody(demo, 'split_agreed') };
    await split(demo, [[40, D(5)], [60, D(16)]], body).expect(201);
    const after = counts(ctx.db);
    await split(demo, [[40, D(5)], [60, D(16)]], body).expect(409);
    await split({ ...demo, version: demo.version + 1 }, [[40, D(5)], [60, D(16)]]).expect(409);
    expect(counts(ctx.db)).toEqual(after);
    expect((await ctx.demoRows()).reduce((s, r) => s + r.quantity, 0)).toBe(100);
  });

  it('blocks splitting in-transit and received deliveries', async () => {
    const { rows } = await ctx.incoming();
    for (const state of ['in_transit', 'received'] as const) {
      const target = rows.find((r) => r.state === state && r.quantity >= 2)!;
      const half = Math.floor(target.quantity / 2);
      const res = await split(target, [[half, D(3)], [target.quantity - half, D(4)]]).expect(422);
      expect(res.body.error).toMatch(/Only not-shipped deliveries/);
    }
  });
});

describe('reminders', () => {
  it('completing a reminder never resolves an issue or changes Last update', async () => {
    const late = (await ctx.incoming()).rows.find((r) => r.issue && r.openFollowUps > 0)!;
    const detail = await ctx.po(late.poId);
    for (const f of detail.followUps.filter((f) => f.state === 'open')) {
      await ctx.http.patch(`/api/follow-ups/${f.id}`).send({ action: 'complete', version: f.version }).expect(200);
    }
    const after = await row(late.deliveryId);
    expect(after).toMatchObject({ issue: late.issue, expectedArrival: late.expectedArrival, arrivalUpdatedAt: late.arrivalUpdatedAt, version: late.version });
  });

  it('rejects stale and repeated completion', async () => {
    const demo = await demoDelivery();
    const { body } = await ctx.http.post(`/api/purchase-orders/${demo.poId}/follow-ups`).send({ deliveryId: null, dueDate: D(1), note: 'Check status.' }).expect(201);
    await ctx.http.patch(`/api/follow-ups/${body.id}`).send({ action: 'complete', version: 1 }).expect(200);
    await ctx.http.patch(`/api/follow-ups/${body.id}`).send({ action: 'complete', version: 1 }).expect(409);
  });
});

describe('migration 003 on existing v2 data', () => {
  it('preserves edits, falls back to production start for dock dates, and initializes issues once', () => {
    const { dir, dbPath } = tempDbPath();
    try {
      let db = openDatabase(dbPath);
      db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      for (const file of ['001_init.sql', '002_po_single_work_order.sql']) {
        db.exec(readFileSync(`server/db/migrations/${file}`, 'utf8'));
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(file, '2026-10-26T00:00:00Z');
      }
      db.exec(`
        INSERT INTO suppliers (id, name) VALUES (1, 'S');
        INSERT INTO warehouses (id, code, name) VALUES (1, 'W', 'W');
        INSERT INTO work_orders (id, number, program, warehouse_id, production_start) VALUES (1, 'WO-1', 'P', 1, '2026-11-02');
        INSERT INTO purchase_orders (id, number, supplier_id, warehouse_id, work_order_id, buyer, status) VALUES (1, 'PO-1', 1, 1, 1, 'B', 'Open');
        INSERT INTO po_lines (id, po_id, line_no, part_number, description, unit, ordered_qty) VALUES (1, 1, 1, 'X-1', 'x', 'EA', 30);
        INSERT INTO deliveries (id, po_line_id, quantity, state, expected_arrival, source, updated_at)
          VALUES (1, 1, 10, 'planned', '2026-11-10', 'supplier_email', '2026-10-25T10:00:00Z'),
                 (2, 1, 10, 'planned', '2026-10-30', 'po_schedule', '2026-10-01T10:00:00Z'),
                 (3, 1, 10, 'received', '2026-10-20', 'po_schedule', '2026-10-01T10:00:00Z');
        UPDATE deliveries SET received_date = '2026-10-20' WHERE id = 3;
        INSERT INTO follow_ups (po_id, delivery_id, due_date, note, state, completed_at, created_at, updated_at)
          VALUES (1, 1, '2026-10-24', 'Asked supplier', 'completed', '2026-10-24T09:00:00Z', '2026-10-20T09:00:00Z', '2026-10-24T09:00:00Z');
        INSERT INTO app_metadata VALUES ('demo_date', '2026-10-26'), ('seed_version', '2'), ('seeded_at', '2026-10-26T00:00:00Z');
      `);

      expect(initializeDatabase(db, '2030-01-01')).toBe(false);
      const deliveries = db.prepare('SELECT id, expected_arrival AS a, arrival_updated_at AS u, received_at AS r FROM deliveries ORDER BY id').all();
      expect(deliveries).toEqual([
        { id: 1, a: '2026-11-10', u: '2026-10-25T10:00:00Z', r: null },
        { id: 2, a: '2026-10-30', u: '2026-10-01T10:00:00Z', r: null },
        { id: 3, a: '2026-10-20', u: '2026-10-01T10:00:00Z', r: '2026-10-20' },
      ]);
      expect((db.prepare('SELECT required_dock_date AS d FROM po_lines').get() as { d: string }).d).toBe('2026-11-02');
      // The completed reminder is not read as acceptance: the late delivery gets one open issue.
      const issues = () => db.prepare('SELECT delivery_id AS id, state FROM delivery_issues').all();
      expect(issues()).toEqual([{ id: 1, state: 'open' }]);
      expect(getMeta(db, 'seed_version')).toBe('2');
      db.close();

      db = openDatabase(dbPath);
      initializeDatabase(db, '2030-01-01');
      expect(issues()).toEqual([{ id: 1, state: 'open' }]);
      expect(SEED_VERSION).toBe('3');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('API surface', () => {
  it('returns JSON 404 for unknown API routes and missing POs', async () => {
    const res = await ctx.http.get('/api/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/json/);
    await ctx.http.get('/api/purchase-orders/99999').expect(404);
  });

  it('reports health once initialized', async () => {
    await ctx.http.get('/api/health').expect(200, { status: 'ok' });
  });
});
