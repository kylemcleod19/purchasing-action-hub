// "Demo scenarios" page (PRD §13 "UI and acceptance additions"), linked beside Incoming items. Every control is labeled as
// a simulation: fixture playback stands in for supplier replies and carrier feeds, and nothing is sent.
// Each step calls a real, persisted server mutation; the pages reload afterward.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { EXCLUSION_LABELS, SIMULATION_LABEL } from '../../../shared/labels';
import type {
  DeliveryRow,
  IncomingResponse,
  OutreachPreview,
  PurchaseOrderDetail,
  ScenarioCase,
  ScenariosResponse,
  ScenarioStep,
} from '../../../shared/types';
import { CallTasksTable, CorrespondenceList } from '../components/Correspondence';
import { ArrivalDate, carrierStatusText, StateLabel, TrackingText } from '../components/Labels';

interface ScenarioData {
  scenarios: ScenariosResponse;
  preview: OutreachPreview;
  caseA: PurchaseOrderDetail | null;
  caseB: PurchaseOrderDetail | null;
  caseBRows: DeliveryRow[];
}

export function DemoScenariosPage() {
  const { dataVersion, refreshAll, meta } = useDemo();
  const [data, setData] = useState<ScenarioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [scenarios, preview, incoming] = await Promise.all([
        api<ScenariosResponse>('/demo/scenarios'),
        api<OutreachPreview>('/outreach/preview'),
        api<IncomingResponse>('/incoming'),
      ]);
      const [a, b] = scenarios.cases;
      const [caseA, caseB] = await Promise.all([
        a.poIds[0] ? api<PurchaseOrderDetail>(`/purchase-orders/${a.poIds[0]}`) : null,
        b.poIds[0] ? api<PurchaseOrderDetail>(`/purchase-orders/${b.poIds[0]}`) : null,
      ]);
      const demoShipment = incoming.rows.find((r) => r.shipment?.trackingNumber === 'DEMO-TRACK-001')?.shipment?.id;
      const linkedLines = new Set(incoming.rows.filter((r) => r.shipment?.id === demoShipment).map((r) => r.poLineId));
      const caseBRows = incoming.rows
        .filter((r) => demoShipment !== undefined && linkedLines.has(r.poLineId) && (r.shipment?.id === demoShipment || r.state === 'planned'))
        .sort((x, y) => x.poNumber.localeCompare(y.poNumber) || x.lineNo - y.lineNo || x.deliveryId - y.deliveryId);
      setData({ scenarios, preview, caseA, caseB, caseBRows });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the demo scenarios.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  async function run(c: ScenarioCase, step: ScenarioStep) {
    if (busy || !data) return;
    setBusy(true);
    setMessage(null);
    try {
      if (step.kind === 'send') {
        const supplier = data.preview.suppliers.find((s) => s.supplierId === c.supplierId);
        if (!supplier) throw new ApiRequestError(409, 'No eligible items for this supplier right now.');
        const r = await api<{ requestId: number; itemCount: number }>('/demo/outreach/send', {
          method: 'POST',
          body: { supplierId: supplier.supplierId, items: supplier.items.map((i) => ({ deliveryId: i.deliveryId, version: i.version })) },
        });
        setMessage(`Request #${r.requestId} created (simulated, not sent) with ${r.itemCount} items.`);
      } else if (step.kind === 'reply') {
        const r = await api<{ duplicate: boolean; applied: number; needsReview: number; notMentioned: number }>(`/demo/supplier-replies/${step.key}`, {
          method: 'POST',
        });
        setMessage(
          r.duplicate
            ? 'This reply was already processed; nothing changed.'
            : `Reply processed: ${r.applied} applied, ${r.needsReview} need review, ${r.notMentioned} not mentioned.`,
        );
      } else if (step.kind === 'carrier') {
        const r = await api<{ duplicate: boolean; appliedState: string; updated: number; held: number }>(`/demo/carrier-events/${step.key}`, { method: 'POST' });
        setMessage(
          r.duplicate
            ? 'Duplicate event ID; nothing changed.'
            : r.appliedState === 'ignored'
              ? 'Older event recorded as ignored; current estimates kept.'
              : `Carrier event ${r.appliedState.replace('_', ' ')}: ${r.updated} deliveries updated${r.held ? `, ${r.held} held for review` : ''}.`,
        );
      } else {
        const r = await api<{ demoClock: string; issuesChanged: number; callTasksCreated: number }>('/demo/advance-clock', {
          method: 'POST',
          body: { step: step.key },
        });
        setMessage(`Demo clock is now ${formatClock(r.demoClock)}. ${r.issuesChanged} issue changes; ${r.callTasksCreated} call tasks created.`);
      }
      refreshAll();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'That step failed. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  const [caseA, caseB] = data?.scenarios.cases ?? [];
  const aSupplier = data && caseA ? data.preview.suppliers.find((s) => s.supplierId === caseA.supplierId) : undefined;
  const aExcluded = data && caseA ? data.preview.excluded.filter((e) => e.supplierId === caseA.supplierId) : [];
  const caseARequests = data?.caseA?.correspondence.slice(0, 1) ?? [];
  const caseATasks = data?.caseA?.callTasks ?? [];
  const caseBEvents = data?.caseB?.carrierEvents.filter((e) => e.externalEventId.startsWith('EVT-DEMO-TRACK-001')) ?? [];

  // Simulation controls exist only in DEMO_MODE.
  if (meta && !meta.demoMode) return <p className="empty">Demo scenarios are not available on this deployment.</p>;

  return (
    <section className="scenarios-page" aria-label="Demo scenarios">
      <div className="page-heading">
        <h1>Demo scenarios</h1>
      </div>
      <p className="hint">
        <strong>{SIMULATION_LABEL}.</strong> Deterministic fixtures stand in for supplier email and carrier feeds; nothing is sent and no AI runs.
        The fixtures show workflow behavior, not extraction accuracy.
      </p>
      {data && (
        <p className="scenario-clock">
          Demo clock: <strong>{formatClock(data.scenarios.demoClock)}</strong> (moves only forward)
        </p>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="flash flash-success" role="status">
          {message}
        </div>
      )}
      {data && !data.scenarios.fixturesInstalled && <p className="seed-notice">This data predates the scenarios. Reset demo data to install them.</p>}

      <div className="scenario-grid">
      {caseA && (
        <section className="scenario" aria-label={caseA.title}>
          <h3>{caseA.title}</h3>
          <p className="hint">{caseA.summary}</p>
          <h4>Outreach preview: {caseA.supplierName}</h4>
          {aSupplier ? (
            <table className="compact">
              <caption>Eligible (ranked; up to {data!.preview.settings.itemCap} PO lines per email)</caption>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th>Expected</th>
                  <th>Last update</th>
                  <th className="num">Lead time used</th>
                </tr>
              </thead>
              <tbody>
                {aSupplier.items.map((i) => (
                  <tr key={i.deliveryId}>
                    <td className="nowrap">
                      {i.poNumber} line {i.lineNo}
                    </td>
                    <td className="num">{i.quantity}</td>
                    <td className="nowrap">{formatDate(i.expectedArrival)}</td>
                    <td className="nowrap">{i.lastUpdateAt ? formatDate(i.lastUpdateAt.slice(0, 10)) : '—'}</td>
                    <td className="num">{i.elapsedFraction === null ? '—' : `${Math.round(i.elapsedFraction * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">No eligible items for this supplier right now.</p>
          )}
          {aExcluded.length > 0 && (
            <table className="compact">
              <caption>Excluded</caption>
              <tbody>
                {aExcluded.map((e) => (
                  <tr key={e.deliveryId}>
                    <td className="nowrap">
                      {e.poNumber} line {e.lineNo}
                    </td>
                    <td>{EXCLUSION_LABELS[e.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <StepList c={caseA} busy={busy} onRun={run} />
          {caseATasks.length > 0 && <CallTasksTable tasks={caseATasks} />}
          {caseARequests.length > 0 && <CorrespondenceList requests={caseARequests} />}
        </section>
      )}

      {caseB && (
        <section className="scenario" aria-label={caseB.title}>
          <h3>{caseB.title}</h3>
          <p className="hint">{caseB.summary}</p>
          <table className="compact">
            <caption>Linked deliveries and untouched remainder</caption>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th>State</th>
                <th>Tracking</th>
                <th>Expected</th>
                <th>Carrier status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.caseBRows ?? []).map((r) => (
                <tr key={r.deliveryId}>
                  <td className="nowrap">
                    {r.poNumber} line {r.lineNo}
                  </td>
                  <td className="num">{r.quantity}</td>
                  <td className="nowrap">
                    <StateLabel state={r.state} />
                  </td>
                  <td className="nowrap">
                    <TrackingText row={r} />
                  </td>
                  <td>
                    <ArrivalDate row={r} />
                  </td>
                  <td className="nowrap">{carrierStatusText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <StepList c={caseB} busy={busy} onRun={run} />
          {caseBEvents.length > 0 && (
            <table className="compact">
              <caption>Processed carrier events</caption>
              <tbody>
                {caseBEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{formatClock(e.occurredAt)}</td>
                    <td>{e.status}</td>
                    <td className="nowrap">{e.eta ? formatDate(e.eta) : '—'}</td>
                    <td>
                      {e.appliedState.replace('_', ' ')}
                      {e.ignoredReason && <div className="hint">{e.ignoredReason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      </div>

      {data && (
        <details className="scenario">
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
              {data.preview.suppliers.map((s) => (
                <tr key={s.supplierId}>
                  <td>{s.supplierName}</td>
                  <td className="num">{s.items.length}</td>
                  <td>{s.sentToday ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Defaults: no confirmation within {data.preview.settings.staleBusinessDays} business days, at least{' '}
            {Math.round(data.preview.settings.elapsedThreshold * 100)}% of lead time used, reply window {data.preview.settings.responseWindowBusinessDays}{' '}
            business day (America/Chicago, weekdays). These are configurable starting values, not tuned findings.
          </p>
        </details>
      )}
    </section>
  );
}

function StepList({ c, busy, onRun }: { c: ScenarioCase; busy: boolean; onRun: (c: ScenarioCase, s: ScenarioStep) => void }) {
  return (
    <ol className="steps">
      {c.steps.map((s) => (
        <li key={s.key} className={s.done ? 'done' : undefined}>
          <button type="button" className="small" disabled={busy || s.blockedReason !== null} onClick={() => onRun(c, s)}>
            {s.label}
          </button>
          {s.done && <span className="ok-text"> ✓ done</span>}
          {s.blockedReason && !s.done && <span className="hint"> {s.blockedReason}</span>}
        </li>
      ))}
    </ol>
  );
}
