import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import {
  arrivalDate,
  compareItems,
  itemSortParams,
  nextItemSort,
  parseItemSort,
  prioritizeArrivals,
  type ItemSort,
  type ItemSortKey,
} from '../../../shared/arrivals';
import { formatDate } from '../../../shared/dates';
import { DATE_RULES_NOTE, DELIVERY_STATE_LABELS } from '../../../shared/labels';
import { DELIVERY_STATES, type CallTaskView, type DeliveryRow, type DeliveryState, type FollowUp, type PoLineDetail, type PurchaseOrderDetail } from '../../../shared/types';
import { CallTasksTable, CorrespondenceList } from '../components/Correspondence';
import type { SaveResult } from '../components/DeliveryForms';
import { DeliveryTrackingTable } from '../components/DeliveryTrackingTable';
import { CompleteFollowUpForm, FollowUpForm } from '../components/FollowUpForm';
import { HistoryDisclosure } from '../components/HistoryDisclosure';
import { ArrivalDate, DateText, Flash, FormErrors, riskRowClass } from '../components/Labels';
import { ManageDeliveriesButton, ManageDeliveriesModal } from '../components/ManageDeliveries';
import { SortableHeader } from '../components/SortableHeader';
import { Modal } from '../components/Modal';
import { deliveryLabel } from './IncomingPage';

type IssueFilter = 'all' | 'open' | 'resolved';
const ISSUE_FILTERS: { key: IssueFilter; label: string }[] = [
  { key: 'all', label: 'All issues' },
  { key: 'open', label: 'Needs action' },
  { key: 'resolved', label: 'Resolved issues' },
];

type ModalState =
  | { kind: 'manage'; line: PoLineDetail }
  | { kind: 'addFollowUp'; deliveryId: number | null }
  | { kind: 'editFollowUp' | 'completeFollowUp'; followUp: FollowUp }
  | { kind: 'completeCallTask'; task: CallTaskView };

const ITEM_COLUMNS = 11;
const MAX_ARRIVALS = 2;

/** Back link target: the Incoming items URL (with its filters) the user came from. */
function backSearch(from: string | null): string {
  return from && from.startsWith('?') ? from : '';
}

