import type { DB } from '../db/db.js';

export interface HistoryInput {
  poId: number;
  deliveryId: number | null;
  eventType: string;
  before: unknown;
  after: unknown;
  actor: string | null;
  source: string | null;
  note: string | null;
}

export function addHistory(db: DB, entry: HistoryInput, now: string): void {
  db.prepare(
    `INSERT INTO change_history (po_id, delivery_id, event_type, before_json, after_json, actor, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.poId,
    entry.deliveryId,
    entry.eventType,
    entry.before === null ? null : JSON.stringify(entry.before),
    entry.after === null ? null : JSON.stringify(entry.after),
    entry.actor,
    entry.source,
    entry.note || null,
    now,
  );
}
