import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { arrivalDate, itemRank, prioritizeArrivals } from '../../../shared/arrivals';
import { formatDate } from '../../../shared/dates';
import { DATE_RULES_NOTE, DELIVERY_STATE_LABELS, EVENT_LABELS, REASON_LABELS, sourceLabel } from '../../../shared/labels';
import {
  DELIVERY_STATES,
  type DeliveryRow,
  type DeliveryState,
  type FollowUp,
  type HistoryEntry,
  type IssueReason,
  type PoLineDetail,
  type PurchaseOrderDetail,
} from '../../../shared/types';
import { ArrivalForm, ResolveForm, SplitForm, type SaveResult } from '../components/DeliveryForms';
import { CompleteFollowUpForm, FollowUpForm } from '../components/FollowUpForm';
import { Icon } from '../components/Icons';
import { ArrivalDate, DateText, Flash, IssueStatus, LastUpdate, ProductionStartDate, riskRowClass, StateLabel } from '../components/Labels';
import { Modal } from '../components/Modal';
import { deliveryLabel, RowActions } from './IncomingPage';

type IssueFilter = 'all' | 'open' | 'resolved';
const ISSUE_FILTERS: { key: IssueFilter; label: string }[] = [
  { key: 'all', label: 'All issues' },
  { key: 'open', label: 'Needs action' },
  { key: 'resolved', label: 'Resolved issues' },
];

type ModalState =
  | { kind: 'arrival' | 'split' | 'resolve'; delivery: DeliveryRow }
  | { kind: 'addFollowUp'; deliveryId: number | null }
  | { kind: 'editFollowUp' | 'completeFollowUp'; followUp: FollowUp };

const ITEM_COLUMNS = 11;
const MAX_ARRIVALS = 2;