export function PurchaseOrderPage() {
  const { id } = useParams();
  const { dataVersion } = useDemo();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'follow-ups' ? 'follow-ups' : 'deliveries';
  const stateParam = searchParams.get('state');
  const stateFilter = DELIVERY_STATES.includes(stateParam as DeliveryState) ? (stateParam as DeliveryState) : null;
  const issueParam = searchParams.get('issues');
  const issueFilter: IssueFilter = issueParam === 'open' || issueParam === 'resolved' ? issueParam : 'all';
  // Items sort by line number unless a header sort is chosen; the choice lives in the URL.
  const itemSort = parseItemSort(searchParams);
  const from = backSearch(searchParams.get('from'));
  const [data, setData] = useState<PurchaseOrderDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [correspondenceOpen, setCorrespondenceOpen] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

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
    // A different PO starts with its own expansion and collapsed disclosures.
    setExpanded(null);
    setHistoryOpen(false);
    setCorrespondenceOpen(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

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

  async function startCallTask(task: CallTaskView) {
    try {
      await api(`/call-tasks/${task.id}`, { method: 'PATCH', body: { action: 'start', version: task.version } });
      await load();
      setFlash({ kind: 'success', text: `Call task #${task.id} started.` });
    } catch (err) {
      setFlash({ kind: 'error', text: err instanceof ApiRequestError ? err.message : 'Could not start the call task.' });
    }
  }

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
        <Link to={{ pathname: '/', search: from }}>Back to Incoming items</Link>
      </section>
    );
  }
  if (!data) return <p className="empty">Loading purchase order…</p>;

  const { po, lines, followUps, history, demoDate, correspondence, callTasks, carrierEvents } = data;
  const allDeliveries = lines.flatMap((l) => l.deliveries);
  const openFollowUps = followUps.filter((f) => f.state === 'open');
  const dueFollowUps = openFollowUps.filter((f) => f.isDue);
  const openCallTasks = callTasks.filter((t) => t.state === 'open' || t.state === 'in_progress');
  const visibleLines = lines
    .map((line) => ({ line, matching: line.deliveries.filter(matches) }))
    .filter(({ matching }) => matching.length > 0)
    .sort(compareItems(itemSort));
  const setItemSort = (next: ItemSort) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        const value = itemSortParams(next);
        if (value) {
          params.set('sort', value.key);
          params.set('dir', value.dir);
        } else {
          params.delete('sort');
          params.delete('dir');
        }
        return params;
      },
      { replace: true },
    );
  const header = (key: ItemSortKey, label: string, numeric = false, title?: string) => (
    <SortableHeader
      key={key}
      label={label}
      numeric={numeric}
      title={title}
      direction={itemSort.key === key ? itemSort.dir : null}
      onSort={() => setItemSort(nextItemSort(itemSort, key))}
    />
  );

  return (
    <section>
      <p className="breadcrumb">
        <Link to={{ pathname: '/', search: from }}>← Incoming items</Link>
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
          {openCallTasks.length > 0 && (
            <span className="count due">
              {openCallTasks.length} call task{openCallTasks.length === 1 ? '' : 's'}
            </span>
          )}
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
                      {header('line', 'Line', true)}
                      {header('part', 'Part number')}
                      {header('description', 'Description')}
                      {header('unit', 'Unit')}
                      {header('ordered', 'Ordered', true, 'Full item quantity.')}
                      {header('shipped', 'Shipped', true, 'Cumulative dispatched quantity, including received units. In transit = Shipped − Received.')}
                      {header('received', 'Received', true, 'Cumulative received quantity. Not shipped = Ordered − Shipped.')}
                      {header('dock', 'Required dock')}
                      {header('arrivals', 'Arrivals')}
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
                                aria-label={`Delivery schedule and tracking for line ${line.lineNo} ${line.partNumber}`}
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
                              {/* Open issues across all of the item's deliveries, even ones the filters hide. */}
                              <ManageDeliveriesButton
                                openIssueCount={line.openIssueCount}
                                readOnly={line.deliveries.every((d) => d.state === 'received')}
                                focusKey={`item-${line.id}`}
                                onClick={() => setModal({ kind: 'manage', line })}
                              />
                            </td>
                          </tr>
                          {open && (
                            <tr className="detail-row" id={`item-${line.id}-deliveries`}>
                              <td colSpan={ITEM_COLUMNS}>
                                <DeliveryTrackingTable deliveries={prioritizeArrivals(matching)} carrierEvents={carrierEvents} />
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
          {correspondence.length > 0 && (
            <div className="history">
              <h2>
                <button
                  type="button"
                  className="disclosure"
                  aria-expanded={correspondenceOpen}
                  aria-controls="po-correspondence"
                  onClick={() => setCorrespondenceOpen((o) => !o)}
                >
                  {correspondenceOpen ? '▾' : '▸'} Supplier correspondence ({correspondence.length})
                </button>
              </h2>
              {correspondenceOpen && (
                <div id="po-correspondence">
                  <CorrespondenceList requests={correspondence} />
                </div>
              )}
            </div>
          )}
          <HistoryDisclosure history={history} expanded={historyOpen} onToggle={() => setHistoryOpen((o) => !o)} />
        </>
      )}

      {tab === 'follow-ups' && (
        <>
          <CallTasksTable
            tasks={callTasks}
            onStart={startCallTask}
            onComplete={(task) => setModal({ kind: 'completeCallTask', task })}
          />
          <FollowUpsTab
            followUps={followUps}
            onAdd={() => setModal({ kind: 'addFollowUp', deliveryId: null })}
            onEdit={(f) => setModal({ kind: 'editFollowUp', followUp: f })}
            onComplete={(f) => setModal({ kind: 'completeFollowUp', followUp: f })}
          />
        </>
      )}

      {modal?.kind === 'manage' && (
        <ManageDeliveriesModal
          poId={po.id}
          poLineId={modal.line.id}
          onClose={() => setModal(null)}
          onSaved={(r) => saved(r, modal.line.id)}
        />
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
      {modal?.kind === 'completeCallTask' && (
        <Modal title="Complete call task" onClose={() => setModal(null)}>
          <CompleteCallTaskForm task={modal.task} onCancel={() => setModal(null)} onSaved={() => saved({ message: 'Call task completed.' }, null)} />
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
          <ArrivalDate row={d} quantity={multiple ? d.quantity : undefined} showTransit />
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

/** Completing a call task records the phone follow-up. It never resolves delivery issues. */
function CompleteCallTaskForm({ task, onSaved, onCancel }: { task: CallTaskView; onSaved: () => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/call-tasks/${task.id}`, { method: 'PATCH', body: { action: 'complete', version: task.version, note } });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Save failed.');
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="form">
      <p className="hint">
        Record arrival changes from the call with Manage deliveries. Completing this task does not change dates or resolve delivery issues.
      </p>
      <FormErrors error={error} fields={{}} />
      <div className="field">
        <label htmlFor="call-note">Call note (optional)</label>
        <textarea id="call-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Complete call task'}
        </button>
      </div>
    </form>
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
