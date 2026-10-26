import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatDate } from '../../../shared/dates';
import { compareAttention } from '../../../shared/impact';
import { ATTENTION_LABELS, PROCESSING_TIME_NOTE, sourceLabel } from '../../../shared/labels';
import { ATTENTION_ORDER, type AttentionReason, type DeliveryRow, type IncomingResponse } from '../../../shared/types';
import { ArrivalForm } from '../components/ArrivalForm';
import { FollowUpForm } from '../components/FollowUpForm';
import { ArrivalText, Flash, LastUpdate, ReasonBadge, StateLabel } from '../components/Labels';
import { Modal } from '../components/Modal';

type View = 'attention' | 'outstanding' | 'received';
type SortKey = 'attention' | 'po' | 'supplier' | 'part' | 'workOrder' | 'quantity' | 'arrival' | 'start' | 'lastUpdate' | 'followUp';

const VIEW_LABELS: Record<View, string> = {
  attention: 'Needs attention',
  outstanding: 'All outstanding',
  received: 'Received',
};

function inView(row: DeliveryRow, view: View) {
  if (view === 'received') return row.state === 'received';
  if (row.state === 'received') return false;
  return view === 'outstanding' || row.primaryReason !== 'none';
}

const nullsLast = (a: string | null | undefined, b: string | null | undefined) =>
  a === b ? 0 : a == null ? 1 : b == null ? -1 : a.localeCompare(b);

const SORTERS: Record<SortKey, (a: DeliveryRow, b: DeliveryRow) => number> = {
  attention: compareAttention,
  po: (a, b) => a.poNumber.localeCompare(b.poNumber) || a.lineNo - b.lineNo,
  supplier: (a, b) => a.supplierName.localeCompare(b.supplierName),
  part: (a, b) => a.partNumber.localeCompare(b.partNumber),
  workOrder: (a, b) => a.workOrderNumber.localeCompare(b.workOrderNumber),
  quantity: (a, b) => a.quantity - b.quantity,
  arrival: (a, b) => nullsLast(a.expectedArrival, b.expectedArrival),
  start: (a, b) => nullsLast(a.productionStart, b.productionStart),
  lastUpdate: (a, b) => nullsLast(a.updatedAt, b.updatedAt),
  followUp: (a, b) => nullsLast(a.nextFollowUp?.dueDate, b.nextFollowUp?.dueDate),
};

