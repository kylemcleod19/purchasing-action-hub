// "Demo scenarios" page (PRD §13 "UI and acceptance additions"), linked beside Incoming items. One
// scenario at a time, with its progression controls at the top and its results directly below. Every
// step calls a real, persisted server mutation; progress is read back from the server, so tab switches
// and refreshes never replay, reset, or advance anything. Emails are read-only views.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { CALL_TASK_STATE_LABELS, CARRIER_STATUS_LABELS, EXCLUSION_LABELS } from '../../../shared/labels';
import type {
  CallTaskView,
  DeliveryRow,
  EmailView,
  IncomingResponse,
  OutreachItemView,
  OutreachPreview,
  OutreachRequestView,
  PurchaseOrderDetail,
  ScenarioCase,
  ScenariosResponse,
  ScenarioStep,
  SupplierMessageView,
} from '../../../shared/types';
import { EmailButton, EmailModal } from '../components/EmailPanel';
import { ArrivalDate, DateText, ProductionStartDate, reasonList } from '../components/Labels';
import { ResetDemoButton } from '../components/ResetDemoButton';

interface ScenarioData {
  scenarios: ScenariosResponse;
  preview: OutreachPreview;
  rows: DeliveryRow[];
  /** PO details for both POs of each case (correspondence, tasks, history, carrier events). */
  details: Record<number, PurchaseOrderDetail>;
}

type Status = { kind: 'running' | 'success' | 'error'; text: string } | null;

const TABS = [
  { key: 'A', param: 'supplier' },
  { key: 'B', param: 'carrier' },
] as const;

