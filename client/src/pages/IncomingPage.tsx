import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatDate } from '../../../shared/dates';
import { compareDeliveries } from '../../../shared/impact';
import { DATE_RULES_NOTE, DELIVERY_STATE_LABELS, OUTCOME_LABELS, sourceLabel } from '../../../shared/labels';
import { DELIVERY_STATES, type DeliveryRow, type DeliveryState, type IncomingResponse } from '../../../shared/types';
import { ArrivalForm, ResolveForm, SplitForm, type SaveResult } from '../components/DeliveryForms';
import { ArrivalDate, DateText, Flash, IssueStatus, LastUpdate, ProductionStartDate, reasonList, riskRowClass, StateLabel } from '../components/Labels';
import { Modal } from '../components/Modal';

type View = 'action' | 'outstanding' | 'late' | 'unknown' | 'received';

const VIEWS: { key: View; label: string; test: (r: DeliveryRow) => boolean }[] = [
  { key: 'action', label: 'Needs action', test: (r) => r.issue !== null },
  { key: 'outstanding', label: 'All outstanding', test: (r) => r.state !== 'received' },
  // Late includes accepted/resolved delays: physical risk is independent of disposition.
  { key: 'late', label: 'Late', test: (r) => r.risk.reasons.includes('late') },
  { key: 'unknown', label: 'Date unknown', test: (r) => r.risk.reasons.includes('unknown') },
  { key: 'received', label: 'Received', test: (r) => r.state === 'received' },
];

type ModalState = { kind: 'arrival' | 'split' | 'resolve'; row: DeliveryRow };

