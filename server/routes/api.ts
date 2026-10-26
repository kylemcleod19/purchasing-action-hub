// Thin JSON routes: parse, call a service, reply. Business rules live in services and shared/.
import { Router } from 'express';
import type { DB } from '../db/db.js';
import { getDemoClock, getDemoDate, getMeta, mutationNow, resetDatabase } from '../db/db.js';
import { SEED_VERSION } from '../db/seed.js';
import { HttpError, notFound, parseBody } from '../errors.js';
import { loadDeliveryRows, loadFilterOptions } from '../services/incoming.js';
import { getPurchaseOrderDetail } from '../services/purchaseOrder.js';
import { resolveIssue, splitDelivery, updateArrival } from '../services/deliveries.js';
import { createFollowUp, patchFollowUp } from '../services/followUps.js';
import { getOutreachPreview, sendOutreach } from '../services/outreach.js';
import { processSupplierReply } from '../services/replies.js';
import { processCarrierEvent } from '../services/carrier.js';
import { advanceClock, clockTarget, getScenarios } from '../services/simulation.js';
import { patchCallTask } from '../services/callTasks.js';
import {
  advanceClockSchema,
  createFollowUpSchema,
  patchCallTaskSchema,
  patchFollowUpSchema,
  resetSchema,
  resolveIssueSchema,
  sendOutreachSchema,
  splitSchema,
  updateArrivalSchema,
} from '../../shared/schemas.js';

function idParam(value: string | string[] | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

const keyParam = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

export function apiRouter(db: DB, options: { demoMode: boolean }): Router {
  const router = Router();
  // Updated rows (with issue summaries) returned after a mutation.
  const currentRows = (ids: number[]) => loadDeliveryRows(db, getDemoDate(db)).filter((r) => ids.includes(r.deliveryId));
  // Simulation controls exist only in DEMO_MODE and never send anything to a real recipient.
  const requireDemo = () => {
    if (!options.demoMode) throw new HttpError(404, 'Not found.');
  };

  router.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    getDemoDate(db);
    res.json({ status: 'ok' });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      demoDate: getDemoDate(db),
      demoClock: getDemoClock(db),
      demoMode: options.demoMode,
      seedVersion: getMeta(db, 'seed_version') ?? null,
      currentSeedVersion: SEED_VERSION,
      fixturesInstalled: !!getMeta(db, 'fixture_version'),
    });
  });

  router.get('/incoming', (_req, res) => {
    const demoDate = getDemoDate(db);
    res.json({ demoDate, rows: loadDeliveryRows(db, demoDate), filterOptions: loadFilterOptions(db) });
  });

  router.get('/purchase-orders/:id', (req, res) => {
    const detail = getPurchaseOrderDetail(db, idParam(req.params.id), getDemoDate(db));
    if (!detail) throw notFound('Purchase order');
    res.json(detail);
  });

  router.patch('/deliveries/:id', (req, res) => {
    const id = idParam(req.params.id);
    updateArrival(db, id, parseBody(updateArrivalSchema, req.body), getDemoDate(db), mutationNow(db));
    res.json({ ok: true, deliveries: currentRows([id]) });
  });

  router.post('/deliveries/:id/split', (req, res) => {
    const ids = splitDelivery(db, idParam(req.params.id), parseBody(splitSchema, req.body), getDemoDate(db), mutationNow(db));
    res.status(201).json({ ok: true, deliveryIds: ids, deliveries: currentRows(ids) });
  });

  router.post('/deliveries/:id/resolve', (req, res) => {
    const id = idParam(req.params.id);
    resolveIssue(db, id, parseBody(resolveIssueSchema, req.body), getDemoDate(db), mutationNow(db));
    res.json({ ok: true, deliveries: currentRows([id]) });
  });

  router.post('/purchase-orders/:id/follow-ups', (req, res) => {
    const id = createFollowUp(db, idParam(req.params.id), parseBody(createFollowUpSchema, req.body));
    res.status(201).json({ ok: true, id });
  });

  router.patch('/follow-ups/:id', (req, res) => {
    patchFollowUp(db, idParam(req.params.id), parseBody(patchFollowUpSchema, req.body));
    res.json({ ok: true });
  });

  router.patch('/call-tasks/:id', (req, res) => {
    patchCallTask(db, idParam(req.params.id), parseBody(patchCallTaskSchema, req.body), mutationNow(db));
    res.json({ ok: true });
  });

  // Read-only: eligible supplier rows and exclusion reasons. Never creates requests.
  router.get('/outreach/preview', (_req, res) => {
    res.json(getOutreachPreview(db));
  });

  router.get('/demo/scenarios', (_req, res) => {
    requireDemo();
    res.json(getScenarios(db));
  });

  router.post('/demo/outreach/send', (req, res) => {
    requireDemo();
    res.status(201).json({ ok: true, ...sendOutreach(db, parseBody(sendOutreachSchema, req.body)) });
  });

  router.post('/demo/supplier-replies/:fixtureId', (req, res) => {
    requireDemo();
    res.json({ ok: true, ...processSupplierReply(db, keyParam(req.params.fixtureId)) });
  });

  router.post('/demo/carrier-events/:fixtureId', (req, res) => {
    requireDemo();
    res.json({ ok: true, ...processCarrierEvent(db, keyParam(req.params.fixtureId)) });
  });

  // Forward-only. Accepts an explicit timestamp or a named scenario step.
  router.post('/demo/advance-clock', (req, res) => {
    requireDemo();
    const step = typeof req.body?.step === 'string' ? req.body.step : null;
    const to = step ? clockTarget(db, step) : parseBody(advanceClockSchema, req.body).to;
    res.json({ ok: true, ...advanceClock(db, to) });
  });

  router.post('/demo/reset', (req, res) => {
    requireDemo();
    parseBody(resetSchema, req.body);
    resetDatabase(db);
    res.json({ ok: true, demoDate: getDemoDate(db) });
  });

  return router;
}
