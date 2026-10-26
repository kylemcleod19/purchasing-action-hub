// System-generated supplier call tasks (PRD §13 "Reply and escalation behavior"). One task per
// request, holding still-unanswered or ambiguous items. They are independent of delivery issues: a
// task closing never resolves an issue, and timing risk never creates a task.
import type { DB } from '../db/db.js';
import { HttpError, notFound, stale } from '../errors.js';
import type { PatchCallTaskInput } from '../../shared/schemas.js';
import type { CallTaskState, ResponseState } from '../../shared/types.js';
import { addHistory } from './history.js';

interface RequestItem {
  id: number;
  poId: number;
  deliveryId: number;
  responseState: ResponseState;
}

const requestItems = (db: DB, requestId: number) =>
  db
    .prepare(
      `SELECT oi.id, l.po_id AS poId, oi.delivery_id AS deliveryId, oi.response_state AS responseState
       FROM outreach_items oi JOIN po_lines l ON l.id = oi.po_line_id WHERE oi.request_id = ? ORDER BY oi.id`,
    )
    .all(requestId) as RequestItem[];

function taskHistory(db: DB, requestId: number, eventType: string, after: Record<string, unknown>, now: string, actor: string | null, note: string | null = null) {
  for (const poId of [...new Set(requestItems(db, requestId).map((i) => i.poId))]) {
    addHistory(
      db,
      { poId, deliveryId: null, eventType, before: null, after, actor, actorType: actor ? 'buyer' : 'simulated_automation', source: null, sourceRef: `request:${requestId}`, note },
      now,
    );
  }
}

/**
 * At the response deadline: one task per request for items still awaiting an answer or needing
 * review. If the task exists, still-missing items merge into it rather than creating another.
 * Idempotent.
 */
export function escalateDueRequests(db: DB, clock: string): number {
  const due = db
    .prepare(`SELECT id FROM outreach_requests WHERE state = 'open' AND response_due_at <= ? ORDER BY id`)
    .all(clock) as { id: number }[];
  let created = 0;
  for (const { id: requestId } of due) {
    const open = requestItems(db, requestId).filter((i) => i.responseState !== 'answered');
    if (open.length === 0) continue;
    let task = db.prepare('SELECT id, state FROM call_tasks WHERE request_id = ?').get(requestId) as { id: number; state: CallTaskState } | undefined;
    if (task && (task.state === 'completed' || task.state === 'answered')) continue;
    const isNew = !task;
    if (!task) {
      const buyer = (db.prepare('SELECT buyer FROM purchase_orders WHERE id = ?').get(open[0].poId) as { buyer: string }).buyer;
      const taskId = Number(
        db
          .prepare(`INSERT INTO call_tasks (request_id, buyer, state, created_at, due_at) VALUES (?, ?, 'open', ?, ?)`)
          .run(requestId, buyer, clock, clock).lastInsertRowid,
      );
      task = { id: taskId, state: 'open' };
      created++;
    }
    const insert = db.prepare('INSERT OR IGNORE INTO call_task_items (task_id, outreach_item_id, response_state) VALUES (?, ?, ?)');
    const added = open.filter((i) => insert.run(task.id, i.id, i.responseState).changes === 1);
    if (added.length > 0) {
      taskHistory(db, requestId, isNew ? 'call_task_created' : 'call_task_updated', { task: task.id, deliveries: added.map((i) => i.deliveryId) }, clock, null);
    }
  }
  return created;
}

/**
 * After a reply: mirror item answers onto the request's task. An unstarted task whose items are all
 * answered closes as "Answered by supplier"; a task the buyer has started stays for the buyer to
 * complete. The request closes once every item is answered.
 */
export function syncAfterReply(db: DB, requestId: number, now: string): void {
  const items = requestItems(db, requestId);
  const task = db.prepare('SELECT id, state FROM call_tasks WHERE request_id = ?').get(requestId) as { id: number; state: CallTaskState } | undefined;
  if (task) {
    const update = db.prepare('UPDATE call_task_items SET response_state = ? WHERE task_id = ? AND outreach_item_id = ?');
    for (const item of items) update.run(item.responseState, task.id, item.id);
    const taskItems = db.prepare('SELECT response_state AS s FROM call_task_items WHERE task_id = ?').all(task.id) as { s: ResponseState }[];
    if (task.state === 'open' && taskItems.every((i) => i.s === 'answered')) {
      db.prepare(`UPDATE call_tasks SET state = 'answered', completed_at = ?, version = version + 1 WHERE id = ?`).run(now, task.id);
      taskHistory(db, requestId, 'call_task_answered', { task: task.id }, now, null);
    }
  }
  if (items.every((i) => i.responseState === 'answered')) {
    db.prepare(`UPDATE outreach_requests SET state = 'closed', version = version + 1 WHERE id = ?`).run(requestId);
  }
}

/** Buyer starts or completes a call task, with a version check. Never touches delivery issues. */
export function patchCallTask(db: DB, id: number, input: PatchCallTaskInput, now: string): void {
  db.transaction(() => {
    const task = db.prepare('SELECT id, request_id AS requestId, buyer, state, version FROM call_tasks WHERE id = ?').get(id) as
      | { id: number; requestId: number; buyer: string; state: CallTaskState; version: number }
      | undefined;
    if (!task) throw notFound('Call task');
    if (task.version !== input.version) throw stale();
    if (input.action === 'start') {
      if (task.state !== 'open') throw new HttpError(422, 'Only an open call task can be started.');
      db.prepare(`UPDATE call_tasks SET state = 'in_progress', version = version + 1 WHERE id = ?`).run(id);
      taskHistory(db, task.requestId, 'call_task_started', { task: id }, now, task.buyer);
      return;
    }
    if (task.state !== 'open' && task.state !== 'in_progress') throw new HttpError(422, 'This call task is already closed.');
    db.prepare(`UPDATE call_tasks SET state = 'completed', completed_at = ?, completion_note = ?, version = version + 1 WHERE id = ?`).run(
      now,
      input.note || null,
      id,
    );
    // The buyer has followed up by phone; the request no longer awaits an emailed answer.
    db.prepare(`UPDATE outreach_requests SET state = 'closed', version = version + 1 WHERE id = ?`).run(task.requestId);
    taskHistory(db, task.requestId, 'call_task_completed', { task: id }, now, task.buyer, input.note || null);
  })();
}