export function IncomingPage() {
  const { resetCount } = useDemo();
  const [data, setData] = useState<IncomingResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>('attention');
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reason, setReason] = useState<'' | AttentionReason>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'attention', dir: 1 });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ kind: 'arrival' | 'followUp'; row: DeliveryRow } | null>(null);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<IncomingResponse>('/incoming'));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not load incoming items.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, resetCount]);

  const suppliers = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.supplierName))].sort(), [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.rows
      .filter((r) => inView(r, view))
      .filter((r) => !supplier || r.supplierName === supplier)
      .filter((r) => !reason || r.reasons.includes(reason))
      .filter(
        (r) =>
          !term ||
          [r.poNumber, r.partNumber, r.description, r.supplierName].some((v) => v.toLowerCase().includes(term)),
      )
      .sort((a, b) => sort.dir * SORTERS[sort.key](a, b) || compareAttention(a, b));
  }, [data, view, search, supplier, reason, sort]);

  const counts = useMemo(() => {
    const result: Record<View, number> = { attention: 0, outstanding: 0, received: 0 };
    for (const r of data?.rows ?? []) for (const v of Object.keys(result) as View[]) if (inView(r, v)) result[v]++;
    return result;
  }, [data]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function saved(text: string) {
    setModal(null);
    setFlash({ kind: 'success', text });
    load();
  }

  const header = (key: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className="sort-button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  return (
    <section>
      <div className="page-heading">
        <h1>Incoming items</h1>
        <p className="hint">
          One row per scheduled delivery. Default order: strongest attention reason, then the work order’s production start
          (a simple demo rule, not an optimized priority).
        </p>
      </div>
      <Flash message={flash} onDismiss={() => setFlash(null)} />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Delivery view">
          {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
            <button key={v} type="button" className={view === v ? 'active' : ''} onClick={() => setView(v)} aria-pressed={view === v}>
              {VIEW_LABELS[v]} <span className="count">{counts[v]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search PO, part, supplier"
          aria-label="Search PO, part, or supplier"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select aria-label="Attention reason" value={reason} onChange={(e) => setReason(e.target.value as AttentionReason | '')}>
          <option value="">All attention reasons</option>
          {ATTENTION_ORDER.map((r) => (
            <option key={r} value={r}>
              {ATTENTION_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      {loadError && (
        <div className="flash flash-error" role="alert">
          {loadError}{' '}
          <button type="button" className="link-button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!data && !loadError && <p className="empty">Loading incoming items…</p>}
      {data && rows.length === 0 && <p className="empty">No deliveries match these filters.</p>}

      {data && rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <span className="visually-hidden">Details</span>
                </th>
                {header('po', 'PO')}
                {header('supplier', 'Supplier')}
                {header('part', 'Part')}
                <th>Destination</th>
                {header('workOrder', 'Work order')}
                {header('quantity', 'Qty', 'num')}
                <th>Delivery state</th>
                {header('arrival', 'Expected arrival', 'date-col')}
                {header('start', 'Production start', 'date-col')}
                {header('attention', 'Attention')}
                {header('lastUpdate', 'Last update')}
                {header('followUp', 'Next follow-up')}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = expanded.has(row.deliveryId);
                return (
                  <Fragment key={row.deliveryId}>
                    <tr className={open ? 'expanded' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="expander"
                          aria-expanded={open}
                          aria-label={`Details for ${row.poNumber} line ${row.lineNo} delivery ${row.deliveryId}`}
                          onClick={() => toggle(row.deliveryId)}
                        >
                          {open ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="nowrap">
                        <Link to={`/purchase-orders/${row.poId}`}>{row.poNumber}</Link>
                        <span className="hint"> · {row.lineNo}</span>
                      </td>
                      <td>{row.supplierName}</td>
                      <td>
                        <span className="nowrap">{row.partNumber}</span>
                        <div className="hint">{row.description}</div>
                      </td>
                      <td className="nowrap">{row.warehouseName}</td>
                      <td className="nowrap">{row.workOrderNumber}</td>
                      <td className="num">
                        {row.quantity} <span className="hint">{row.unit}</span>
                      </td>
                      <td>
                        <StateLabel state={row.state} />
                      </td>
                      <td className="date-col">
                        <ArrivalText row={row} />
                      </td>
                      <td className="date-col nowrap">{formatDate(row.productionStart)}</td>
                      <td>
                        <ReasonBadge reason={row.primaryReason} />
                        {row.reasons.length > 1 && <span className="hint"> +{row.reasons.length - 1}</span>}
                      </td>
                      <td>
                        <LastUpdate updatedAt={row.updatedAt} source={row.source} />
                      </td>
                      <td className="nowrap">
                        {row.nextFollowUp ? (
                          <span className={row.dueFollowUps > 0 ? 'due-text' : undefined}>{formatDate(row.nextFollowUp.dueDate)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <div className="actions incoming-actions">
                          {row.state !== 'received' && (
                            <button type="button" onClick={() => setModal({ kind: 'arrival', row })}>
                              Update arrival
                            </button>
                          )}
                          <Link className="button" to={`/purchase-orders/${row.poId}`}>
                            Open PO
                          </Link>
                          <button type="button" onClick={() => setModal({ kind: 'followUp', row })}>
                            Add follow-up
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td></td>
                        <td colSpan={13}>
                          <RowDetails row={row} />
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

      {modal?.kind === 'arrival' && (
        <Modal title="Update expected arrival" onClose={() => setModal(null)}>
          <ArrivalForm delivery={modal.row} onCancel={() => setModal(null)} onSaved={() => saved('Expected arrival saved.')} />
        </Modal>
      )}
      {modal?.kind === 'followUp' && data && (
        <Modal title="Add follow-up" onClose={() => setModal(null)}>
          <FollowUpForm
            poId={modal.row.poId}
            poNumber={modal.row.poNumber}
            deliveries={data.rows.filter((r) => r.poId === modal.row.poId).map((r) => ({ id: r.deliveryId, label: deliveryLabel(r) }))}
            defaultDeliveryId={modal.row.deliveryId}
            defaultDueDate={data.demoDate}
            onCancel={() => setModal(null)}
            onSaved={() => saved('Follow-up added.')}
          />
        </Modal>
      )}
    </section>
  );
}

export function deliveryLabel(r: DeliveryRow) {
  return `#${r.deliveryId} · line ${r.lineNo} · ${r.partNumber} · ${r.quantity} ${r.unit} · ${
    r.expectedArrival ? formatDate(r.expectedArrival) : 'date unknown'
  }`;
}

function RowDetails({ row }: { row: DeliveryRow }) {
  return (
    <table className="compact detail-table">
      <tbody>
        <tr>
          <th scope="row">All attention reasons</th>
          <td>
            {row.reasons.map((r) => (
              <ReasonBadge key={r} reason={r} />
            ))}
          </td>
        </tr>
        <tr>
          <th scope="row">Work order</th>
          <td>
            {row.workOrderNumber} · {row.program} · production start {formatDate(row.productionStart)}
          </td>
        </tr>
        <tr>
          <th scope="row">Last arrival update</th>
          <td>
            {sourceLabel(row.source)} · {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
          </td>
        </tr>
        <tr>
          <th scope="row">Next follow-up</th>
          <td>
            {row.nextFollowUp ? (
              <>
                {formatDate(row.nextFollowUp.dueDate)} — {row.nextFollowUp.note}
                {row.nextFollowUp.deliveryId === null && <span className="hint"> (whole PO)</span>}
                {row.openFollowUps > 1 && <span className="hint"> · {row.openFollowUps} open</span>}
              </>
            ) : (
              'None open'
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
