// Arrival updates and planned-delivery splits (PRD §7). Each mutation runs in one transaction with
// a version precondition, so stale or repeated submits cannot overwrite changes or add supply.
import type { DB } from '../db/db.js';
import { HttpError, notFound, stale } from '../errors.js';
import type { SplitInput, UpdateArrivalInput } from '../../shared/schemas.js';
import type { DeliveryState } from '../../shared/types.js';

interface DeliveryRecord {
  id: number;
  poId: number;
  poLineId: number;
  quantity: number;
  state: DeliveryState;
  expectedArrival: string | null;
  source: string;
  version: number;
  supersededAt: string | null;
}

function loadDelivery(db: DB, id: number): DeliveryRecord {
  const row = db
    .prepare(
      `SELECT d.id, l.po_id AS poId, d.po_line_id AS poLineId, d.quantity, d.state,
              d.expected_arrival AS expectedArrival, d.source, d.version, d.superseded_at AS supersededAt
       FROM deliveries d JOIN po_lines l ON l.id = d.po_line_id WHERE d.id = ?`,
    )
    .get(id) as DeliveryRecord | undefined;
  if (!row) throw notFound('Delivery');
  return row;
}

function checkCurrent(delivery: DeliveryRecord, version: number) {
  if (delivery.supersededAt !== null) {
    throw new HttpError(409, 'This delivery was replaced by a split. Reload to see the current deliveries.');
  }
  if (delivery.version !== version) throw stale();
}

export function addHistory(
  db: DB,
  entry: { poId: number; deliveryId: number | null; eventType: string; before: unknown; after: unknown; source: string | null; note: string | null },
  now: string,
) {
  db.prepare(
    `INSERT INTO change_history (po_id, delivery_id, event_type, before_json, after_json, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.poId,
    entry.deliveryId,
    entry.eventType,
    entry.before === null ? null : JSON.stringify(entry.before),
    entry.after === null ? null : JSON.stringify(entry.after),
    entry.source,
    entry.note,
    now,
  );
}

export function updateArrival(db: DB, deliveryId: number, input: UpdateArrivalInput): void {
  db.transaction(() => {
    const delivery = loadDelivery(db, deliveryId);
    checkCurrent(delivery, input.version);
    if (delivery.state === 'received') {
      throw new HttpError(422, 'Received deliveries are read-only.');
    }
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE deliveries SET expected_arrival = ?, source = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND version = ? AND superseded_at IS NULL`,
      )
      .run(input.expectedArrival, input.source, now, deliveryId, input.version);
    if (result.changes !== 1) throw stale();
    addHistory(
      db,
      {
        poId: delivery.poId,
        deliveryId,
        eventType: 'arrival_updated',
        before: { expectedArrival: delivery.expectedArrival, source: delivery.source },
        after: { expectedArrival: input.expectedArrival, source: input.source },
        source: input.source,
        note: input.note || null,
      },
      now,
    );
  })();
}

/** Splits one active planned delivery into dated parts under the same PO item. Returns the new ids. */
export function splitDelivery(db: DB, deliveryId: number, input: SplitInput): number[] {
  return db.transaction(() => {
    const delivery = loadDelivery(db, deliveryId);
    checkCurrent(delivery, input.version);
    if (delivery.state !== 'planned') {
      throw new HttpError(422, 'Only planned deliveries can be split. In-transit and received records cannot be split.');
    }
    validateSplit(delivery.quantity, input);

    const now = new Date().toISOString();
    // updated_at stays as the parent's last arrival-information update; it is kept only for history.
    const superseded = db
      .prepare(
        `UPDATE deliveries SET superseded_at = ?, version = version + 1
         WHERE id = ? AND version = ? AND superseded_at IS NULL`,
      )
      .run(now, deliveryId, input.version);
    if (superseded.changes !== 1) throw stale();

    const insertDelivery = db.prepare(
      `INSERT INTO deliveries (po_line_id, parent_delivery_id, quantity, state, expected_arrival, source, updated_at)
       VALUES (?, ?, ?, 'planned', ?, ?, ?)`,
    );
    const created = input.parts.map((part) => ({
      id: Number(
        insertDelivery.run(delivery.poLineId, deliveryId, part.quantity, part.expectedArrival, input.source, now).lastInsertRowid,
      ),
      quantity: part.quantity,
      expectedArrival: part.expectedArrival,
    }));

    addHistory(
      db,
      {
        poId: delivery.poId,
        deliveryId,
        eventType: 'delivery_split',
        before: { quantity: delivery.quantity, expectedArrival: delivery.expectedArrival },
        after: { deliveries: created },
        source: input.source,
        note: input.note || null,
      },
      now,
    );

    // Open delivery-level follow-ups move to the PO level, keeping a reference to the original delivery.
    const openFollowUps = db
      .prepare(`SELECT id, note FROM follow_ups WHERE delivery_id = ? AND state = 'open'`)
      .all(deliveryId) as { id: number; note: string }[];
    for (const followUp of openFollowUps) {
      db.prepare(
        `UPDATE follow_ups SET delivery_id = NULL, original_delivery_id = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
      ).run(deliveryId, now, followUp.id);
      addHistory(
        db,
        {
          poId: delivery.poId,
          deliveryId,
          eventType: 'follow_up_moved',
          before: { delivery: deliveryId },
          after: { delivery: null },
          source: null,
          note: followUp.note,
        },
        now,
      );
    }

    return created.map((c) => c.id);
  })();
}

/** Quantity rule for a split. Throws 422 with a field message; nothing is written on failure. */
export function validateSplit(originalQty: number, input: SplitInput) {
  const total = input.parts.reduce((s, p) => s + p.quantity, 0);
  if (total !== originalQty) {
    throw new HttpError(422, 'The split does not balance. Nothing was saved.', {
      parts: `Split quantities total ${total}; they must total the original ${originalQty}.`,
    });
  }
}
