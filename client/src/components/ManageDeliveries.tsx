// One Manage deliveries entry point for both pages (PRD §6 "Shared Manage deliveries modal"). The
// button reflects open issues in its scope; the modal loads every delivery of the item (even ones a
// page filter hides) and reuses the existing validated update, split, and resolve endpoints.
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { prioritizeArrivals } from '../../../shared/arrivals';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { OUTCOME_LABELS, sourceLabel } from '../../../shared/labels';
import type { DeliveryRow, PurchaseOrderDetail } from '../../../shared/types';
import { AcceptForm, ArrivalForm, SplitForm, type SaveResult } from './DeliveryForms';
import { Icon } from './Icons';
import { ArrivalDate, carrierStatusText, CarrierText, DateText, LastUpdate, ProductionStartDate, reasonLabel, StateLabel, TrackingText } from './Labels';
import { Modal } from './Modal';

/**
 * Blue with one flag when the scope has open issues ("Needs action"), white outline otherwise. The
 * count shows only for several open issues. Color is never the only signal: the accessible name says
 * Needs action. This is action priority, not an error or a timeliness guarantee.
 */
export function ManageDeliveriesButton({
  openIssueCount,
  readOnly,
  onClick,
  focusKey,
}: {
  openIssueCount: number;
  readOnly: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  focusKey: string;
}) {
  const label = readOnly ? 'View deliveries' : 'Manage deliveries';
  const needs = openIssueCount > 0;
  const name = needs ? `${label}, Needs action${openIssueCount > 1 ? ` (${openIssueCount} open issues)` : ''}` : label;
  return (
    <button
      type="button"
      className={`manage-button small${needs ? ' needs-action' : ''}`}
      aria-label={name}
      title={name}
      data-focus-key={focusKey}
      onClick={onClick}
    >
      {needs && (
        <svg className="icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M3.5 14V2 M3.5 2.5h8l-2 3 2 3h-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
      <span>{label}</span>
      {openIssueCount > 1 && <span className="manage-count">{openIssueCount}</span>}
    </button>
  );
}

type Mode = 'update' | 'accept' | 'split' | 'view';

const MODE_LABELS: Record<Exclude<Mode, 'view'>, string> = {
  update: 'Update arrival',
  accept: 'Accept current estimate',
  split: 'Split delivery',
};

/** Item entry: first open issue in displayed order, else first outstanding, else the first delivery. */
export function initialSelection(deliveries: DeliveryRow[], initialDeliveryId?: number): number | null {
  if (initialDeliveryId && deliveries.some((d) => d.deliveryId === initialDeliveryId)) return initialDeliveryId;
  const ordered = prioritizeArrivals(deliveries);
  return (ordered.find((d) => d.issue) ?? ordered.find((d) => d.state !== 'received') ?? ordered[0])?.deliveryId ?? null;
}

const modesFor = (d: DeliveryRow): Mode[] => {
  if (d.state === 'received') return ['view'];
  return ['update', ...(d.issue ? (['accept'] as const) : []), ...(d.state === 'planned' ? (['split'] as const) : [])];
};

export function ManageDeliveriesModal({
  poId,
  poLineId,
  initialDeliveryId,
  onClose,
  onSaved,
}: {
  poId: number;
  poLineId: number;
  /** Incoming rows pass their exact delivery; the PO item button passes none. */
  initialDeliveryId?: number;
  onClose: () => void;
  onSaved: (r: SaveResult) => void;
}) {
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('update');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<PurchaseOrderDetail>(`/purchase-orders/${poId}`).then(
      (d) => {
        if (cancelled) return;
        setDetail(d);
        const line = d.lines.find((l) => l.id === poLineId);
        const id = line ? initialSelection(line.deliveries, initialDeliveryId) : null;
        setSelectedId(id);
        const selected = line?.deliveries.find((x) => x.deliveryId === id);
        setMode(selected ? modesFor(selected)[0] : 'view');
      },
      (err) => !cancelled && setLoadError(err instanceof ApiRequestError ? err.message : 'Could not load deliveries.'),
    );
    return () => {
      cancelled = true;
    };
  }, [poId, poLineId, initialDeliveryId]);

  const confirmDiscard = useCallback(() => !dirty || window.confirm('Discard your unsaved changes?'), [dirty]);
  const line = detail?.lines.find((l) => l.id === poLineId);
  const deliveries = line ? prioritizeArrivals(line.deliveries) : [];
  const selected = deliveries.find((d) => d.deliveryId === selectedId) ?? null;
  const readOnlyItem = deliveries.length > 0 && deliveries.every((d) => d.state === 'received');

  function select(d: DeliveryRow) {
    if (d.deliveryId === selectedId || !confirmDiscard()) return;
    setDirty(false);
    setSelectedId(d.deliveryId);
    setMode(modesFor(d)[0]);
  }

  function switchMode(next: Mode) {
    if (next === mode || !confirmDiscard()) return;
    setDirty(false);
    setMode(next);
  }

  // Cancel and close discard unsaved input; opening, selecting, and closing never save anything.
  const close = () => onClose();

  return (
    <Modal title={readOnlyItem ? 'View deliveries' : 'Manage deliveries'} onClose={close} wide>
      {loadError && (
        <div className="form-error" role="alert">
          {loadError}
        </div>
      )}
      {!detail && !loadError && <p className="empty">Loading deliveries…</p>}
      {detail && !line && <p className="empty">This item is no longer on the PO.</p>}
      {detail && line && (
        <>
          <table className="compact context-table">
            <tbody>
              <tr>
                <th scope="row">Part</th>
                <td>
                  {line.partNumber} — {line.description}
                </td>
                <th scope="row">PO</th>
                <td>
                  {detail.po.number} · line {line.lineNo} · {detail.po.supplierName}
                </td>
              </tr>
              <tr>
                <th scope="row">Required dock</th>
                <td>
                  <DateText date={line.requiredDock} />
                </td>
                <th scope="row">Production start</th>
                <td>
                  <span className="date-cell">{formatDate(detail.po.productionStart)}</span> · {detail.po.workOrderNumber} · {detail.po.program}
                </td>
              </tr>
              <tr>
                <th scope="row">Destination</th>
                <td>{detail.po.warehouseName}</td>
                <th scope="row">Quantities</th>
                <td>
                  Ordered {line.orderedQty} · Shipped {line.shippedQty} · Received {line.receivedQty}
                </td>
              </tr>
            </tbody>
          </table>

          {deliveries.length > 1 && (
            <table className="compact delivery-select-table">
              <caption className="visually-hidden">Deliveries for this item</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Select</span>
                  </th>
                  <th scope="col">Delivery</th>
                  <th scope="col" className="num">
                    Quantity
                  </th>
                  <th scope="col">State</th>
                  <th scope="col">Expected / received arrival</th>
                  <th scope="col">Tracking number</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.deliveryId} className={d.deliveryId === selectedId ? 'selected' : undefined} data-delivery-id={d.deliveryId}>
                    <td>
                      <input
                        type="radio"
                        name="selected-delivery"
                        aria-label={`Select delivery #${d.deliveryId}`}
                        checked={d.deliveryId === selectedId}
                        onChange={() => select(d)}
                      />
                    </td>
                    <td>#{d.deliveryId}</td>
                    <td className="num">{d.quantity}</td>
                    <td className="nowrap">
                      <StateLabel state={d.state} />
                    </td>
                    <td>
                      <ArrivalDate row={d} />
                    </td>
                    <td>
                      <TrackingText row={d} />
                    </td>
                    <td className="nowrap">{d.issue ? <span className="needs-action-text">Needs action</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selected && (
            <>
              <h3 className="selected-heading">
                Delivery #{selected.deliveryId} · {selected.quantity} {selected.unit} · <StateLabel state={selected.state} />
              </h3>
              <table className="compact context-table selected-delivery">
                <tbody>
                  <tr>
                    <th scope="row">Expected arrival</th>
                    <td>
                      <ArrivalDate row={selected} />
                    </td>
                    <th scope="row">Production start</th>
                    <td>
                      <ProductionStartDate row={selected} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Carrier</th>
                    <td>
                      <CarrierText row={selected} />
                      {selected.shipment && <span className="hint"> · {carrierStatusText(selected)}</span>}
                    </td>
                    <th scope="row">Tracking number</th>
                    <td>
                      <TrackingText row={selected} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Last update</th>
                    <td colSpan={3}>
                      <LastUpdate at={selected.arrivalUpdatedAt} source={selected.source} /> {sourceLabel(selected.source)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <IssueSection delivery={selected} />

              {mode === 'view' ? (
                <>
                  <p className="hint">Received deliveries are read-only. Receipt facts come from upstream systems.</p>
                  <div className="form-actions">
                    <button type="button" className="primary" onClick={close}>
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="segmented mode-switch" role="group" aria-label="Action">
                    {modesFor(selected).map((m) => (
                      <button key={m} type="button" className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => switchMode(m)}>
                        {m === 'accept' && selected.expectedArrival === null ? 'Reviewed / no further action' : MODE_LABELS[m as Exclude<Mode, 'view'>]}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    // Keyed by delivery and mode so a switch starts a fresh form.
                    const key = `${selected.deliveryId}-${mode}`;
                    const props = { delivery: selected, onCancel: close, onSaved, onDirtyChange: setDirty };
                    if (mode === 'split') return <SplitForm key={key} {...props} />;
                    if (mode === 'accept') return <AcceptForm key={key} {...props} />;
                    return <ArrivalForm key={key} {...props} />;
                  })()}
                </>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/** Issue reasons as a short labeled section, not an icon cluster in the page tables. */
function IssueSection({ delivery }: { delivery: DeliveryRow }) {
  const r = delivery.lastResolution;
  return (
    <section className="issue-section" aria-label="Issue">
      <h4>Issue</h4>
      {delivery.issue ? (
        <>
          <p className="issue-open">
            <Icon name="flag" label="Open issue" /> Needs action · opened {formatClock(delivery.issue.openedAt)}
          </p>
          <ul className="issue-reasons-list">
            {delivery.issue.reasons.map((reason) => (
              <li key={reason}>{reasonLabel(reason, delivery)}</li>
            ))}
          </ul>
        </>
      ) : r ? (
        <p>
          Resolved: {OUTCOME_LABELS[r.outcome]} · {r.resolvedBy} (demo) · {formatClock(r.resolvedAt)}
          {r.note ? ` · ${r.note}` : ''}
        </p>
      ) : (
        <p className="muted-text">No issue.</p>
      )}
    </section>
  );
}
