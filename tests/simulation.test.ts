import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../shared/dates.js';
import { assertIntegrity, CASE_A, CASE_B } from '../server/db/seed.js';
import { getDemoClock } from '../server/db/db.js';
import type { DeliveryRow, OutreachPreview, PurchaseOrderDetail } from '../shared/types.js';
import { createTestContext, DEMO_DATE, type TestContext } from './helpers.js';
import { CASE_A_DEADLINE_TASK_ITEMS, CASE_A_ELIGIBLE, CASE_A_EXCLUDED, CASE_A_REPLY_1, CASE_B_DELAY } from './simulation-expected.js';

const D = (days: number) => addDays(DEMO_DATE, days);

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext();
});
afterEach(() => ctx.cleanup());

const SIM_TABLES = ['outreach_requests', 'outreach_items', 'supplier_messages', 'message_results', 'call_tasks', 'call_task_items', 'carrier_events'];
const snapshot = () => Object.fromEntries([...SIM_TABLES, 'deliveries', 'delivery_issues', 'change_history'].map((t) => [t, ctx.count(t)]));

async function rowsFor(poNumber: string) {
  return (await ctx.incoming()).rows.filter((r) => r.poNumber === poNumber).sort((a, b) => a.lineNo - b.lineNo || a.deliveryId - b.deliveryId);
}
async function caseARow(po: 0 | 1, line: number) {
  return (await rowsFor(CASE_A.poNumbers[po])).find((r) => r.lineNo === line)!;
}
const preview = async (): Promise<OutreachPreview> => (await ctx.http.get('/api/outreach/preview').expect(200)).body;

async function sendCaseA(status: number) {
  const p = await preview();
  const supplier = p.suppliers.find((s) => s.supplierName === CASE_A.supplier) ?? { supplierId: 1, items: [] };
  return ctx.http
    .post('/api/demo/outreach/send')
    .send({ supplierId: supplier.supplierId, items: supplier.items.map((i) => ({ deliveryId: i.deliveryId, version: i.version })) })
    .expect(status);
}
const reply = (key: string) => ctx.http.post(`/api/demo/supplier-replies/${key}`);
const carrier = (key: string) => ctx.http.post(`/api/demo/carrier-events/${key}`);
const advance = (body: object) => ctx.http.post('/api/demo/advance-clock').send(body);

describe('seeded shipment tracking', () => {
  it('links every dispatched or received delivery to one shipment with exactly one untracked exception', async () => {
    expect([ctx.count('suppliers'), ctx.count('purchase_orders'), ctx.count('po_lines'), ctx.count('work_orders')]).toEqual([20, 25, 80, 20]);
    expect(() => assertIntegrity(ctx.db)).not.toThrow();
    const { rows } = await ctx.incoming();
    for (const r of rows) {
      if (r.state === 'planned') expect(r.shipment).toBeNull();
      else expect(r.shipment).not.toBeNull();
    }
    const untracked = rows.filter((r) => r.shipment && !r.shipment.trackingNumber);
    expect(untracked).toHaveLength(1);
    expect(untracked[0]).toMatchObject({ state: 'in_transit', shipment: { trackingUsable: false, carrier: null } });
    expect(rows.filter((r) => r.shipment?.trackingNumber).every((r) => /^DEMO-TRACK-\d{3}$/.test(r.shipment!.trackingNumber!))).toBe(true);
  });

  it('shares SH-DEMO-01 across three rows on two POs and splits one item across two tracking numbers', async () => {
    const { rows } = await ctx.incoming();
    const demo = rows.filter((r) => r.shipment?.number === CASE_B.shipment);
    expect(demo.map((r) => [r.poNumber, r.lineNo, r.quantity])).toEqual(
      expect.arrayContaining([
        [CASE_B.poNumbers[0], 1, 30],
        [CASE_B.poNumbers[0], 2, 12],
        [CASE_B.poNumbers[1], 1, 8],
      ]),
    );
    expect(new Set(demo.map((r) => `${r.shipment!.carrier} ${r.shipment!.trackingNumber}`))).toEqual(new Set([`${CASE_B.carrier} ${CASE_B.tracking}`]));
    const byLine = new Map<number, Set<string>>();
    for (const r of rows) if (r.shipment?.trackingNumber) byLine.set(r.poLineId, (byLine.get(r.poLineId) ?? new Set()).add(r.shipment.trackingNumber));
    expect([...byLine.values()].some((s) => s.size >= 2)).toBe(true);
    // A tracked dispatched portion with a not-shipped remainder on the same item.
    const remainder = rows.find((r) => r.poNumber === CASE_B.poNumbers[0] && r.lineNo === 1 && r.state === 'planned')!;
    expect(remainder).toMatchObject({ quantity: 20, expectedArrival: D(2), shipment: null });
  });
});