export function PurchaseOrderPage() {
  const { id } = useParams();
  const { resetCount } = useDemo();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'follow-ups' ? 'follow-ups' : 'deliveries';
  const stateParam = searchParams.get('state');
  const stateFilter = DELIVERY_STATES.includes(stateParam as DeliveryState) ? (stateParam as DeliveryState) : null;
  const issueParam = searchParams.get('issues');
  const issueFilter: IssueFilter = issueParam === 'open' || issueParam === 'resolved' ? issueParam : 'all';
  const [data, setData] = useState<PurchaseOrderDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number> | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api<PurchaseOrderDetail>(`/purchase-orders/${id}`);
      setData(detail);
      setExpanded((prev) => {
        if (prev) return prev;
        // Small POs open fully; otherwise only the item linked from Incoming items. Saves keep the user's choice.
        const item = Number(new URLSearchParams(window.location.search).get('item'));
        return new Set(detail.lines.length <= 2 ? detail.lines.map((l) => l.id) : item ? [item] : []);
      });
      setLoadError(null);
      return detail;
    } catch (err) {
      setData(null);
      setLoadError(err instanceof ApiRequestError ? { status: err.status, message: err.message } : { status: 0, message: 'Could not load the PO.' });
      return null;
    }
  }, [id]);

  useEffect(() => {
    setExpanded(null);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, resetCount]);

  // Return focus to the item's expand button after a save so keyboard users keep their place.
  useEffect(() => {
    if (focusLine === null || !data) return;
    document.querySelector<HTMLButtonElement>(`[data-item-expander="${focusLine}"]`)?.focus();
    setFocusLine(null);
  }, [data, focusLine]);

  const matches = useCallback(
    (d: DeliveryRow) =>
      (!stateFilter || d.state === stateFilter) &&
      (issueFilter === 'all' || (issueFilter === 'open' ? d.issue !== null : d.issue === null && d.lastResolution !== null)),
    [stateFilter, issueFilter],
  );

  async function saved(result: SaveResult, lineId: number | null) {
    setModal(null);
    const next = await load();
    const line = next?.lines.find((l) => l.id === lineId);
    const hidden = lineId !== null && line && !line.deliveries.some(matches);
    setFlash({ kind: 'success', text: hidden ? `${result.message} The item no longer matches the current filters.` : result.message });
    if (lineId !== null && !hidden) setFocusLine(lineId);
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

  const toggleItem = (lineId: number, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev ?? []);
      if (open ?? !next.has(lineId)) next.add(lineId);
      else next.delete(lineId);
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
  const lineOf = (deliveryId: number) => lines.find((l) => l.deliveries.some((d) => d.deliveryId === deliveryId))?.id ?? null;
  const visibleLines = lines
    .map((line) => ({ line, matching: line.deliveries.filter(matches) }))
    .filter(({ matching }) => matching.length > 0)
    .sort((a, b) => itemRank(a.line.deliveries) - itemRank(b.line.deliveries) || a.line.lineNo - b.line.lineNo);
  const openAction = (kind: 'arrival' | 'split' | 'resolve', delivery: DeliveryRow) => setModal({ kind, delivery });

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
        <dl className="work-order-callout">
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
        <button type="button" role="tab" aria-selected={tab === 'deliveries'} className={tab === 'deliveries' ? 'active' : ''} onClick={() => setParam('tab', null)}>
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
            <div className="segmented" role="group" aria-label="Issues">
              {ISSUE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={issueFilter === f.key ? 'active' : ''}
                  aria-pressed={issueFilter === f.key}
                  onClick={() => setParam('issues', f.key === 'all' ? null : f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {dueFollowUps.length > 0 && (
              <button type="button" className="link-button due-text" onClick={() => setParam('tab', 'follow-ups')}>
                {dueFollowUps.length} reminder{dueFollowUps.length === 1 ? '' : 's'} due
              </button>
            )}
          </div>

          {visibleLines.length === 0 ? (
            <p className="empty">No deliveries on this PO match these filters.</p>
          ) : (
            <>
              <p className="table-caption">Quantities: all deliveries.</p>
              <div className="table-scroll">
                <table className="data-table items-table">
                  <thead>
                    <tr>
                      <th>
                        <span className="visually-hidden">Expand</span>
                      </th>
                      <th className="num">Line</th>
                      <th>Part number</th>
                      <th>Description</th>
                      <th>Unit</th>
                      <th className="num" title="Full item quantity.">
                        Ordered
                      </th>
                      <th className="num" title="Cumulative dispatched quantity, including received units. In transit = Shipped − Received.">
                        Shipped
                      </th>
                      <th className="num" title="Cumulative received quantity. Not shipped = Ordered − Shipped.">
                        Received
                      </th>
                      <th>Required dock</th>
                      <th>Arrivals</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLines.map(({ line, matching }) => {
                      const open = expanded?.has(line.id) ?? false;
                      return (
                        <Fragment key={line.id}>
                          <tr
                            className={[open && 'expanded', line.openIssueCount > 0 && 'has-issue', riskRowClass(matching)].filter(Boolean).join(' ')}
                            data-line-id={line.id}
                          >
                            <td>
                              <button
                                type="button"
                                className="expander"
                                data-item-expander={line.id}
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
                            <td className="num">{line.shippedQty}</td>
                            <td className="num">{line.receivedQty}</td>
                            <td>
                              <DateText date={line.requiredDock} />
                            </td>
                            <td>
                              <ArrivalsStack line={line} matching={matching} expanded={open} onMore={() => toggleItem(line.id, true)} />
                            </td>
                            <td>
                              <ItemAction line={line} onAction={openAction} />
                            </td>
                          </tr>
                          {open && (
                            <tr className="detail-row" id={`item-${line.id}-deliveries`}>
                              <td colSpan={ITEM_COLUMNS}>
                                <DeliveriesTable deliveries={prioritizeArrivals(matching)} onAction={openAction} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="hint footnote">{DATE_RULES_NOTE}</p>
          <HistoryTable history={history} />
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
          <ArrivalForm delivery={modal.delivery} onCancel={() => setModal(null)} onSaved={(r) => saved(r, lineOf(modal.delivery.deliveryId))} />
        </Modal>
      )}
      {modal?.kind === 'split' && (
        <Modal title="Split delivery" onClose={() => setModal(null)} wide>
          <SplitForm delivery={modal.delivery} onCancel={() => setModal(null)} onSaved={(r) => saved(r, lineOf(modal.delivery.deliveryId))} />
        </Modal>
      )}
      {modal?.kind === 'resolve' && (
        <Modal title="Resolve issue" onClose={() => setModal(null)}>
          <ResolveForm delivery={modal.delivery} onCancel={() => setModal(null)} onSaved={(r) => saved(r, lineOf(modal.delivery.deliveryId))} />
        </Modal>
      )}
      {(modal?.kind === 'addFollowUp' || modal?.kind === 'editFollowUp') && (
        <Modal title={modal.kind === 'addFollowUp' ? 'Add reminder' : 'Edit reminder'} onClose={() => setModal(null)}>
          <FollowUpForm
            poId={po.id}
            poNumber={po.number}
            deliveries={allDeliveries.map((d) => ({ id: d.deliveryId, label: deliveryLabel(d) }))}
            defaultDeliveryId={modal.kind === 'addFollowUp' ? modal.deliveryId : null}
            defaultDueDate={demoDate}
            existing={modal.kind === 'editFollowUp' ? modal.followUp : undefined}
            onCancel={() => setModal(null)}
            onSaved={() => saved({ message: modal.kind === 'addFollowUp' ? 'Reminder added.' : 'Reminder saved.' }, null)}
          />
        </Modal>
      )}
      {modal?.kind === 'completeFollowUp' && (
        <Modal title="Complete reminder" onClose={() => setModal(null)}>
          <CompleteFollowUpForm followUp={modal.followUp} onCancel={() => setModal(null)} onSaved={() => saved({ message: 'Reminder completed.' }, null)} />
        </Modal>
      )}
    </section>
  );
}

/**
 * Up to two arrival dates, prioritized (open issues, other risk, outstanding, received). Quantities
 * appear only when the item has more than one active delivery; filters never change that rule.
 */
function ArrivalsStack({ line, matching, expanded, onMore }: { line: PoLineDetail; matching: DeliveryRow[]; expanded: boolean; onMore: () => void }) {
  const ordered = prioritizeArrivals(matching);
  const shown = ordered.slice(0, MAX_ARRIVALS);
  const hidden = ordered.length - shown.length;
  const multiple = line.deliveries.length > 1;
  return (
    <div className="arrival-stack">
      {shown.map((d) => (
        <div key={d.deliveryId} data-arrival-for={d.deliveryId} data-arrival-date={arrivalDate(d) ?? ''}>
          <ArrivalDate row={d} quantity={multiple ? d.quantity : undefined} />
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" className="more-button" aria-expanded={expanded} aria-label={`Show ${hidden} more deliveries`} onClick={onMore}>
          +{hidden}
        </button>
      )}
    </div>
  );
}

/** Open-issue count (covers deliveries hidden from the stack); a single delivery's actions inline. */
function ItemAction({ line, onAction }: { line: PoLineDetail; onAction: (kind: 'arrival' | 'split' | 'resolve', d: DeliveryRow) => void }) {
  const single = line.deliveries.length === 1 ? line.deliveries[0] : null;
  return (
    <div className="item-action">
      {line.openIssueCount > 0 && (
        <span className="issue-count" title={`${line.openIssueCount} open issue${line.openIssueCount === 1 ? '' : 's'}`}>
          <Icon name="flag" label={`${line.openIssueCount} open issue${line.openIssueCount === 1 ? '' : 's'}`} /> {line.openIssueCount}
        </span>
      )}
      {single && single.state !== 'received' && (
        <>
          {single.issue && (
            <button type="button" className="primary small" onClick={() => onAction('resolve', single)}>
              Resolve
            </button>
          )}
          <button type="button" className="small" onClick={() => onAction('arrival', single)}>
            Update arrival
          </button>
        </>
      )}
    </div>
  );
}

function DeliveriesTable({ deliveries, onAction }: { deliveries: DeliveryRow[]; onAction: (kind: 'arrival' | 'split' | 'resolve', d: DeliveryRow) => void }) {
  return (
    <table className="compact deliveries-table">
      <thead>
        <tr>
          <th>Delivery</th>
          <th className="num">Quantity</th>
          <th>State</th>
          <th>Required dock</th>
          <th>Expected / received arrival</th>
          <th>Production start</th>
          <th>Last update</th>
          <th>Issue</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {deliveries.map((d) => (
          <tr
            key={d.deliveryId}
            data-delivery-id={d.deliveryId}
            className={[d.issue && 'has-issue', riskRowClass([d])].filter(Boolean).join(' ') || undefined}
          >
            <td>#{d.deliveryId}</td>
            <td className="num">{d.quantity}</td>
            <td className="nowrap">
              <StateLabel state={d.state} />
            </td>
            <td>
              <DateText date={d.requiredDock} />
            </td>
            <td>
              <ArrivalDate row={d} />
            </td>
            <td>
              <ProductionStartDate row={d} />
            </td>
            <td>
              <LastUpdate at={d.arrivalUpdatedAt} source={d.source} />
            </td>
            <td className="nowrap">
              <IssueStatus row={d} />
            </td>
            <td>
              <RowActions row={d} onAction={(kind) => onAction(kind, d)} />
            </td>
          </tr>
        ))}
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
          Add reminder
        </button>
        <span className="hint">Optional reminders. They do not open or resolve delivery issues, and nothing is sent to the supplier.</span>
      </div>
      {followUps.length === 0 ? (
        <p className="empty">No reminders on this PO.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Reminder</th>
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
                    {f.isDue && <span className="badge due-badge">Due</span>}
                  </td>
                  <td>{f.note}</td>
                  <td className="nowrap">
                    {f.deliveryId !== null ? `#${f.deliveryId}` : 'Whole PO'}
                    {f.originalDeliveryId !== null && <div className="hint">From #{f.originalDeliveryId} (split)</div>}
                  </td>
                  <td className="nowrap">{f.state === 'open' ? 'Open' : `Completed ${new Date(f.completedAt!).toLocaleDateString()}`}</td>
                  <td>{f.completionNote ?? '—'}</td>
                  <td className="actions">
                    {f.state === 'open' && (
                      <>
                        <button type="button" className="small" onClick={() => onEdit(f)}>
                          Edit
                        </button>
                        <button type="button" className="small" onClick={() => onComplete(f)}>
                          Complete reminder
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

const dateText = (value: unknown) => (typeof value === 'string' ? formatDate(value) : 'Unknown');
const reasonsText = (value: unknown) => (Array.isArray(value) ? value.map((r) => REASON_LABELS[r as IssueReason] ?? r).join(', ') : '');

/** Old → new values for a history row. */
function describeChange(entry: HistoryEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.eventType) {
    case 'arrival_updated':
      return `${dateText(before.expectedArrival)} → ${dateText(after.expectedArrival)}`;
    case 'delivery_split': {
      const parts = (after.deliveries as { id: number; quantity: number; expectedArrival: string | null }[]) ?? [];
      return `${before.quantity} (${dateText(before.expectedArrival)}) → ${parts.map((p) => `#${p.id} ${p.quantity} (${dateText(p.expectedArrival)})`).join(', ')}`;
    }
    case 'issue_opened':
      return `${reasonsText(after.reasons)}${before.previousIssue ? ` (reopens #${before.previousIssue})` : ''}${before.parentIssue ? ` (from split issue #${before.parentIssue})` : ''}`;
    case 'issue_updated':
      return `${reasonsText(before.reasons)} → ${reasonsText(after.reasons)}`;
    case 'issue_resolved':
      return `${String(after.outcome)} · arrival ${dateText(after.expectedArrival)}`;
    case 'issue_superseded':
      return `Issue #${before.issue} → split deliveries`;
    case 'follow_up_added':
      return `Due ${dateText(after.dueDate)}`;
    case 'follow_up_edited':
      return `Due ${dateText(before.dueDate)} → ${dateText(after.dueDate)}`;
    case 'follow_up_completed':
      return 'Open → Completed';
    case 'follow_up_moved':
      return `#${before.delivery} → Whole PO`;
    default:
      return '';
  }
}

function HistoryTable({ history }: { history: HistoryEntry[] }) {
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
                <th>Old → new</th>
                <th title="The PO buyer is the demo actor; there is no login.">Actor</th>
                <th>Source</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{new Date(h.createdAt).toLocaleString()}</td>
                  <td className="nowrap">{EVENT_LABELS[h.eventType] ?? h.eventType}</td>
                  <td>{h.deliveryId !== null ? `#${h.deliveryId}` : 'PO'}</td>
                  <td>{describeChange(h)}</td>
                  <td className="nowrap">{h.actor ? `${h.actor} (demo)` : 'System'}</td>
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
