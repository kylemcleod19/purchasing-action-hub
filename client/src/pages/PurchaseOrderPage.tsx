import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatDate } from '../../../shared/dates';
import { EVENT_LABELS, PROCESSING_TIME_NOTE, sourceLabel } from '../../../shared/labels';
import type { DeliveryRow, FollowUp, HistoryEntry, PurchaseOrderDetail } from '../../../shared/types';
import { ArrivalForm } from '../components/ArrivalForm';
import { CompleteFollowUpForm, FollowUpForm } from '../components/FollowUpForm';
import { Flash, LinkStatusLabel, ReasonBadge, StateLabel } from '../components/Labels';
import { Modal } from '../components/Modal';
import { SplitForm } from '../components/SplitForm';
import { deliveryLabel, WorkOrderTable } from './IncomingPage';

type ModalState =
  | { kind: 'arrival' | 'split'; delivery: DeliveryRow }
  | { kind: 'addFollowUp'; deliveryId: number | null }
  | { kind: 'editFollowUp' | 'completeFollowUp'; followUp: FollowUp };

export function PurchaseOrderPage() {
  const { id } = useParams();
  const { resetCount } = useDemo();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'follow-ups' ? 'follow-ups' : 'deliveries';
  const [data, setData] = useState<PurchaseOrderDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<ModalState | null>(null);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<PurchaseOrderDetail>(`/purchase-orders/${id}`));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiRequestError ? { status: err.status, message: err.message } : { status: 0, message: 'Could not load the PO.' },
      );
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, resetCount]);

  function saved(text: string) {
    setModal(null);
    setFlash({ kind: 'success', text });
    load();
  }

  const setTab = (next: string) => setSearchParams(next === 'deliveries' ? {} : { tab: next }, { replace: true });

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
  const deliveryOptions = allDeliveries.map((d) => ({ id: d.deliveryId, label: `#${d.deliveryId} · ${deliveryLabel(d)}` }));

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/">← Incoming items</Link>
      </p>
      <div className="po-header">
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
      <Flash message={flash} onDismiss={() => setFlash(null)} />

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'deliveries'} className={tab === 'deliveries' ? 'active' : ''} onClick={() => setTab('deliveries')}>
          Deliveries
        </button>
        <button type="button" role="tab" aria-selected={tab === 'follow-ups'} className={tab === 'follow-ups' ? 'active' : ''} onClick={() => setTab('follow-ups')}>
          Follow-ups <span className="count">{openFollowUps.length} open</span>
          {dueFollowUps.length > 0 && <span className="count due">{dueFollowUps.length} due</span>}
        </button>
      </div>

      {tab === 'deliveries' && (
        <>
          <p className="hint">
            Follow-ups: {openFollowUps.length} open
            {dueFollowUps.length > 0 && <span className="due-text"> · {dueFollowUps.length} due</span>}
            {' · '}
            <button type="button" className="link-button" onClick={() => setTab('follow-ups')}>
              View follow-ups
            </button>
          </p>
          {lines.map((line) => (
            <div key={line.id} className="po-line">
              <h2>
                Line {line.lineNo} · {line.partNumber} <span className="hint">{line.description}</span>
              </h2>
              <p className="qty-breakdown">
                Ordered <strong>{line.orderedQty}</strong> {line.unit} = Planned {line.plannedQty} + In transit {line.inTransitQty} + Received{' '}
                {line.receivedQty}
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th aria-label="Expand"></th>
                      <th>Delivery</th>
                      <th className="num">Qty</th>
                      <th>Delivery state</th>
                      <th>Expected arrival</th>
                      <th>Source</th>
                      <th>Work orders</th>
                      <th>Attention</th>
                      <th>Follow-ups</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line.deliveries.map((d) => {
                      const open = expanded.has(d.deliveryId);
                      const late = d.affected.filter((a) => a.status === 'late');
                      const unknown = d.affected.filter((a) => a.status === 'unknown');
                      const ownFollowUps = openFollowUps.filter((f) => f.deliveryId === d.deliveryId);
                      return (
                        <Fragment key={d.deliveryId}>
                          <tr>
                            <td>
                              <button
                                type="button"
                                className="expander"
                                aria-expanded={open}
                                aria-label={`Work orders for delivery ${d.deliveryId}`}
                                onClick={() =>
                                  setExpanded((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(d.deliveryId)) next.delete(d.deliveryId);
                                    else next.add(d.deliveryId);
                                    return next;
                                  })
                                }
                              >
                                {open ? '▾' : '▸'}
                              </button>
                            </td>
                            <td>#{d.deliveryId}</td>
                            <td className="num">{d.quantity}</td>
                            <td>
                              <StateLabel state={d.state} />
                            </td>
                            <td className="nowrap">
                              {d.state === 'received'
                                ? `Received ${formatDate(d.receivedDate)}`
                                : d.expectedArrival
                                  ? formatDate(d.expectedArrival)
                                  : 'Date unknown'}
                            </td>
                            <td>{sourceLabel(d.source)}</td>
                            <td className="nowrap">
                              {d.affected.length} WO{d.affected.length === 1 ? '' : 's'}
                              {late.length > 0 && (
                                <span className="late-text"> · late {late.reduce((s, a) => s + a.quantity, 0)}</span>
                              )}
                              {unknown.length > 0 && <span> · unknown {unknown.reduce((s, a) => s + a.quantity, 0)}</span>}
                            </td>
                            <td>
                              {d.reasons.map((r) => (
                                <ReasonBadge key={r} reason={r} />
                              ))}
                            </td>
                            <td className="nowrap">
                              {ownFollowUps.length > 0 ? (
                                <span className={ownFollowUps.some((f) => f.isDue) ? 'due-text' : undefined}>
                                  {ownFollowUps.length} open{ownFollowUps.some((f) => f.isDue) ? ' · due' : ''}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="actions">
                              {d.state === 'received' ? (
                                <span className="hint">Read-only</span>
                              ) : (
                                <>
                                  <button type="button" onClick={() => setModal({ kind: 'arrival', delivery: d })}>
                                    Update arrival
                                  </button>
                                  {d.state === 'planned' ? (
                                    <button type="button" onClick={() => setModal({ kind: 'split', delivery: d })}>
                                      Split
                                    </button>
                                  ) : (
                                    <span className="hint" title="Only planned deliveries can be split.">
                                      No split
                                    </span>
                                  )}
                                </>
                              )}
                              <button type="button" onClick={() => setModal({ kind: 'addFollowUp', deliveryId: d.deliveryId })}>
                                Add follow-up
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr className="detail-row">
                              <td></td>
                              <td colSpan={9}>
                                {d.affected.length > 0 ? <WorkOrderTable row={d} /> : <p className="hint">No linked work orders.</p>}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
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
          <SplitForm delivery={modal.delivery} onCancel={() => setModal(null)} onSaved={() => saved('Split saved. The original delivery is kept in history.')} />
        </Modal>
      )}
      {(modal?.kind === 'addFollowUp' || modal?.kind === 'editFollowUp') && (
        <Modal title={modal.kind === 'addFollowUp' ? 'Add follow-up' : 'Edit follow-up'} onClose={() => setModal(null)}>
          <FollowUpForm
            poId={po.id}
            poNumber={po.number}
            deliveries={deliveryOptions}
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
                  <td>{f.state === 'open' ? 'Open' : `Completed ${new Date(f.completedAt!).toLocaleDateString()}`}</td>
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

const arrivalText = (value: unknown) => (typeof value === 'string' ? formatDate(value) : 'Date unknown');

function describeChange(entry: HistoryEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.eventType) {
    case 'arrival_updated':
      return `Expected arrival ${arrivalText(before.expectedArrival)} → ${arrivalText(after.expectedArrival)}`;
    case 'delivery_split': {
      const parts = (after.deliveries as { id: number; quantity: number; expectedArrival: string | null }[]) ?? [];
      return `${before.quantity} (${arrivalText(before.expectedArrival)}) → ${parts
        .map((p) => `#${p.id}: ${p.quantity} (${arrivalText(p.expectedArrival)})`)
        .join(' + ')}`;
    }
    case 'follow_up_added':
      return `Due ${arrivalText(after.dueDate)}`;
    case 'follow_up_edited':
      return `Due ${arrivalText(before.dueDate)} → ${arrivalText(after.dueDate)}`;
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
      )}
    </div>
  );
}