describe('Case A: partial supplier reply', () => {
  it('previews read-only, sends once per demo date, and records a simulated outbound message', async () => {
    const before = snapshot();
    const p = await preview();
    expect(snapshot()).toEqual(before);
    const supplier = p.suppliers.find((s) => s.supplierName === CASE_A.supplier)!;
    expect(supplier.items.map((i) => [CASE_A.poNumbers.indexOf(i.poNumber as never), i.lineNo])).toEqual(CASE_A_ELIGIBLE.map((x) => [...x]));
    const excluded = p.excluded.filter((e) => e.supplierName === CASE_A.supplier);
    expect(Object.fromEntries(excluded.map((e) => [e.lineNo, e.reason]))).toEqual(CASE_A_EXCLUDED);
    // Below-50% exclusion is demonstrated by another supplier's item.
    expect(p.excluded.some((e) => e.reason === 'below_half' && e.supplierName !== CASE_A.supplier)).toBe(true);

    const sent = await sendCaseA(201);
    expect(sent.body.itemCount).toBe(8);
    // The same supplier cannot get a second request on the same demo date, even with the same items.
    const items = supplier.items.map((i) => ({ deliveryId: i.deliveryId, version: i.version }));
    const again = await ctx.http.post('/api/demo/outreach/send').send({ supplierId: supplier.supplierId, items }).expect(409);
    expect(again.body.error).toMatch(/already went/);
    const detail = await ctx.po((await caseARow(0, 1)).poId);
    expect(detail.correspondence).toHaveLength(1);
    const out = detail.correspondence[0].messages[0];
    expect(out).toMatchObject({ direction: 'outbound', recipient: expect.stringMatching(/@[a-z-]+\.example\.com$/) });
    expect(out.body).toContain('Please confirm the expected arrival dates at our warehouse below, or provide revised dates and quantities.');
    // Sending changes no dates and no confirmation timestamps.
    expect(await caseARow(0, 1)).toMatchObject({ expectedArrival: D(2), arrivalUpdatedAt: `${D(-7)}T15:00:00.000Z` });
  });

  it('applies the partial reply item by item, escalates one focused call task, and clears it with the clarifying reply', async () => {
    await sendCaseA(201);
    const res = await reply('case-a-reply-1').expect(200);
    expect(res.body).toMatchObject({ applied: CASE_A_REPLY_1.applied, needsReview: CASE_A_REPLY_1.needsReview, notMentioned: CASE_A_REPLY_1.notMentioned });
    const clock = getDemoClock(ctx.db);
    const po1 = await ctx.po((await caseARow(0, 1)).poId);
    const items = po1.correspondence[0].items;
    for (const e of CASE_A_REPLY_1.items) {
      const r = await caseARow(e.po, e.line);
      expect([e.po, e.line, r.expectedArrival, r.issue?.reasons ?? null]).toEqual([e.po, e.line, D(e.arrival), e.issue]);
      expect(r.arrivalUpdatedAt === clock).toBe(e.refreshed);
      expect(r.lastSupplierConfirmationAt === clock).toBe(e.refreshed);
      if (e.refreshed) expect(r.source).toBe('supplier_email');
      expect(items.find((i) => i.deliveryId === r.deliveryId)!.responseState).toBe(e.response);
    }
    // Automated changes are attributed to simulated automation with a source link, never the buyer.
    const automated = po1.history.filter((h) => h.eventType === 'arrival_updated' && h.actorType === 'simulated_automation');
    expect(automated.length).toBeGreaterThan(0);
    expect(automated.every((h) => h.actor === null && /^message:\d+\/result:\d+$/.test(h.sourceRef ?? ''))).toBe(true);
    expect(po1.history.some((h) => h.eventType === 'arrival_confirmed')).toBe(true);

    // Duplicate message ID: no changes.
    const before = snapshot();
    expect((await reply('case-a-reply-1').expect(200)).body.duplicate).toBe(true);
    expect(snapshot()).toEqual(before);

    // Response deadline: one task per request, with the two unresolved items, visible from both POs.
    const scen = (await ctx.http.get('/api/demo/scenarios').expect(200)).body;
    expect(scen.cases[0].steps.find((s: { key: string }) => s.key === 'case-a-deadline').blockedReason).toBeNull();
    const clockRes = await advance({ step: 'case-a-deadline' }).expect(200);
    expect(clockRes.body).toMatchObject({ demoClock: `${D(1)}T15:00:00.000Z`, callTasksCreated: 1 });
    const fromPo1 = (await ctx.po((await caseARow(0, 1)).poId)).callTasks;
    const fromPo2 = (await ctx.po((await caseARow(1, 1)).poId)).callTasks;
    expect(fromPo1).toHaveLength(1);
    expect(fromPo2).toEqual(fromPo1);
    expect(fromPo1[0].items.map((i) => [CASE_A.poNumbers.indexOf(i.poNumber as never), i.lineNo])).toEqual(CASE_A_DEADLINE_TASK_ITEMS.map((x) => [...x]));
    // Later reconciliation merges rather than duplicating the task.
    await advance({ to: `${D(1)}T18:00:00.000Z` }).expect(200);
    expect(ctx.count('call_tasks')).toBe(1);
    expect(ctx.count('call_task_items')).toBe(2);

    // Clarifying reply: both items answered; the unstarted task closes as answered; late issues stay open.
    await reply('case-a-reply-2').expect(200);
    const task = (await ctx.po((await caseARow(0, 1)).poId)).callTasks[0];
    expect(task.state).toBe('answered');
    expect((await caseARow(0, 6)).expectedArrival).toBe(D(2));
    expect((await caseARow(0, 5)).issue).not.toBeNull();
    expect((await caseARow(1, 1)).issue).not.toBeNull();
    expect(ctx.db.prepare('SELECT state FROM outreach_requests').get()).toEqual({ state: 'closed' });
  });

  it('holds a reply for a delivery the buyer changed after the request, and applies the others', async () => {
    await sendCaseA(201);
    const line5 = await caseARow(0, 5);
    await ctx.http.patch(`/api/deliveries/${line5.deliveryId}`).send({ expectedArrival: D(3), source: 'supplier_call', version: line5.version }).expect(200);
    const res = await reply('case-a-reply-1').expect(200);
    expect(res.body).toMatchObject({ applied: 5, needsReview: 2 });
    expect((await caseARow(0, 5)).expectedArrival).toBe(D(3));
    expect((await caseARow(1, 1)).expectedArrival).toBe(D(7));
    const results = (await ctx.po(line5.poId)).correspondence[0].messages[1].results;
    const held = results.find((r) => r.outreachItemId !== null && r.proposedDate === D(4))!;
    expect(held).toMatchObject({ appliedAt: null, reviewReason: expect.stringMatching(/Changed by the buyer/) });
  });

  it('keeps a started call task for the buyer, and a past-date confirmation shows overdue', async () => {
    await sendCaseA(201);
    await reply('case-a-reply-1').expect(200);
    await advance({ step: 'case-a-deadline' }).expect(200);
    let task = (await ctx.po((await caseARow(0, 1)).poId)).callTasks[0];
    await ctx.http.patch(`/api/call-tasks/${task.id}`).send({ action: 'start', version: task.version }).expect(200);
    await ctx.http.patch(`/api/call-tasks/${task.id}`).send({ action: 'start', version: task.version }).expect(409);
    await reply('case-a-reply-2').expect(200);
    task = (await ctx.po((await caseARow(0, 1)).poId)).callTasks[0];
    expect(task.state).toBe('in_progress');
    expect(task.items.every((i) => i.taskResponseState === 'answered')).toBe(true);
    await ctx.http.patch(`/api/call-tasks/${task.id}`).send({ action: 'complete', version: task.version, note: '' }).expect(200);

    await reply('case-a-reply-past').expect(200);
    const past = await caseARow(1, 2);
    // Overdue against the advanced demo date even though dock and production start are in the future.
    expect(past.expectedArrival).toBe(D(-1));
    expect(past.issue?.reasons).toContain('overdue');
    expect(past.requiredDock > D(1)).toBe(true);
  });

  it('refuses replies before a send', async () => {
    await reply('case-a-reply-1').expect(409);
    await reply('no-such-fixture').expect(404);
  });
});