export function IncomingPage() {
  const { resetCount } = useDemo();
  const [data, setData] = useState<IncomingResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>('action');
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [state, setState] = useState<'' | DeliveryState>('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<ModalState | null>(null);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<IncomingResponse>('/incoming');
      setData(next);
      setLoadError(null);
      return next;
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not load incoming items.');
      return null;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, resetCount]);

  const suppliers = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.supplierName))].sort(), [data]);
  const viewTest = VIEWS.find((v) => v.key === view)!.test;

  const matches = useCallback(
    (r: DeliveryRow) => {
      const term = search.trim().toLowerCase();
      return (
        viewTest(r) &&
        (!supplier || r.supplierName === supplier) &&
        (!state || r.state === state) &&
        (!term || [r.poNumber, r.partNumber, r.description, r.supplierName].some((v) => v.toLowerCase().includes(term)))
      );
    },
    [viewTest, search, supplier, state],
  );

  const rows = useMemo(() => (data ? data.rows.filter(matches).sort(compareDeliveries) : []), [data, matches]);
  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.key, (data?.rows ?? []).filter(v.test).length])) as Record<View, number>,
    [data],
  );

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saved(result: SaveResult, row: DeliveryRow) {
    setModal(null);
    const next = await load();
    const stillShown = next?.rows.some((r) => r.poLineId === row.poLineId && matches(r));
    setFlash({
      kind: 'success',
      text: stillShown ? result.message : `${result.message} It no longer matches the current filter.`,
    });
  }

  return (
    <section>
      <div className="page-heading">
        <h1>Incoming items</h1>
        <p className="hint">
          One row per active delivery. Order: open issues, then production conflict, production start, required dock date (a demo
          rule, not an optimized priority).
        </p>
      </div>
      <Flash message={flash} onDismiss={() => setFlash(null)} />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)} aria-pressed={view === v.key}>
              {v.label} <span className="count">{counts[v.key]}</span>
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
        <select aria-label="Delivery state" value={state} onChange={(e) => setState(e.target.value as DeliveryState | '')}>
          <option value="">All states</option>
          {DELIVERY_STATES.map((s) => (
            <option key={s} value={s}>
              {DELIVERY_STATE_LABELS[s]}
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
      {data && rows.length === 0 && (
        <p className="empty">{view === 'action' ? 'No deliveries need action with these filters.' : 'No deliveries match these filters.'}</p>
      )}

      {data && rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table incoming-table">
            <thead>
              <tr>
                <th>
                  <span className="visually-hidden">Details</span>
                </th>
                <th>PO</th>
                <th>Supplier</th>
                <th>Part</th>
                <th className="num">Qty</th>
                <th>State</th>
                <th>Required dock</th>
                <th>Expected arrival</th>
                <th>Production start</th>
                <th>Last update</th>
                <th>Issue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = expanded.has(row.deliveryId);
                return (
                  <Fragment key={row.deliveryId}>
                    <tr
                      className={[open && 'expanded', row.issue && 'has-issue', riskRowClass([row])].filter(Boolean).join(' ')}
                      data-delivery-id={row.deliveryId}
                    >
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
                        <Link to={`/purchase-orders/${row.poId}?item=${row.poLineId}`}>{row.poNumber}</Link>
                        <span className="hint"> · {row.lineNo}</span>
                      </td>
                      <td>{row.supplierName}</td>
                      <td className="nowrap" title={row.description}>
                        {row.partNumber}
                      </td>
                      <td className="num">{row.quantity}</td>
                      <td className="nowrap">
                        <StateLabel state={row.state} />
                      </td>
                      <td>
                        <DateText date={row.requiredDock} />
                      </td>
                      <td>
                        <ArrivalDate row={row} />
                      </td>
                      <td>
                        <ProductionStartDate row={row} />
                      </td>
                      <td>
                        <LastUpdate at={row.arrivalUpdatedAt} source={row.source} />
                      </td>
                      <td className="nowrap">
                        <IssueStatus row={row} />
                      </td>
                      <td>
                        <RowActions row={row} onAction={(kind) => setModal({ kind, row })} />
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td></td>
                        <td colSpan={11}>
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
      <p className="hint footnote">{DATE_RULES_NOTE}</p>

      {modal?.kind === 'arrival' && (
        <Modal title="Update expected arrival" onClose={() => setModal(null)}>
          <ArrivalForm delivery={modal.row} onCancel={() => setModal(null)} onSaved={(r) => saved(r, modal.row)} />
        </Modal>
      )}
      {modal?.kind === 'split' && (
        <Modal title="Split delivery" onClose={() => setModal(null)} wide>
          <SplitForm delivery={modal.row} onCancel={() => setModal(null)} onSaved={(r) => saved(r, modal.row)} />
        </Modal>
      )}
      {modal?.kind === 'resolve' && (
        <Modal title="Resolve issue" onClose={() => setModal(null)}>
          <ResolveForm delivery={modal.row} onCancel={() => setModal(null)} onSaved={(r) => saved(r, modal.row)} />
        </Modal>
      )}
    </section>
  );
}

/** Update arrival / Split / Resolve, shared by Incoming items and PO detail rows. */
export function RowActions({ row, onAction }: { row: DeliveryRow; onAction: (kind: 'arrival' | 'split' | 'resolve') => void }) {
  if (row.state === 'received') return <span className="hint">Read-only</span>;
  return (
    <div className="row-actions">
      {row.issue && (
        <button type="button" className="primary small" onClick={() => onAction('resolve')}>
          Resolve
        </button>
      )}
      <button type="button" className="small" onClick={() => onAction('arrival')}>
        Update arrival
      </button>
      {row.state === 'planned' && (
        <button type="button" className="small" onClick={() => onAction('split')}>
          Split
        </button>
      )}
    </div>
  );
}

function RowDetails({ row }: { row: DeliveryRow }) {
  const r = row.lastResolution;
  return (
    <table className="compact detail-table">
      <tbody>
        <tr>
          <th scope="row">Description</th>
          <td>{row.description}</td>
          <th scope="row">Destination</th>
          <td>{row.warehouseName}</td>
        </tr>
        <tr>
          <th scope="row">Work order</th>
          <td>
            {row.workOrderNumber} · {row.program}
          </td>
          <th scope="row">Last update</th>
          <td>
            {sourceLabel(row.source)} · {row.arrivalUpdatedAt ? new Date(row.arrivalUpdatedAt).toLocaleString() : '—'}
          </td>
        </tr>
        <tr>
          <th scope="row">Open issue</th>
          <td>{row.issue ? `${reasonList(row.issue.reasons)} · opened ${new Date(row.issue.openedAt).toLocaleString()}` : '—'}</td>
          <th scope="row">Last resolution</th>
          <td>
            {r ? `${OUTCOME_LABELS[r.outcome]} · ${r.resolvedBy} · ${new Date(r.resolvedAt).toLocaleString()}${r.note ? ` · ${r.note}` : ''}` : '—'}
          </td>
        </tr>
        <tr>
          <th scope="row">Reminders</th>
          <td colSpan={3}>
            {row.openFollowUps} open
            {row.dueFollowUps > 0 && <span className="due-text"> · {row.dueFollowUps} due</span>} ·{' '}
            <Link to={`/purchase-orders/${row.poId}?tab=follow-ups`}>View reminders</Link>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function deliveryLabel(r: DeliveryRow) {
  return `#${r.deliveryId} · line ${r.lineNo} · ${r.partNumber} · ${r.quantity} ${r.unit} · ${r.expectedArrival ? formatDate(r.expectedArrival) : 'date unknown'}`;
}
