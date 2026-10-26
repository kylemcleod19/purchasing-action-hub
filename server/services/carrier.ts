// Carrier event processing (PRD §13 Case B, ARCHITECTURE §14 "Carrier-processing contract"). An event
// finds its shipment by the fixture's carrier/tracking identity and updates only linked active
// deliveries, atomically. Duplicate event IDs are no-ops; older events are recorded as ignored; an
// equal-time conflicting event is held for review. A delivery whose latest arrival update is at least
// as new as the event (for example a buyer override) is not overwritten. Delivered records the carrier
// state only: it never marks warehouse receipt or resolves issues.
import type { DB } from '../db/db.js';
import { getDemoClock, getDemoDate, getMeta } from '../db/db.js';
import { HttpError, notFound } from '../errors.js';
import { formatClock, localDate } from '../../shared/clock.js';
import { CARRIER_FIXTURES, type CarrierPayload } from '../simulation/fixtures.js';
import { recordArrivalUpdate } from './deliveries.js';
import { addHistory } from './history.js';
import { loadDelivery } from './issues.js';
import { requireFixtures } from './replies.js';

export interface CarrierOutcome {
  duplicate: boolean;
  eventId: number;
  appliedState: 'applied' | 'partially_applied' | 'ignored' | 'held_for_review';
  updated: number;
  held: number;
}

interface ShipmentRecord {
  id: number;
  number: string;
  carrier: string | null;
  trackingNumber: string | null;
  latestEventAt: string | null;
}

