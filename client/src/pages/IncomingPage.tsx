import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { compareDeliveries } from '../../../shared/impact';
import { EMPTY_FILTERS, matchesFilters, parseIncomingQuery, serializeIncomingQuery, viewCounts, VIEWS, type IncomingFilters, type View } from '../../../shared/incomingFilters';
import { DATE_RULES_NOTE, DELIVERY_STATE_LABELS, OUTCOME_LABELS, sourceLabel } from '../../../shared/labels';
import { DELIVERY_STATES, type DeliveryRow, type DeliveryState, type IncomingResponse } from '../../../shared/types';
import type { SaveResult } from '../components/DeliveryForms';
import { DemoScenariosDrawer } from '../components/DemoScenarios';
import { ArrivalDate, carrierStatusText, CarrierText, DateText, Flash, LastUpdate, ProductionStartDate, reasonList, riskRowClass, StateLabel, TrackingText } from '../components/Labels';
import { ManageDeliveriesButton, ManageDeliveriesModal } from '../components/ManageDeliveries';
import { MultiSelect } from '../components/MultiSelect';

export function IncomingPage() {
  const { dataVersion, meta } = useDemo();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<IncomingResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<DeliveryRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  }, [load, dataVersion]);

  // View, search, and filters live in the URL so they survive PO navigation, back, and reload.
  const { view, filters } = useMemo(() => parseIncomingQuery(searchParams, data?.filterOptions ?? null), [searchParams, data]);
  const update = (nextView: View, next: IncomingFilters) => setSearchParams(serializeIncomingQuery(nextView, next), { replace: true });
  const setFilter = (patch: Partial<IncomingFilters>) => update(view, { ...filters, ...patch });

  const suppliers = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.supplierName))].sort(), [data]);
  const viewTest = VIEWS.find((v) => v.key === view)!.test;
  const matches = useCallback((r: DeliveryRow) => viewTest(r) && matchesFilters(r, filters), [viewTest, filters]);
  const rows = useMemo(() => (data ? data.rows.filter(matches).sort(compareDeliveries) : []), [data, matches]);
  const counts = useMemo(() => viewCounts(data?.rows ?? [], filters), [data, filters]);
  const anyFilter = filters.search || filters.supplier || filters.state || filters.destinations.length > 0 || filters.programs.length > 0;
  const returnTo = encodeURIComponent(location.search);

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
      <div className="page-heading with-actions">
        <h1>Incoming items</h1>
        {meta?.demoMode && (
          <button type="button" className="small" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((o) => !o)}>
            Demo scenarios
          </button>
        )}
      </div>
      <Flash message={flash} onDismiss={() => setFlash(null)} />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className={view === v.key ? 'active' : ''} onClick={() => update(v.key, filters)} aria-pressed={view === v.key}>
              {v.label} <span className="count">{counts[v.key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar filters">
        <input
          type="search"
          placeholder="Search PO, part, supplier"
          aria-label="Search PO, part, or supplier"
          value={filters.search}
          onChange={(e) => setFilter({ search: e.target.value })}
        />
        <select aria-label="Supplier" value={filters.supplier} onChange={(e) => setFilter({ supplier: e.target.value })}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select aria-label="Delivery state" value={filters.state} onChange={(e) => setFilter({ state: e.target.value as DeliveryState | '' })}>
          <option value="">All states</option>
          {DELIVERY_STATES.map((s) => (
            <option key={s} value={s}>
              {DELIVERY_STATE_LABELS[s]}
            </option>
          ))}
        </select>
        <MultiSelect
          label="Destination"
          options={(data?.filterOptions.destinations ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
          selected={filters.destinations.map(String)}
          onChange={(values) => setFilter({ destinations: values.map(Number) })}
        />
        <MultiSelect
          label="Program line"
          options={(data?.filterOptions.programs ?? []).map((p) => ({ value: p, label: p }))}
          selected={filters.programs}
          onChange={(values) => setFilter({ programs: values })}
        />
        {anyFilter && (
          <button type="button" className="link-button" onClick={() => update(view, EMPTY_FILTERS)}>
            Clear all
          </button>
        )}
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
        <div className="empty">
          {view === 'action' ? 'No deliveries need action with these filters.' : 'No deliveries match these filters.'}
          {anyFilter && (
            <>
              {' '}
              <button type="button" className="link-button" onClick={() => update(view, EMPTY_FILTERS)}>
                Clear all filters
              </button>
            </>
          )}
        </div>
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
                <th>Manage deliveries</th>
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
                        <Link to={`/purchase-orders/${row.poId}?item=${row.poLineId}&from=${returnTo}`}>{row.poNumber}</Link>
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
                      <td>
                        <ManageDeliveriesButton
                          openIssueCount={row.issue ? 1 : 0}
                          readOnly={row.state === 'received'}
                          focusKey={`incoming-${row.deliveryId}`}
                          onClick={() => setModal(row)}
                        />
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td></td>
                        <td colSpan={10}>
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

      {modal && (
        <ManageDeliveriesModal
          poId={modal.poId}
          poLineId={modal.poLineId}
          initialDeliveryId={modal.deliveryId}
          onClose={() => setModal(null)}
          onSaved={(r) => saved(r, modal)}
        />
      )}
      {drawerOpen && <DemoScenariosDrawer onClose={() => setDrawerOpen(false)} />}
    </section>
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
            {sourceLabel(row.source)} · {row.arrivalUpdatedAt ? formatClock(row.arrivalUpdatedAt) : '—'}
          </td>
        </tr>
        <tr>
          <th scope="row">Carrier</th>
          <td>
            <CarrierText row={row} />
            {row.shipment && <span className="hint"> · {carrierStatusText(row)}</span>}
          </td>
          <th scope="row">Tracking number</th>
          <td>
            <TrackingText row={row} />
            {row.shipment?.carrierDeliveredAt && row.state !== 'received' && (
              <span className="hint"> · carrier delivered {formatClock(row.shipment.carrierDeliveredAt)}</span>
            )}
          </td>
        </tr>
        <tr>
          <th scope="row">Open issue</th>
          <td>{row.issue ? `${reasonList(row.issue.reasons)} · opened ${formatClock(row.issue.openedAt)}` : '—'}</td>
          <th scope="row">Last resolution</th>
          <td>{r ? `${OUTCOME_LABELS[r.outcome]} · ${r.resolvedBy} · ${formatClock(r.resolvedAt)}${r.note ? ` · ${r.note}` : ''}` : '—'}</td>
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
