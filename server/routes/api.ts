// Thin JSON routes: parse, call a service, reply. Business rules live in services and shared/.
import { Router } from 'express';
import type { DB } from '../db/db.js';
import { getDemoDate, getMeta, resetDatabase } from '../db/db.js';
import { SEED_VERSION } from '../db/seed.js';
import { HttpError, notFound, parseBody } from '../errors.js';
import { loadDeliveryRows } from '../services/incoming.js';
import { getPurchaseOrderDetail } from '../services/purchaseOrder.js';
import { resolveIssue, splitDelivery, updateArrival } from '../services/deliveries.js';
import { createFollowUp, patchFollowUp } from '../services/followUps.js';
import {
  createFollowUpSchema,
  patchFollowUpSchema,
  resetSchema,
  resolveIssueSchema,
  splitSchema,
  updateArrivalSchema,
} from '../../shared/schemas.js';

function idParam(value: string | string[] | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

export function apiRouter(db: DB, options: { demoMode: boolean }): Router {
  const router = Router();
  // Updated rows (with issue summaries) returned after a mutation.
  const currentRows = (ids: number[]) => loadDeliveryRows(db, getDemoDate(db)).filter((r) => ids.includes(r.deliveryId));

  router.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    getDemoDate(db);
    res.json({ status: 'ok' });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      demoDate: getDemoDate(db),
      demoMode: options.demoMode,
      seedVersion: getMeta(db, 'seed_version') ?? null,
      currentSeedVersion: SEED_VERSION,
    });
  });

  router.get('/incoming', (_req, res) => {
    const demoDate = getDemoDate(db);
    res.json({ demoDate, rows: loadDeliveryRows(db, demoDate) });
  });

  router.get('/purchase-orders/:id', (req, res) => {
    const detail = getPurchaseOrderDetail(db, idParam(req.params.id), getDemoDate(db));
    if (!detail) throw notFound('Purchase order');
    res.json(detail);
  });

  router.patch('/deliveries/:id', (req, res) => {
    const id = idParam(req.params.id);
    updateArrival(db, id, parseBody(updateArrivalSchema, req.body), getDemoDate(db));
    res.json({ ok: true, deliveries: currentRows([id]) });
  });

  router.post('/deliveries/:id/split', (req, res) => {
    const ids = splitDelivery(db, idParam(req.params.id), parseBody(splitSchema, req.body), getDemoDate(db));
    res.status(201).json({ ok: true, deliveryIds: ids, deliveries: currentRows(ids) });
  });

  router.post('/deliveries/:id/resolve', (req, res) => {
    const id = idParam(req.params.id);
    resolveIssue(db, id, parseBody(resolveIssueSchema, req.body), getDemoDate(db));
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

  router.post('/demo/reset', (req, res) => {
    if (!options.demoMode) throw new HttpError(404, 'Not found.');
    parseBody(resetSchema, req.body);
    resetDatabase(db);
    res.json({ ok: true, demoDate: getDemoDate(db) });
  });

  return router;
}