export function processCarrierEvent(db: DB, fixtureKey: string): CarrierOutcome {
  const fixture = CARRIER_FIXTURES[fixtureKey];
  if (!fixture) throw notFound('Carrier event fixture');
  requireFixtures(db);
  return db.transaction((): CarrierOutcome => {
    const existing = db.prepare('SELECT id, applied_state AS s FROM carrier_events WHERE external_event_id = ?').get(fixture.externalEventId) as
      | { id: number; s: CarrierOutcome['appliedState'] }
      | undefined;
    if (existing) return { duplicate: true, eventId: existing.id, appliedState: existing.s, updated: 0, held: 0 };

    const shipment = db
      .prepare(
        `SELECT id, number, carrier, tracking_number AS trackingNumber, latest_event_at AS latestEventAt
         FROM shipments WHERE number = ?`,
      )
      .get(fixture.shipmentNumber) as ShipmentRecord | undefined;
    if (!shipment) throw notFound('Shipment');

    const anchor = getMeta(db, 'scenario_anchor') ?? getDemoDate(db);
    const occurredAt = fixture.occurredAt(anchor);
    const clock = getDemoClock(db);
    if (occurredAt > clock) throw new HttpError(409, `This event happens at ${formatClock(occurredAt)}. Advance the demo clock first.`);
    const payload = fixture.payload(anchor);
    const demoDate = localDate(clock);

    const insertEvent = (state: CarrierOutcome['appliedState'], reason: string | null) =>
      Number(
        db
          .prepare(
            `INSERT INTO carrier_events (shipment_id, external_event_id, occurred_at, received_at, payload_json, applied_state, ignored_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(shipment.id, fixture.externalEventId, occurredAt, clock, JSON.stringify(payload), state, reason).lastInsertRowid,
      );
    const linked = db
      .prepare(
        `SELECT sd.delivery_id AS id FROM shipment_deliveries sd JOIN deliveries d ON d.id = sd.delivery_id
         WHERE sd.shipment_id = ? AND d.superseded_at IS NULL ORDER BY d.id`,
      )
      .all(shipment.id)
      .map((r) => loadDelivery(db, (r as { id: number }).id));
    const label = `${shipment.carrier ?? 'Carrier'} ${shipment.trackingNumber ?? shipment.number}`;
    const poHistory = (eventType: string, eventId: number, note: string) => {
      for (const poId of [...new Set(linked.map((d) => d.poId))]) {
        addHistory(
          db,
          {
            poId,
            deliveryId: null,
            eventType,
            before: null,
            after: { shipment: shipment.number, status: payload.status, eta: payload.eta ?? null },
            actor: null,
            actorType: 'simulated_automation',
            source: 'carrier_update',
            sourceRef: `carrier_event:${eventId}`,
            note,
          },
          clock,
        );
      }
    };

    if (shipment.latestEventAt && occurredAt < shipment.latestEventAt) {
      const eventId = insertEvent('ignored', 'Older than the latest applied event; current estimates kept.');
      poHistory('carrier_event_ignored', eventId, `${label}: older event (${formatClock(occurredAt)}) ignored.`);
      return { duplicate: false, eventId, appliedState: 'ignored', updated: 0, held: 0 };
    }
    if (shipment.latestEventAt && occurredAt === shipment.latestEventAt) {
      const latest = db
        .prepare('SELECT payload_json AS p FROM carrier_events WHERE shipment_id = ? AND occurred_at = ? ORDER BY id DESC LIMIT 1')
        .get(shipment.id, occurredAt) as { p: string } | undefined;
      if (latest && latest.p !== JSON.stringify(payload)) {
        const eventId = insertEvent('held_for_review', 'Conflicts with another event at the same time; held for review.');
        poHistory('carrier_update_held', eventId, `${label}: conflicting event at the same time held for review.`);
        return { duplicate: false, eventId, appliedState: 'held_for_review', updated: 0, held: 0 };
      }
    }

    const eventId = insertEvent('applied', null);
    const sourceRef = `carrier_event:${eventId}`;
    const carriesEta = payload.eta !== undefined || payload.etaWithdrawn === true;
    db.prepare(
      `UPDATE shipments SET carrier_status = ?, latest_event_at = ?,
              expected_arrival = CASE WHEN ? THEN ? ELSE expected_arrival END,
              carrier_delivered_at = COALESCE(?, carrier_delivered_at), version = version + 1
       WHERE id = ?`,
    ).run(payload.status, occurredAt, carriesEta ? 1 : 0, payload.eta ?? null, payload.deliveredAt ?? null, shipment.id);

    let updated = 0;
    let held = 0;
    for (const delivery of linked) {
      if (delivery.state === 'received') continue;
      if (!carriesEta) {
        // Delivered (or a status-only event): no arrival-information change, no receipt, no resolution.
        if (payload.status === 'delivered') {
          addHistory(
            db,
            {
              poId: delivery.poId,
              deliveryId: delivery.id,
              eventType: 'carrier_delivered',
              before: null,
              after: { shipment: shipment.number, carrierDeliveredAt: payload.deliveredAt ?? occurredAt },
              actor: null,
              actorType: 'simulated_automation',
              source: 'carrier_update',
              sourceRef,
              note: `${label}: delivered by carrier; warehouse receipt pending.`,
            },
            occurredAt,
          );
        }
        continue;
      }
      const arrivalUpdatedAt = (db.prepare('SELECT arrival_updated_at AS t FROM deliveries WHERE id = ?').get(delivery.id) as { t: string | null }).t;
      if (arrivalUpdatedAt && arrivalUpdatedAt >= occurredAt) {
        held++;
        addHistory(
          db,
          {
            poId: delivery.poId,
            deliveryId: delivery.id,
            eventType: 'carrier_update_held',
            before: { expectedArrival: delivery.expectedArrival },
            after: { carrierEta: payload.eta ?? null },
            actor: null,
            actorType: 'simulated_automation',
            source: 'carrier_update',
            sourceRef,
            note: `${label}: a newer update (${formatClock(arrivalUpdatedAt)}) takes precedence. Review the carrier ETA before changing the date.`,
          },
          occurredAt,
        );
        continue;
      }
      recordArrivalUpdate(db, delivery, delivery.version, {
        expectedArrival: payload.etaWithdrawn ? null : (payload.eta ?? null),
        source: 'carrier_update',
        note: payload.etaWithdrawn ? `${label}: carrier withdrew the ETA.` : `${label}: ${payload.status === 'delayed' ? 'delay, ' : ''}ETA confirmed.`,
        demoDate,
        now: occurredAt,
        confirmation: false,
        actor: null,
        actorType: 'simulated_automation',
        sourceRef,
      });
      updated++;
    }

    const appliedState = held > 0 ? 'partially_applied' : 'applied';
    if (held > 0) {
      db.prepare('UPDATE carrier_events SET applied_state = ?, ignored_reason = ? WHERE id = ?').run(
        appliedState,
        `${held} ${held === 1 ? 'delivery' : 'deliveries'} held for review: a newer buyer or supplier update takes precedence.`,
        eventId,
      );
    }
    // Delivered is recorded per delivery above.
    if (payload.status !== 'delivered') poHistory('carrier_event_applied', eventId, `${label}: ${describe(payload)}`);
    return { duplicate: false, eventId, appliedState, updated, held };
  })();
}

function describe(p: CarrierPayload): string {
  if (p.status === 'delivered') return 'Delivered / receipt pending.';
  if (p.etaWithdrawn) return 'ETA withdrawn.';
  return p.eta ? `ETA ${p.eta}.` : 'Status update without an ETA.';
}
