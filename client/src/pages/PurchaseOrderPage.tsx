import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatDate } from '../../../shared/dates';
import { DELIVERY_STATE_LABELS, EVENT_LABELS, PROCESSING_TIME_NOTE, sourceLabel } from '../../../shared/labels';
import { DELIVERY_STATES, type DeliveryRow, type DeliveryState, type FollowUp, type HistoryEntry, type PurchaseOrderDetail } from '../../../shared/types';
import { ArrivalForm } from '../components/ArrivalForm';
import { CompleteFollowUpForm, FollowUpForm } from '../components/FollowUpForm';
import { ArrivalText, Flash, LastUpdate, ReasonBadge, StateLabel } from '../components/Labels';
import { Modal } from '../components/Modal';
import { SplitForm } from '../components/SplitForm';
import { deliveryLabel } from './IncomingPage';

type ModalState =
  | { kind: 'arrival' | 'split'; delivery: DeliveryRow }
  | { kind: 'addFollowUp'; deliveryId: number | null }
  | { kind: 'editFollowUp' | 'completeFollowUp'; followUp: FollowUp };

const ITEM_COLUMNS = 11;

export function PurchaseOrderPage() {
  const { id } = useParams();
  const { resetCount } = useDemo();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'follow-ups' ? 'follow-ups' : 'deliveries';
  const stateParam = searchParams.get('state');
  const stateFilter = DELIVERY_STATES.includes(stateParam as DeliveryState) ? (stateParam as DeliveryState) : null;
  const [data, setData] = useState<PurchaseOrderDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number> | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api<PurchaseOrderDetail>(`/purchase-orders/${id}`);
      setData(detail);
      // Small POs open with every item expanded; larger ones start collapsed. Later saves keep the user's choice.
      setExpanded((prev) => prev ?? new Set(detail.lines.length <= 2 ? detail.lines.map((l) => l.id) : []));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiRequestError ? { status: err.status, message: err.message } : { status: 0, message: 'Could not load the PO.' },
      );
    }
  }, [id]);

  useEffect(() => {
    setExpanded(null);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, resetCount]);

  function saved(text: string) {
    setModal(null);
    setFlash({ kind: 'success', text });
    load();
  }

  const setParam = (key: string, value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const toggleItem = (lineId: number) =>
    setExpanded((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });

  if (loadError) {
    return (
      <section>
        <p className="flash flash-error" role="alert">
          {loadError.status === 404 ? 'Purchase order not found.' : loadError.message}{' '}
          {loadError.status !== 404 && (
            <button type="button" className="link-button" onClick={load}>
              Retry
            </button>
          )}
        </p>
        <Link to="/">Back to Incoming items</Link>
      </section>
    );
  }
  if (!data) return <p className="empty">Loading purchase order…</p>;

  const { po, lines, followUps, history, demoDate } = data;
  const allDeliveries = lines.flatMap((l) => l.deliveries);
  const openFollowUps = followUps.filter((f) => f.state === 'open');
  const dueFollowUps = openFollowUps.filter((f) => f.isDue);
  const visibleLines = lines
    .map((line) => ({ line, deliveries: line.deliveries.filter((d) => !stateFilter || d.state === stateFilter) }))
    .filter(({ deliveries }) => !stateFilter || deliveries.length > 0);

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/">← Incoming items</Link>
      </p>
      <div className="po-header">
        <div>
          <h1>{po.number}</h1>
          <dl className="context inline-context">
            <div>
              <dt>Supplier</dt>
              <dd>{po.supplierName}</dd>
            </div>
            <div>
              <dt>Buyer</dt>
              <dd>{po.buyer}</dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd>{po.warehouseName}</dd>
            </div>
            <div>
              <dt>Order status</dt>
              <dd>{po.status}</dd>
            </div>
          </dl>
        </div>
        <dl className="work-order-callout" aria-label="Work order">
          <div>
            <dt>Work order</dt>
            <dd>
              {po.workOrderNumber} <span className="hint">{po.program}</span>
            </dd>
          </div>
          <div>
            <dt>Production start</dt>
            <dd className="production-start">{formatDate(po.productionStart)}</dd>
          </div>
        </dl>
      </div>
      <Flash message={flash} onDismiss={() => setFlash(null)} />

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'deliveries'}
          className={tab === 'deliveries' ? 'active' : ''}
          onClick={() => setParam('tab', null)}
        >
          Deliveries
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'follow-ups'}
          className={tab === 'follow-ups' ? 'active' : ''}
          onClick={() => setParam('tab', 'follow-ups')}
        >
          Follow-ups <span className="count">{openFollowUps.length} open</span>
          {dueFollowUps.length > 0 && <span className="count due">{dueFollowUps.length} due</span>}
        </button>
      </div>

      {tab === 'deliveries' && (
        <>
          <div className="toolbar">
            <div className="segmented" role="group" aria-label="Delivery state">
              <button type="button" className={stateFilter === null ? 'active' : ''} aria-pressed={stateFilter === null} onClick={() => setParam('state', null)}>
                All
              </button>
              {DELIVERY_STATES.map((s) => (
                <button key={s} type="button" className={stateFilter === s ? 'active' : ''} aria-pressed={stateFilter === s} onClick={() => setParam('state', s)}>
                  {DELIVERY_STATE_LABELS[s]}
                </button>
              ))}
            </div>
            <span className="hint">
              Follow-ups: {openFollowUps.length} open
              {dueFollowUps.length > 0 && <span className="due-text"> · {dueFollowUps.length} due</span>}
            </span>
          </div>

          {visibleLines.length === 0 ? (
            <p className="empty">No {stateFilter ? DELIVERY_STATE_LABELS[stateFilter].toLowerCase() : ''} deliveries on this PO.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table items-table">
                <thead>
                  <tr>
                    <th colSpan={5}></th>
                    <th colSpan={6} scope="colgroup" className="group-header">
                      Item totals (all states)
                    </th>
                  </tr>
                  <tr>
                    <th>
                      <span className="visually-hidden">Expand</span>
                    </th>
                    <th className="num">Line</th>
                    <th>Part number</th>
                    <th>Description</th>
                    <th>Unit</th>
                    <th className="num">Ordered</th>
                    <th className="num">Planned</th>
                    <th className="num">In transit</th>
                    <th className="num">Received</th>
                    <th className="num">Late</th>
                    <th className="num">Date unknown</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map(({ line, deliveries }) => {
                    const open = expanded?.has(line.id) ?? false;
                    return (
                      <Fragment key={line.id}>
                        <tr className={open ? 'expanded' : undefined}>
                          <td>
                            <button
                              type="button"
                              className="expander"
                              aria-expanded={open}
                              aria-controls={`item-${line.id}-deliveries`}
                              aria-label={`Deliveries for line ${line.lineNo} ${line.partNumber}`}
                              onClick={() => toggleItem(line.id)}
                            >
                              {open ? '▾' : '▸'}
                            </button>
                          </td>
                          <td className="num">{line.lineNo}</td>
                          <td className="nowrap">{line.partNumber}</td>
                          <td>{line.description}</td>
                          <td>{line.unit}</td>
                          <td className="num">{line.orderedQty}</td>
                          <td className="num">{line.plannedQty}</td>
                          <td className="num">{line.inTransitQty}</td>
                          <td className="num">{line.receivedQty}</td>
                          <td className={`num${line.lateQty > 0 ? ' late-text' : ''}`}>{line.lateQty}</td>
                          <td className={`num${line.unknownQty > 0 ? ' status-unknown' : ''}`}>{line.unknownQty}</td>
                        </tr>
                        {open && (
                          <tr className="detail-row" id={`item-${line.id}-deliveries`}>
                            <td colSpan={ITEM_COLUMNS}>
                              <DeliveriesTable
                                deliveries={deliveries}
                                followUps={openFollowUps}
                                onArrival={(d) => setModal({ kind: 'arrival', delivery: d })}
                                onSplit={(d) => setModal({ kind: 'split', delivery: d })}
                                onFollowUp={(d) => setModal({ kind: 'addFollowUp', deliveryId: d.deliveryId })}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint footnote">{PROCESSING_TIME_NOTE}</p>
          <HistoryList history={history} />
        </>
      )}

      {tab === 'follow-ups' && (
        <FollowUpsTab
          followUps={followUps}
          onAdd={() => setModal({ kind: 'addFollowUp', deliveryId: null })}
          onEdit={(f) => setModal({ kind: 'editFollowUp', followUp: f })}
          onComplete={(f) => setModal({ kind: 'completeFollowUp', followUp: f })}
        />
      )}

      {modal?.kind === 'arrival' && (
        <Modal title="Update expected arrival" onClose={() => setModal(null)}>
          <ArrivalForm delivery={modal.delivery} onCancel={() => setModal(null)} onSaved={() => saved('Expected arrival saved.')} />
        </Modal>
      )}
      {modal?.kind === 'split' && (
        <Modal title="Split planned delivery" onClose={() => setModal(null)} wide>
          <SplitForm
            delivery={modal.delivery}
            onCancel={() => setModal(null)}
            onSaved={() => saved('Split saved. The original delivery is kept in history.')}
          />
        </Modal>
      )}
      {(modal?.kind === 'addFollowUp' || modal?.kind === 'editFollowUp') && (
        <Modal title={modal.kind === 'addFollowUp' ? 'Add follow-up' : 'Edit follow-up'} onClose={() => setModal(null)}>
          <FollowUpForm
            poId={po.id}
            poNumber={po.number}
            deliveries={allDeliveries.map((d) => ({ id: d.deliveryId, label: deliveryLabel(d) }))}
            defaultDeliveryId={modal.kind === 'addFollowUp' ? modal.deliveryId : null}
            defaultDueDate={demoDate}
            existing={modal.kind === 'editFollowUp' ? modal.followUp : undefined}
            onCancel={() => setModal(null)}
            onSaved={() => saved(modal.kind === 'addFollowUp' ? 'Follow-up added.' : 'Follow-up saved.')}
          />
        </Modal>
      )}
      {modal?.kind === 'completeFollowUp' && (
        <Modal title="Complete follow-up" onClose={() => setModal(null)}>
          <CompleteFollowUpForm followUp={modal.followUp} onCancel={() => setModal(null)} onSaved={() => saved('Follow-up completed.')} />
        </Modal>
      )}
    </section>
  );
}

function DeliveriesTable({
  deliveries,
  followUps,
  onArrival,
  onSplit,
  onFollowUp,
}: {
  deliveries: DeliveryRow[];
  followUps: FollowUp[];
  onArrival: (d: DeliveryRow) => void;
  onSplit: (d: DeliveryRow) => void;
  onFollowUp: (d: DeliveryRow) => void;
}) {
  return (
    <table className="compact deliveries-table">
      <thead>
        <tr>
          <th>Delivery</th>
          <th className="num">Qty</th>
          <th>Delivery state</th>
          <th className="date-col">Expected arrival</th>
          <th className="date-col">Production start</th>
          <th>Attention</th>
          <th>Last update</th>
          <th>Follow-ups</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {deliveries.map((d) => {
          const own = followUps.filter((f) => f.deliveryId === d.deliveryId);
          const due = own.some((f) => f.isDue);
          return (
            <tr key={d.deliveryId} data-delivery-id={d.deliveryId}>
              <td>#{d.deliveryId}</td>
              <td className="num">{d.quantity}</td>
              <td>
                <StateLabel state={d.state} />
              </td>
              <td className="date-col">
                <ArrivalText row={d} />
              </td>
              <td className="date-col nowrap">{formatDate(d.productionStart)}</td>
              <td>
                {d.reasons.map((r) => (
                  <ReasonBadge key={r} reason={r} />
                ))}
              </td>
              <td>
                <LastUpdate updatedAt={d.updatedAt} source={d.source} />
              </td>
              <td className="nowrap">{own.length > 0 ? <span className={due ? 'due-text' : undefined}>{own.length} open{due ? ' · due' : ''}</span> : '—'}</td>
              <td className="actions">
                {d.state === 'received' ? (
                  <span className="hint">Read-only</span>
                ) : (
                  <>
                    <button type="button" onClick={() => onArrival(d)}>
                      Update arrival
                    </button>
                    {d.state === 'planned' && (
                      <button type="button" onClick={() => onSplit(d)}>
                        Split
                      </button>
                    )}
                  </>
                )}
                <button type="button" onClick={() => onFollowUp(d)}>
                  Add follow-up
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FollowUpsTab({
  followUps,
  onAdd,
  onEdit,
  onComplete,
}: {
  followUps: FollowUp[];
  onAdd: () => void;
  onEdit: (f: FollowUp) => void;
  onComplete: (f: FollowUp) => void;
}) {
  return (
    <div>
      <div className="toolbar">
        <button type="button" className="primary" onClick={onAdd}>
          Add follow-up
        </button>
        <span className="hint">Follow-ups are reminders for you. Nothing is sent to the supplier.</span>
      </div>
      {followUps.length === 0 ? (
        <p className="empty">No follow-ups on this PO.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Follow-up</th>
                <th>Delivery</th>
                <th>State</th>
                <th>Completion note</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {followUps.map((f) => (
                <tr key={f.id} className={f.state === 'completed' ? 'muted' : undefined}>
                  <td className="nowrap">
                    {formatDate(f.dueDate)}
                    {f.isDue && <span className="badge reason-follow_up_due">Due</span>}
                  </td>
                  <td>{f.note}</td>
                  <td className="nowrap">
                    {f.deliveryId !== null ? `#${f.deliveryId}` : 'Whole PO'}
                    {f.originalDeliveryId !== null && <div className="hint">Originally #{f.originalDeliveryId} (split)</div>}
                  </td>
                  <td className="nowrap">{f.state === 'open' ? 'Open' : `Completed ${new Date(f.completedAt!).toLocaleDateString()}`}</td>
                  <td>{f.completionNote ?? '—'}</td>
                  <td className="actions">
                    {f.state === 'open' && (
                      <>
                        <button type="button" onClick={() => onEdit(f)}>
                          Edit
                        </button>
                        <button type="button" onClick={() => onComplete(f)}>
                          Complete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const dateText = (value: unknown) => (typeof value === 'string' ? formatDate(value) : 'Date unknown');

function describeChange(entry: HistoryEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.eventType) {
    case 'arrival_updated':
      return `Expected arrival ${dateText(before.expectedArrival)} → ${dateText(after.expectedArrival)}`;
    case 'delivery_split': {
      const parts = (after.deliveries as { id: number; quantity: number; expectedArrival: string | null }[]) ?? [];
      return `${before.quantity} (${dateText(before.expectedArrival)}) → ${parts
        .map((p) => `#${p.id}: ${p.quantity} (${dateText(p.expectedArrival)})`)
        .join(' + ')}`;
    }
    case 'follow_up_added':
      return `Due ${dateText(after.dueDate)}`;
    case 'follow_up_edited':
      return `Due ${dateText(before.dueDate)} → ${dateText(after.dueDate)}`;
    case 'follow_up_completed':
      return 'Open → Completed';
    case 'follow_up_moved':
      return `Delivery #${before.delivery} → Whole PO`;
    default:
      return '';
  }
}

function HistoryList({ history }: { history: HistoryEntry[] }) {
  return (
    <div className="history">
      <h2>Change history</h2>
      {history.length === 0 ? (
        <p className="empty">No changes recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="compact">
            <thead>
              <tr>
                <th>When (your time)</th>
                <th>Event</th>
                <th>Delivery</th>
                <th>Change</th>
                <th>Source</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{EVENT_LABELS[h.eventType] ?? h.eventType}</td>
                  <td>{h.deliveryId !== null ? `#${h.deliveryId}` : 'PO'}</td>
                  <td>{describeChange(h)}</td>
                  <td>{sourceLabel(h.source)}</td>
                  <td>{h.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