describe('Case B: carrier delay', () => {
  const linkedRows = async () => (await ctx.incoming()).rows.filter((r) => r.shipment?.number === CASE_B.shipment);
  const remainder = async () => (await rowsFor(CASE_B.poNumbers[0])).find((r) => r.lineNo === 1 && r.state === 'planned')!;
  const totals = async () => {
    const details = await Promise.all([...new Set((await linkedRows()).map((r) => r.poId))].map((id) => ctx.po(id)));
    return details.flatMap((d) => d.lines.map((l) => [l.id, l.orderedQty, l.shippedQty, l.receivedQty]));
  };

  it('propagates one delay to exactly the three linked rows; replays and older events change nothing', async () => {
    const totalsBefore = await totals();
    await carrier('case-b-delay').expect(200);
    const rows = await linkedRows();
    for (const [po, line, quantity, reasons] of CASE_B_DELAY.linked) {
      const r = rows.find((x) => x.poNumber === CASE_B.poNumbers[po] && x.lineNo === line)!;
      expect([r.quantity, r.expectedArrival, r.source, r.issue?.reasons]).toEqual([quantity, D(CASE_B_DELAY.eta), 'carrier_update', [...reasons]]);
    }
    expect(await remainder()).toMatchObject({ quantity: CASE_B_DELAY.remainder.quantity, expectedArrival: D(CASE_B_DELAY.remainder.arrival), issue: null });
    expect(await totals()).toEqual(totalsBefore);

    const before = snapshot();
    expect((await carrier('case-b-delay-replay').expect(200)).body.duplicate).toBe(true);
    expect(snapshot()).toEqual(before);

    const older = await carrier('case-b-older').expect(200);
    expect(older.body.appliedState).toBe('ignored');
    expect((await linkedRows()).every((r) => r.expectedArrival === D(6))).toBe(true);
  });

  it('reopens an accepted delay on a later ETA, without duplicating open issues', async () => {
    await carrier('case-b-delay').expect(200);
    const poD = (await linkedRows()).find((r) => r.poNumber === CASE_B.poNumbers[1])!;
    await ctx.http
      .post(`/api/deliveries/${poD.deliveryId}/resolve`)
      .send({ issueId: poD.issue!.id, expectedIssueVersion: poD.issue!.version, expectedDeliveryVersion: poD.version, outcome: 'accepted_delay' })
      .expect(200);
    const openBefore = (await linkedRows()).filter((r) => r.issue).map((r) => r.issue!.id);
    await carrier('case-b-later').expect(200);
    const rows = await linkedRows();
    expect(rows.every((r) => r.expectedArrival === D(8) && r.issue)).toBe(true);
    const reopened = rows.find((r) => r.deliveryId === poD.deliveryId)!;
    expect(reopened.issue!.previousIssueId).toBe(poD.issue!.id);
    expect(rows.filter((r) => r.deliveryId !== poD.deliveryId).map((r) => r.issue!.id).sort()).toEqual(openBefore.sort());
    expect(ctx.db.prepare("SELECT COUNT(*) AS c FROM delivery_issues WHERE state = 'open' GROUP BY delivery_id HAVING c > 1").all()).toEqual([]);
  });

  it('does not overwrite a newer buyer update; holds that delivery for review', async () => {
    await carrier('case-b-delay').expect(200);
    const target = (await linkedRows()).find((r) => r.poNumber === CASE_B.poNumbers[1])!;
    await ctx.http.patch(`/api/deliveries/${target.deliveryId}`).send({ expectedArrival: D(5), source: 'supplier_call', version: target.version }).expect(200);
    const res = await carrier('case-b-later').expect(200);
    expect(res.body).toMatchObject({ appliedState: 'partially_applied', updated: 2, held: 1 });
    const rows = await linkedRows();
    expect(rows.find((r) => r.deliveryId === target.deliveryId)!.expectedArrival).toBe(D(5));
    expect(rows.filter((r) => r.deliveryId !== target.deliveryId).every((r) => r.expectedArrival === D(8))).toBe(true);
    const detail = await ctx.po(target.poId);
    expect(detail.history.some((h) => h.eventType === 'carrier_update_held' && h.deliveryId === target.deliveryId)).toBe(true);
  });

  it('holds an equal-time conflicting event for review', async () => {
    await carrier('case-b-delay').expect(200);
    const shipment = ctx.db.prepare('SELECT id FROM shipments WHERE number = ?').get(CASE_B.shipment) as { id: number };
    const at = `${D(0)}T14:45:00.000Z`;
    ctx.db.prepare(`INSERT INTO carrier_events (shipment_id, external_event_id, occurred_at, received_at, payload_json, applied_state) VALUES (?, 'EVT-OTHER', ?, ?, ?, 'applied')`).run(
      shipment.id,
      at,
      at,
      JSON.stringify({ status: 'delayed', eta: D(7) }),
    );
    ctx.db.prepare('UPDATE shipments SET latest_event_at = ? WHERE id = ?').run(at, shipment.id);
    expect((await carrier('case-b-later').expect(200)).body.appliedState).toBe('held_for_review');
    expect((await linkedRows()).every((r) => r.expectedArrival === D(6))).toBe(true);
  });

  it('records Delivered only at its time: no warehouse receipt, no issue resolution, totals unchanged', async () => {
    await carrier('case-b-delay').expect(200);
    await carrier('case-b-later').expect(200);
    await carrier('case-b-delivered').expect(409);
    const totalsBefore = await totals();
    await advance({ to: `${D(-1)}T15:00:00.000Z` }).expect(422);
    await advance({ step: 'case-b-clock' }).expect(200);
    await carrier('case-b-delivered').expect(200);
    const rows = await linkedRows();
    expect(rows.every((r) => r.state === 'in_transit' && r.receivedAt === null && r.issue !== null)).toBe(true);
    expect(rows.every((r) => r.shipment!.carrierStatus === 'delivered' && r.shipment!.carrierDeliveredAt === `${D(8)}T16:00:00.000Z`)).toBe(true);
    expect(rows.every((r) => r.expectedArrival === D(8))).toBe(true);
    expect(await totals()).toEqual(totalsBefore);
    // Delivered quantities stay out of routine supplier arrival requests.
    const p = await preview();
    const ids = new Set(rows.map((r) => r.deliveryId));
    expect(p.suppliers.flatMap((s) => s.items).some((i) => ids.has(i.deliveryId))).toBe(false);
  });
});

