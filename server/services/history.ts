import type { DB } from '../db/db.js';
import type { ActorType } from '../../shared/types.js';

export interface HistoryInput {
  poId: number;
  deliveryId: number | null;
  eventType: string;
  before: unknown;
  after: unknown;
  actor: string | null;
  source: string | null;
  note: string | null;
  /** Defaults to `buyer` when an actor is named, otherwise `system`. */
  actorType?: ActorType;
  /** Message/result or carrier event behind an automated change, e.g. `message:3/result:7`. */
  sourceRef?: string | null;
}

export function addHistory(db: DB, entry: HistoryInput, now: string): void {
  db.prepare(
    `INSERT INTO change_history (po_id, delivery_id, event_type, before_json, after_json, actor, actor_type, source, source_ref, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.poId,
    entry.deliveryId,
    entry.eventType,
    entry.before === null ? null : JSON.stringify(entry.before),
    entry.after === null ? null : JSON.stringify(entry.after),
    entry.actor,
    entry.actorType ?? (entry.actor ? 'buyer' : 'system'),
    entry.source,
    entry.sourceRef ?? null,
    entry.note || null,
    now,
  );
}
