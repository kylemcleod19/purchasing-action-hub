// Supplier follow-up tasks. Follow-ups never change delivery data or clear a date risk.
import type { DB } from '../db/db.js';
import { HttpError, notFound, stale } from '../errors.js';
import { addHistory } from './deliveries.js';
import type { CreateFollowUpInput, PatchFollowUpInput } from '../../shared/schemas.js';

function assertDeliveryOnPo(db: DB, poId: number, deliveryId: number | null) {
  if (deliveryId === null) return;
  const row = db
    .prepare(
      `SELECT d.superseded_at AS supersededAt FROM deliveries d JOIN po_lines l ON l.id = d.po_line_id
       WHERE d.id = ? AND l.po_id = ?`,
    )
    .get(deliveryId, poId) as { supersededAt: string | null } | undefined;
  if (!row || row.supersededAt !== null) {
    throw new HttpError(422, 'Choose a current delivery on this PO.', { deliveryId: 'Choose a current delivery on this PO.' });
  }
}

export function createFollowUp(db: DB, poId: number, input: CreateFollowUpInput): number {
  return db.transaction(() => {
    const po = db.prepare('SELECT id FROM purchase_orders WHERE id = ?').get(poId);
    if (!po) throw notFound('Purchase order');
    assertDeliveryOnPo(db, poId, input.deliveryId);
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare(
          `INSERT INTO follow_ups (po_id, delivery_id, due_date, note, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?)`,
        )
        .run(poId, input.deliveryId, input.dueDate, input.note, now, now).lastInsertRowid,
    );
    addHistory(
      db,
      {
        poId,
        deliveryId: input.deliveryId,
        eventType: 'follow_up_added',
        before: null,
        after: { dueDate: input.dueDate },
        source: null,
        note: input.note,
      },
      now,
    );
    return id;
  })();
}

interface FollowUpRecord {
  id: number;
  poId: number;
  deliveryId: number | null;
  dueDate: string;
  note: string;
  state: 'open' | 'completed';
  version: number;
}

export function patchFollowUp(db: DB, id: number, input: PatchFollowUpInput): void {
  db.transaction(() => {
    const current = db
      .prepare(
        `SELECT id, po_id AS poId, delivery_id AS deliveryId, due_date AS dueDate, note, state, version
         FROM follow_ups WHERE id = ?`,
      )
      .get(id) as FollowUpRecord | undefined;
    if (!current) throw notFound('Follow-up');
    if (current.version !== input.version) throw stale();
    if (current.state === 'completed') throw new HttpError(422, 'Completed follow-ups cannot be changed.');
    const now = new Date().toISOString();

    if (input.action === 'edit') {
      assertDeliveryOnPo(db, current.poId, input.deliveryId);
      const result = db
        .prepare(
          `UPDATE follow_ups SET delivery_id = ?, due_date = ?, note = ?, updated_at = ?, version = version + 1
           WHERE id = ? AND version = ?`,
        )
        .run(input.deliveryId, input.dueDate, input.note, now, id, input.version);
      if (result.changes !== 1) throw stale();
      addHistory(
        db,
        {
          poId: current.poId,
          deliveryId: input.deliveryId,
          eventType: 'follow_up_edited',
          before: { dueDate: current.dueDate, note: current.note, delivery: current.deliveryId },
          after: { dueDate: input.dueDate, note: input.note, delivery: input.deliveryId },
          source: null,
          note: input.note,
        },
        now,
      );
      return;
    }

    const result = db
      .prepare(
        `UPDATE follow_ups SET state = 'completed', completion_note = ?, completed_at = ?, updated_at = ?,
                version = version + 1
         WHERE id = ? AND version = ? AND state = 'open'`,
      )
      .run(input.completionNote || null, now, now, id, input.version);
    if (result.changes !== 1) throw stale();
    addHistory(
      db,
      {
        poId: current.poId,
        deliveryId: current.deliveryId,
        eventType: 'follow_up_completed',
        before: { state: 'open' },
        after: { state: 'completed' },
        source: null,
        note: input.completionNote ? `${current.note} — ${input.completionNote}` : current.note,
      },
      now,
    );
  })();
}