describe('clock, reads, reset, and restart', () => {
  it('moves the clock only forward, reconciles overdue once, and never changes on reads or restart', async () => {
    const before = snapshot();
    await ctx.http.get('/api/demo/scenarios').expect(200);
    await preview();
    await ctx.incoming();
    expect(snapshot()).toEqual(before);
    await advance({ to: `${D(0)}T14:00:00.000Z` }).expect(422);
    await advance({ to: `${D(0)}T15:00:00.000Z` }).expect(422);
    const moved = await advance({ to: `${D(3)}T15:00:00.000Z` }).expect(200);
    expect(moved.body.issuesChanged).toBeGreaterThan(0);
    const issues = ctx.count('delivery_issues');
    await advance({ to: `${D(3)}T16:00:00.000Z` }).expect(200);
    expect(ctx.count('delivery_issues')).toBe(issues);
    ctx.reopen();
    expect(getDemoClock(ctx.db)).toBe(`${D(3)}T16:00:00.000Z`);
    expect((await ctx.http.get('/api/meta').expect(200)).body).toMatchObject({ demoDate: D(3), fixturesInstalled: true });
  });

  it('reset clears messages, receipts, tasks, events, and the clock, and restores the baseline', async () => {
    const baseline = snapshot();
    const baselineDetail: PurchaseOrderDetail = await ctx.po((await caseARow(0, 1)).poId);
    await sendCaseA(201);
    await reply('case-a-reply-1').expect(200);
    await advance({ step: 'case-a-deadline' }).expect(200);
    await carrier('case-b-delay').expect(200);
    await ctx.http.post('/api/demo/reset').send({ confirm: 'RESET' }).expect(200);
    for (const t of SIM_TABLES) expect(ctx.count(t)).toBe(t === 'carrier_events' ? baseline.carrier_events : 0);
    const after = await ctx.po((await caseARow(0, 1)).poId);
    expect(after.lines.map((l) => l.deliveries.map((d: DeliveryRow) => [d.expectedArrival, d.issue]))).toEqual(
      baselineDetail.lines.map((l) => l.deliveries.map((d: DeliveryRow) => [d.expectedArrival, d.issue])),
    );
    expect(after.correspondence).toEqual([]);
  });

  it('hides simulation controls outside DEMO_MODE', async () => {
    const { createApp } = await import('../server/app.js');
    const request = (await import('supertest')).default;
    const app = request(createApp(ctx.db, { demoMode: false }));
    await app.get('/api/demo/scenarios').expect(404);
    await app.post('/api/demo/carrier-events/case-b-delay').expect(404);
  });
});