export function DemoScenariosPage() {
  const { dataVersion, refreshAll, meta } = useDemo();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('scenario') === 'carrier' ? 'B' : 'A';
  const [data, setData] = useState<ScenarioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [email, setEmail] = useState<{ title: string; view: EmailView } | null>(null);

  const load = useCallback(async () => {
    try {
      const [scenarios, preview, incoming] = await Promise.all([
        api<ScenariosResponse>('/demo/scenarios'),
        api<OutreachPreview>('/outreach/preview'),
        api<IncomingResponse>('/incoming'),
      ]);
      const ids = [...new Set(scenarios.cases.flatMap((c) => c.poIds))];
      const details = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await api<PurchaseOrderDetail>(`/purchase-orders/${id}`)] as const)));
      setData({ scenarios, preview, rows: incoming.rows, details });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not load the demo scenarios.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Switching tabs only changes the URL; it never runs, resets, or advances anything.
  function switchTab(key: 'A' | 'B') {
    setStatus(null);
    setSearchParams(key === 'B' ? { scenario: 'carrier' } : {}, { replace: true });
  }

  /** Runs one simulation step. Progress advances only when the server reports success. */
  async function run(c: ScenarioCase, step: ScenarioStep) {
    if (status?.kind === 'running' || !data) return;
    setStatus({ kind: 'running', text: `${step.actionLabel}…` });
    try {
      let text: string;
      if (step.kind === 'send') {
        const supplier = data.preview.suppliers.find((s) => s.supplierId === c.supplierId);
        if (!supplier) throw new ApiRequestError(409, 'No items are eligible for this supplier right now.');
        const r = await api<{ requestId: number; itemCount: number }>('/demo/outreach/send', {
          method: 'POST',
          body: { supplierId: supplier.supplierId, items: supplier.items.map((i) => ({ deliveryId: i.deliveryId, version: i.version })) },
        });
        text = `Request #${r.requestId} recorded (simulated, not sent) for ${r.itemCount} items.`;
      } else if (step.kind === 'reply') {
        const r = await api<{ duplicate: boolean; applied: number; needsReview: number; notMentioned: number }>(`/demo/supplier-replies/${step.key}`, {
          method: 'POST',
        });
        text = r.duplicate
          ? 'This reply was already processed; nothing changed.'
          : `Reply processed: ${r.applied} updated, ${r.needsReview} need clarification, ${r.notMentioned} not mentioned.`;
      } else if (step.kind === 'carrier') {
        const r = await api<{ duplicate: boolean; appliedState: string; updated: number; held: number }>(`/demo/carrier-events/${step.key}`, { method: 'POST' });
        text = r.duplicate
          ? 'Duplicate event ID; nothing changed.'
          : r.appliedState === 'ignored'
            ? 'Older event recorded as ignored; current estimates kept.'
            : `Carrier event ${r.appliedState.replace('_', ' ')}: ${r.updated} deliveries updated${r.held ? `, ${r.held} held for review` : ''}.`;
      } else {
        const r = await api<{ demoClock: string; issuesChanged: number; callTasksCreated: number }>('/demo/advance-clock', {
          method: 'POST',
          body: { step: step.key },
        });
        text = `Demo clock is now ${formatClock(r.demoClock)}. ${r.issuesChanged} issue changes; ${r.callTasksCreated} call tasks created.`;
      }
      // Show success only once the results below reflect the change; then refresh the banner and other pages.
      await load();
      setStatus({ kind: 'success', text });
      refreshAll();
    } catch (err) {
      setStatus({ kind: 'error', text: `${err instanceof ApiRequestError ? err.message : 'The step failed.'} Nothing was changed.` });
    }
  }

  async function openPreview(title: string, path: string) {
    try {
      setEmail({ title, view: await api<EmailView>(path) });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof ApiRequestError ? err.message : 'Could not load the email.' });
    }
  }
  const openMessage = (title: string, m: SupplierMessageView) =>
    setEmail({ title, view: { from: m.from, to: m.to, subject: m.subject, at: m.at, body: m.body, sample: false } });

  if (meta && !meta.demoMode) return <p className="empty">Demo scenarios are not available on this deployment.</p>;

  const scenario = data?.scenarios.cases.find((c) => c.key === tab);
  const busy = status?.kind === 'running';

  return (
    <section className="scenarios-page" aria-label="Demo scenarios">
      <div className="page-heading scenarios-heading">
        <h1>Demo scenarios</h1>
        {data && (
          <p className="scenario-clock">
            Demo clock <strong>{formatClock(data.scenarios.demoClock)}</strong>
          </p>
        )}
      </div>
      <p className="scenario-notice">Simulated emails and carrier events; no messages are sent.</p>
      <details className="about-demo">
        <summary>About this demo</summary>
        <p className="hint">
          Supplier replies and carrier events are deterministic fixtures, not live AI or carrier connections. Each fixture holds its source text and
          the structured result it stands for; processing applies that result through the same update and issue rules as manual edits. Results show
          workflow behavior, not extraction accuracy. The demo clock moves only forward, through the controls below. Both scenarios share it, so run
          the supplier scenario before advancing to the carrier delivery time, or reset in between.
        </p>
      </details>

      {loadError && (
        <div className="form-error" role="alert">
          {loadError}
        </div>
      )}
      {data && !data.scenarios.fixturesInstalled && <p className="seed-notice">This data predates the scenarios. Reset demo data to install them.</p>}

      <div className="tabs" role="tablist" aria-label="Scenario">
        {TABS.map((t) => {
          const c = data?.scenarios.cases.find((x) => x.key === t.key);
          return (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => switchTab(t.key)}>
              {c?.title ?? (t.key === 'A' ? 'Supplier email follow-up' : 'Carrier tracking updates')}
            </button>
          );
        })}
      </div>

      {!data && !loadError && <p className="empty">Loading scenarios…</p>}
      {data && scenario && (
        <div role="tabpanel" aria-label={scenario.title}>
          <p className="scenario-explanation">{scenario.explanation}</p>
          <ProgressToolbar
            scenario={scenario}
            status={status}
            busy={busy}
            onRun={(s) => run(scenario, s)}
            secondary={
              scenario.key === 'A' ? (
                <SupplierSecondary data={data} scenario={scenario} onPreview={openPreview} onMessage={openMessage} />
              ) : (
                <PoLinks data={data} scenario={scenario} />
              )
            }
          />
          {scenario.key === 'A' ? (
            <SupplierResults data={data} scenario={scenario} onMessage={openMessage} />
          ) : (
            <CarrierResults data={data} scenario={scenario} />
          )}
          <details className="scenario-section">
            <summary>Additional test cases</summary>
            <table className="compact">
              <tbody>
                {scenario.extras.map((s) => (
                  <tr key={s.key}>
                    <th scope="row" className="nowrap">
                      {s.title}
                    </th>
                    <td>{s.description}</td>
                    <td className="nowrap">
                      <button type="button" className="small" disabled={busy || s.blockedReason !== null} onClick={() => run(scenario, s)}>
                        {s.actionLabel}
                      </button>
                      {s.done && <span className="ok-text"> ✓ done</span>}
                      {s.blockedReason && <div className="hint">{s.blockedReason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {scenario.key === 'A' && <AllSuppliersPreview preview={data.preview} />}
        </div>
      )}

      <div className="scenario-reset">
        <span className="hint">Reset replaces the shared dataset for every visitor. It never happens automatically.</span>
        <ResetDemoButton className="small" />
      </div>
      {email && <EmailModal title={email.title} email={email.view} onClose={() => setEmail(null)} />}
    </section>
  );
}

/** Sticky step indicator, current step, one primary action, and read-only secondary controls. */
function ProgressToolbar({
  scenario,
  status,
  busy,
  onRun,
  secondary,
}: {
  scenario: ScenarioCase;
  status: Status;
  busy: boolean;
  onRun: (s: ScenarioStep) => void;
  secondary: ReactNode;
}) {
  const currentIndex = scenario.steps.findIndex((s) => !s.done);
  const current = currentIndex >= 0 ? scenario.steps[currentIndex] : null;
  return (
    <div className="scenario-toolbar">
      <ol className="step-indicator" aria-label="Progress">
        {scenario.steps.map((s, i) => {
          const state = s.done ? 'done' : i === currentIndex ? 'current' : 'upcoming';
          return (
            <li key={s.key} className={`step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="step-marker" aria-hidden="true">
                {s.done ? '✓' : i + 1}
              </span>
              {s.title}
              <span className="visually-hidden">{state === 'done' ? ' (completed)' : state === 'current' ? ' (current)' : ' (upcoming)'}</span>
            </li>
          );
        })}
      </ol>
      <div className="toolbar-main">
        <div className="current-step">
          {current ? (
            <>
              <strong>
                Step {currentIndex + 1}: {current.title}
              </strong>
              <span className="hint"> {current.description}</span>
              {current.blockedReason && <div className="blocked-reason">{current.blockedReason}</div>}
            </>
          ) : (
            <strong>All steps complete. Review the results below, or reset demo data to start over.</strong>
          )}
        </div>
        {current && (
          <button type="button" className="primary" disabled={busy || current.blockedReason !== null} onClick={() => onRun(current)}>
            {busy ? 'Working…' : current.actionLabel}
          </button>
        )}
      </div>
      <div className="toolbar-secondary">{secondary}</div>
      {status && (
        <div className={`scenario-status status-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.text}
        </div>
      )}
    </div>
  );
}

// ---- Supplier email follow-up ----

/** The Case A request on the scenario's POs (latest first), with its call task if any. */
function caseARequest(data: ScenarioData, scenario: ScenarioCase): { request: OutreachRequestView | null; task: CallTaskView | null } {
  const detail = data.details[scenario.poIds[0]];
  const request = detail?.correspondence.find((r) => r.supplierName === scenario.supplierName) ?? null;
  const task = request ? (detail.callTasks.find((t) => t.requestId === request.id) ?? null) : null;
  return { request, task };
}

/** The processed inbound message for a reply fixture, if any. */
const messageByKey = (request: OutreachRequestView | null, key: string) =>
  request?.messages.find((m) => m.direction === 'inbound' && m.fixtureKey === key) ?? null;

function SupplierSecondary({
  data,
  scenario,
  onPreview,
  onMessage,
}: {
  data: ScenarioData;
  scenario: ScenarioCase;
  onPreview: (title: string, path: string) => void;
  onMessage: (title: string, m: SupplierMessageView) => void;
}) {
  const { request, task } = caseARequest(data, scenario);
  const sent = request?.messages.find((m) => m.direction === 'outbound') ?? null;
  const reply = messageByKey(request, 'case-a-reply-1');
  const clarification = messageByKey(request, 'case-a-reply-2');
  const installed = data.scenarios.fixturesInstalled;
  return (
    <>
      {sent ? (
        <EmailButton label="View sent email" onClick={() => onMessage('Sent request email', sent)} />
      ) : (
        <EmailButton
          label="Preview request email"
          disabled={!installed || scenario.supplierId === null}
          onClick={() => onPreview('Request email preview', `/demo/email-preview/request/${scenario.supplierId}`)}
        />
      )}
      {reply ? (
        <EmailButton label="View supplier reply" onClick={() => onMessage('Supplier reply', reply)} />
      ) : (
        <EmailButton label="Preview sample reply" disabled={!installed} onClick={() => onPreview('Sample supplier reply', '/demo/email-preview/reply/case-a-reply-1')} />
      )}
      {reply &&
        (clarification ? (
          <EmailButton label="View clarification email" onClick={() => onMessage('Supplier clarification', clarification)} />
        ) : (
          <EmailButton
            label="Preview sample clarification"
            onClick={() => onPreview('Sample clarification email', '/demo/email-preview/reply/case-a-reply-2')}
          />
        ))}
      <PoLinks data={data} scenario={scenario} />
      {task && (
        <Link className="secondary-link" to={`/purchase-orders/${scenario.poIds[0]}?tab=follow-ups`}>
          Call task #{task.id} · {CALL_TASK_STATE_LABELS[task.state]}
        </Link>
      )}
    </>
  );
}

function PoLinks({ data, scenario }: { data: ScenarioData; scenario: ScenarioCase }) {
  return (
    <span className="po-links">
      Affected POs:{' '}
      {scenario.poIds.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <Link to={`/purchase-orders/${id}`}>{data.details[id]?.po.number ?? `PO ${id}`}</Link>
        </span>
      ))}
    </span>
  );
}

type ItemStatus = 'Selected' | 'Confirmed' | 'Revised' | 'Needs clarification' | 'No reply';

function SupplierResults({ data, scenario, onMessage }: { data: ScenarioData; scenario: ScenarioCase; onMessage: (title: string, m: SupplierMessageView) => void }) {
  const { request, task } = caseARequest(data, scenario);
  const rowFor = (deliveryId: number) => data.rows.find((r) => r.deliveryId === deliveryId);
  const reply = messageByKey(request, 'case-a-reply-1');

  // Latest applied result per requested item, across every processed reply in order.
  const applied = new Map<number, { classification: string; date: string | null }>();
  for (const m of [...(request?.messages ?? [])].sort((a, b) => a.id - b.id)) {
    for (const r of m.results) if (r.outreachItemId !== null && r.appliedAt) applied.set(r.outreachItemId, { classification: r.classification, date: r.proposedDate });
  }
  const statusOf = (item: OutreachItemView): ItemStatus => {
    const a = applied.get(item.id);
    if (a) return a.classification === 'confirmed_arrival' ? 'Confirmed' : 'Revised';
    return item.responseState === 'needs_review' ? 'Needs clarification' : 'No reply';
  };
  const taskItem = (item: OutreachItemView) => task?.items.find((i) => i.id === item.id);

  const items = request
    ? request.items.map((i) => ({ key: i.deliveryId, poId: i.poId, label: `${i.poNumber} line ${i.lineNo}`, part: i.partNumber, qty: i.requestedQty, previous: i.expectedArrivalSnapshot, item: i }))
    : (data.preview.suppliers.find((s) => s.supplierId === scenario.supplierId)?.items ?? []).map((i) => ({
        key: i.deliveryId,
        poId: i.poId,
        label: `${i.poNumber} line ${i.lineNo}`,
        part: i.partNumber,
        qty: i.quantity,
        previous: i.expectedArrival,
        item: null,
      }));
  const counts = request ? request.items.map(statusOf).reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {}) : {};
  const requested = new Set(request?.items.map((i) => i.deliveryId) ?? []);
  const excluded = data.preview.excluded.filter((e) => e.supplierId === scenario.supplierId && !requested.has(e.deliveryId));

  return (
    <div className="scenario-results">
      <div className="results-heading">
        <h2>{request ? `Request #${request.id} · sent ${formatClock(request.sentAt)} · reply due ${formatClock(request.responseDueAt)}` : 'Selected items'}</h2>
        {reply && <EmailButton label="View supplier reply" onClick={() => onMessage('Supplier reply', reply)} />}
      </div>
      {request && (
        <p className="result-summary" data-testid="supplier-summary">
          {(['Confirmed', 'Revised', 'Needs clarification', 'No reply'] as const)
            .filter((s) => counts[s])
            .map((s) => `${s} ${counts[s]}`)
            .join(' · ')}
          {task ? ` · Call task #${task.id}: ${CALL_TASK_STATE_LABELS[task.state]}` : ''}
        </p>
      )}
      {items.length === 0 ? (
        <p className="empty">No items for this supplier are due for confirmation right now.</p>
      ) : (
        <table className="data-table supplier-items">
          <thead>
            <tr>
              <th>PO / line</th>
              <th>Part</th>
              <th className="num">Qty</th>
              <th>Previous arrival</th>
              <th>Confirmed / revised arrival</th>
              <th>Response status</th>
              <th>Purchasing action</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ key, poId, label, part, qty, previous, item }) => {
              const row = rowFor(key);
              const st: ItemStatus = item ? statusOf(item) : 'Selected';
              const t = item ? taskItem(item) : undefined;
              return (
                <tr key={key} data-delivery-id={key} className={st === 'Needs clarification' || st === 'No reply' ? 'needs-review-row' : undefined}>
                  <td className="nowrap">{label}</td>
                  <td className="nowrap">{part}</td>
                  <td className="num">{qty}</td>
                  <td className="nowrap">{formatDate(previous)}</td>
                  <td className="nowrap">{item && applied.get(item.id) ? formatDate(applied.get(item.id)!.date) : '—'}</td>
                  <td className={`nowrap status-${st.toLowerCase().replace(/ /g, '-')}`}>{st}</td>
                  <td>
                    {row?.issue && (
                      <Link to={`/purchase-orders/${poId}?item=${row.poLineId}`}>Delivery issue: {reasonList(row.issue.reasons)}</Link>
                    )}
                    {row?.issue && t && <br />}
                    {t && task && (
                      <Link to={`/purchase-orders/${poId}?tab=follow-ups`}>
                        Call task #{task.id}
                        {t.taskResponseState === 'answered' ? ' (answered)' : ''}
                      </Link>
                    )}
                    {!row?.issue && !t && '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {excluded.length > 0 && (
        <details className="scenario-section">
          <summary>Why other items weren’t contacted ({excluded.length})</summary>
          <table className="compact">
            <tbody>
              {excluded.map((e) => (
                <tr key={e.deliveryId}>
                  <td className="nowrap">
                    {e.poNumber} line {e.lineNo}
                  </td>
                  <td className="nowrap">{e.partNumber}</td>
                  <td>{EXCLUSION_LABELS[e.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function AllSuppliersPreview({ preview }: { preview: OutreachPreview }) {
  return (
    <details className="scenario-section">
      <summary>Outreach preview for all suppliers</summary>
      <table className="compact">
        <thead>
          <tr>
            <th>Supplier</th>
            <th className="num">Eligible items</th>
            <th>Sent this demo date</th>
          </tr>
        </thead>
        <tbody>
          {preview.suppliers.map((s) => (
            <tr key={s.supplierId}>
              <td>{s.supplierName}</td>
              <td className="num">{s.items.length}</td>
              <td>{s.sentToday ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Defaults: no confirmation within {preview.settings.staleBusinessDays} business days, at least {Math.round(preview.settings.elapsedThreshold * 100)}% of
        lead time used, reply window {preview.settings.responseWindowBusinessDays} business day (America/Chicago, weekdays), up to{' '}
        {preview.settings.itemCap} PO lines per email. Configurable starting values, not tuned findings.
      </p>
    </details>
  );
}

// ---- Carrier tracking updates ----

function CarrierResults({ data, scenario }: { data: ScenarioData; scenario: ScenarioCase }) {
  const tracked = data.rows.find((r) => r.shipment?.trackingNumber === 'DEMO-TRACK-001');
  const shipment = tracked?.shipment ?? null;
  const linked = shipment ? data.rows.filter((r) => r.shipment?.id === shipment.id) : [];
  const lineIds = new Set(linked.map((r) => r.poLineId));
  // The shipped portions plus any not-shipped remainder on the same items.
  const rows = data.rows
    .filter((r) => lineIds.has(r.poLineId) && (r.shipment?.id === shipment?.id || r.state === 'planned'))
    .sort((a, b) => a.poNumber.localeCompare(b.poNumber) || a.lineNo - b.lineNo || Number(a.state === 'planned') - Number(b.state === 'planned'));
  const details = scenario.poIds.map((id) => data.details[id]).filter(Boolean);
  const history = details.flatMap((d) => d.history);
  const previousArrival = (id: number) => {
    const change = history.filter((h) => h.deliveryId === id && h.eventType === 'arrival_updated').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return change ? ((change.before?.expectedArrival as string | null) ?? null) : undefined;
  };
  const lines = details.flatMap((d) => d.lines).filter((l) => lineIds.has(l.id));
  const shippedUnits = linked.reduce((s, r) => s + r.quantity, 0);
  const remainder = rows.filter((r) => r.state === 'planned');
  const events = details.flatMap((d) => d.carrierEvents).filter((e, i, all) => e.shipmentId === shipment?.id && all.findIndex((x) => x.id === e.id) === i);

  if (!shipment) return <p className="empty">The demo shipment is not in this dataset. Reset demo data to install it.</p>;
  return (
    <div className="scenario-results">
      <table className="compact context-table carrier-context">
        <tbody>
          <tr>
            <th scope="row">Carrier</th>
            <td>{shipment.carrier}</td>
            <th scope="row">Tracking number</th>
            <td>
              <span className="tracking-number">{shipment.trackingNumber}</span> · {shipment.number} (simulated)
            </td>
            <th scope="row">Carrier status</th>
            <td>{CARRIER_STATUS_LABELS[shipment.carrierStatus]}</td>
          </tr>
          <tr>
            <th scope="row">Carrier ETA</th>
            <td>{formatDate(shipment.expectedArrival)}</td>
            <th scope="row">Carrier delivered</th>
            <td>{shipment.carrierDeliveredAt ? formatClock(shipment.carrierDeliveredAt) : '—'}</td>
            <th scope="row">Warehouse received</th>
            <td data-testid="warehouse-received">
              {lines.reduce((s, l) => s + l.receivedQty, 0)} of {lines.reduce((s, l) => s + l.orderedQty, 0)} ordered
            </td>
          </tr>
        </tbody>
      </table>
      <p className="result-summary" data-testid="carrier-summary">
        On shipment: {linked.length} deliveries, {shippedUnits} units, open issues {linked.filter((r) => r.issue).length}
        {remainder.length > 0 &&
          ` · Not shipped: ${remainder.reduce((s, r) => s + r.quantity, 0)} units, expected ${remainder.map((r) => formatDate(r.expectedArrival)).join(', ')}`}
      </p>
      <table className="data-table carrier-items">
        <thead>
          <tr>
            <th>PO / line</th>
            <th className="num">Qty</th>
            <th>Shipment / state</th>
            <th>Previous arrival</th>
            <th>Current arrival</th>
            <th>Dock date</th>
            <th>Production start</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const prev = previousArrival(r.deliveryId);
            const onShipment = r.shipment?.id === shipment.id;
            return (
              <tr key={r.deliveryId} data-delivery-id={r.deliveryId} className={onShipment ? undefined : 'remainder-row'}>
                <td className="nowrap">
                  <Link to={`/purchase-orders/${r.poId}?item=${r.poLineId}`}>
                    {r.poNumber} line {r.lineNo}
                  </Link>
                </td>
                <td className="num">{r.quantity}</td>
                <td>
                  {onShipment ? (
                    <>
                      {shipment.number} · Carrier: {CARRIER_STATUS_LABELS[shipment.carrierStatus]} · Warehouse: {r.state === 'received' ? 'Received' : 'Not received'}
                    </>
                  ) : (
                    'Not shipped (no shipment)'
                  )}
                </td>
                <td className="nowrap">{prev === undefined ? '—' : formatDate(prev)}</td>
                <td>
                  <ArrivalDate row={r} />
                </td>
                <td>
                  <DateText date={r.requiredDock} />
                </td>
                <td>
                  <ProductionStartDate row={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {events.length > 0 && (
        <details className="scenario-section">
          <summary>Carrier event log ({events.length})</summary>
          <table className="compact">
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
                <tr key={e.id}>
                  <td className="nowrap">{formatClock(e.occurredAt)}</td>
                  <td>{e.status}</td>
                  <td className="nowrap">{formatDate(e.eta)}</td>
                  <td>
                    {e.appliedState.replace('_', ' ')}
                    {e.ignoredReason && <div className="hint">{e.ignoredReason}</div>}
                  </td>
                  <td className="hint nowrap">{e.externalEventId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

