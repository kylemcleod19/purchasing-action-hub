// "Delivery schedule & tracking" accordion table (PRD §6B). One row per delivery portion with its own
// shipment carrier and tracking number, never a combined list. Read-only: details and carrier events
// expand inline, and every edit goes through the item's Manage deliveries button.
import { Fragment, useState } from 'react';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { OUTCOME_LABELS } from '../../../shared/labels';
import type { CarrierEventView, DeliveryRow } from '../../../shared/types';
import { ArrivalDate, carrierStatusText, CarrierText, DateText, LastUpdate, ProductionStartDate, reasonList, riskRowClass, StateLabel, TrackingText } from './Labels';

const APPLIED_LABELS: Record<CarrierEventView['appliedState'], string> = {
  applied: 'Applied',
  partially_applied: 'Partly applied; some held for review',
  ignored: 'Ignored',
  held_for_review: 'Held for review',
};

const STATUS_LABELS: Record<string, string> = {
  picked_up: 'Picked up',
  eta_updated: 'ETA updated',
  in_transit: 'In transit',
  delayed: 'Delayed',
  delivered: 'Delivered',
};

export function DeliveryTrackingTable({ deliveries, carrierEvents }: { deliveries: DeliveryRow[]; carrierEvents: CarrierEventView[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <table className="compact deliveries-table">
      <caption>Delivery schedule &amp; tracking</caption>
      <thead>
        <tr>
          <th>
            <span className="visually-hidden">Details</span>
          </th>
          <th>Delivery</th>
          <th className="num">Quantity</th>
          <th>State</th>
          <th>Carrier</th>
          <th>Tracking number</th>
          <th>Expected / received arrival</th>
          <th>Last update</th>
        </tr>
      </thead>
      <tbody>
        {deliveries.map((d) => {
          const expanded = open.has(d.deliveryId);
          return (
            <Fragment key={d.deliveryId}>
              <tr data-delivery-id={d.deliveryId} className={[d.issue && 'has-issue', riskRowClass([d])].filter(Boolean).join(' ') || undefined}>
                <td>
                  <button
                    type="button"
                    className="expander"
                    aria-expanded={expanded}
                    aria-label={`Details for delivery #${d.deliveryId}`}
                    onClick={() => toggle(d.deliveryId)}
                  >
                    {expanded ? '▾' : '▸'}
                  </button>
                </td>
                <td>#{d.deliveryId}</td>
                <td className="num">{d.quantity}</td>
                <td className="nowrap">
                  <StateLabel state={d.state} />
                </td>
                <td className="nowrap">
                  <CarrierText row={d} />
                </td>
                <td className="nowrap">
                  <TrackingText row={d} />
                </td>
                <td>
                  <ArrivalDate row={d} showTransit />
                </td>
                <td>
                  <LastUpdate at={d.arrivalUpdatedAt} source={d.source} />
                </td>
              </tr>
              {expanded && (
                <tr className="detail-row">
                  <td></td>
                  <td colSpan={7}>
                    <DeliveryDetails delivery={d} events={d.shipment ? carrierEvents.filter((e) => e.shipmentId === d.shipment!.id) : []} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function DeliveryDetails({ delivery: d, events }: { delivery: DeliveryRow; events: CarrierEventView[] }) {
  const r = d.lastResolution;
  const s = d.shipment;
  return (
    <>
      <table className="compact detail-table">
        <tbody>
          <tr>
            <th scope="row">Required dock</th>
            <td>
              <DateText date={d.requiredDock} />
            </td>
            <th scope="row">Production start</th>
            <td>
              <ProductionStartDate row={d} />
            </td>
          </tr>
          <tr>
            <th scope="row">Issue</th>
            <td>{d.issue ? `Needs action: ${reasonList(d.issue.reasons)}` : r ? `Resolved: ${OUTCOME_LABELS[r.outcome]} · ${formatClock(r.resolvedAt)}` : '—'}</td>
            <th scope="row">Carrier status</th>
            <td>{carrierStatusText(d)}</td>
          </tr>
          {s && (
            <tr>
              <th scope="row">Shipment</th>
              <td>
                {s.number} · dispatched {formatClock(s.dispatchedAt)}
              </td>
              <th scope="row">Carrier delivered / warehouse received</th>
              <td>
                {s.carrierDeliveredAt ? formatClock(s.carrierDeliveredAt) : '—'} /{' '}
                {d.receivedAt ? formatDate(d.receivedAt) : s.carrierDeliveredAt ? 'Receipt pending' : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {events.length > 0 && (
        <table className="compact events-table">
          <caption>Carrier events (simulated)</caption>
          <thead>
            <tr>
              <th>Occurred</th>
              <th>Event</th>
              <th>ETA</th>
              <th>Result</th>
              <th>Event ID</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className={e.appliedState === 'applied' ? undefined : 'muted'}>
                <td className="nowrap">{formatClock(e.occurredAt)}</td>
                <td>{STATUS_LABELS[e.status] ?? e.status}</td>
                <td className="nowrap">{e.eta ? formatDate(e.eta) : '—'}</td>
                <td>
                  {APPLIED_LABELS[e.appliedState]}
                  {e.ignoredReason && <div className="hint">{e.ignoredReason}</div>}
                </td>
                <td className="nowrap hint">{e.externalEventId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
