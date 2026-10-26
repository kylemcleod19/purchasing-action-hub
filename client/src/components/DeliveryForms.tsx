// Update arrival, split, and resolve forms (PRD §7). Each submits one request. "Save and resolve issue"
// sends the disposition with the edit so the server applies both atomically.
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiRequestError } from '../api';
import { useDemo } from '../demo';
import { meetsDateRestored, physicalRisk } from '../../../shared/impact';
import { OUTCOME_LABELS, SOURCE_LABELS } from '../../../shared/labels';
import { UPDATE_SOURCES, type DeliveryRow, type ResolutionOutcome } from '../../../shared/types';
import { ArrivalDate, DateText, FormErrors, ProductionStartDate, reasonList, StateLabel } from './Labels';

export interface SaveResult {
  message: string;
}

interface MutationResponse {
  deliveries: DeliveryRow[];
}

/** Message after a save, calling out any issue the change opened (shown inline right away). */
function savedMessage(base: string, before: DeliveryRow, after: DeliveryRow[]): string {
  const opened = after.filter((d) => d.issue && d.issue.id !== before.issue?.id);
  if (opened.length === 0) return base;
  return `${base} New issue opened: ${reasonList(opened[0].issue!.reasons)}.`;
}

function useSubmit() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run<T>(request: () => Promise<T>): Promise<T | null> {
    if (saving) return null;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      return await request();
    } catch (err) {
      const apiErr = err instanceof ApiRequestError ? err : new ApiRequestError(0, 'Save failed.');
      setError(apiErr.message);
      setFields(apiErr.fields);
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, fields, run };
}

export function DeliveryContext({ delivery }: { delivery: DeliveryRow }) {
  return (
    <table className="compact context-table">
      <tbody>
        <tr>
          <th scope="row">PO</th>
          <td>
            {delivery.poNumber} · line {delivery.lineNo} · #{delivery.deliveryId}
          </td>
          <th scope="row">Supplier</th>
          <td>{delivery.supplierName}</td>
        </tr>
        <tr>
          <th scope="row">Part</th>
          <td>
            {delivery.partNumber} — {delivery.description}
          </td>
          <th scope="row">Quantity</th>
          <td>
            {delivery.quantity} {delivery.unit} · <StateLabel state={delivery.state} />
          </td>
        </tr>
        <tr>
          <th scope="row">Work order</th>
          <td>
            {delivery.workOrderNumber} · {delivery.program}
          </td>
          <th scope="row">Issue</th>
          <td>{delivery.issue ? `Open: ${reasonList(delivery.issue.reasons)}` : '—'}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Current vs. proposed dates as a table: risk icons show the comparison, no prose. */
function DatesPreview({ delivery, proposed }: { delivery: DeliveryRow; proposed: (string | null)[] }) {
  const { meta } = useDemo();
  const demoDate = meta?.demoDate ?? '';
  const rows = [
    { label: 'Current', arrival: delivery.expectedArrival, quantity: delivery.quantity },
    ...proposed.map((arrival, i) => ({ label: proposed.length > 1 ? `Delivery ${i + 1}` : 'After save', arrival, quantity: undefined })),
  ];
  return (
    <table className="compact">
      <thead>
        <tr>
          <th></th>
          <th>Required dock</th>
          <th>Expected arrival</th>
          <th>Production start</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const facts = { ...delivery, expectedArrival: r.arrival };
          const preview = { ...facts, risk: physicalRisk(facts, demoDate) };
          return (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>
                <DateText date={delivery.requiredDock} />
              </td>
              <td>
                <ArrivalDate row={preview} />
              </td>
              <td>
                <ProductionStartDate row={preview} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SourceSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Choose…</option>
      {UPDATE_SOURCES.map((s) => (
        <option key={s} value={s}>
          {SOURCE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

function ResolutionFields({
  outcomes,
  outcome,
  setOutcome,
  note,
  setNote,
  dateRestoredValid,
  legend,
}: {
  outcomes: ResolutionOutcome[];
  outcome: ResolutionOutcome;
  setOutcome: (o: ResolutionOutcome) => void;
  note: string;
  setNote: (n: string) => void;
  dateRestoredValid: boolean;
  legend: ReactNode;
}) {
  return (
    <fieldset className="resolution">
      <legend>{legend}</legend>
      <div className="field">
        <label htmlFor="resolution-outcome">Outcome</label>
        <select id="resolution-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as ResolutionOutcome)}>
          {outcomes.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
        {outcome === 'date_restored' && !dateRestoredValid && (
          <span className="field-warning">Date restored needs an arrival on or before the required dock date that is not overdue.</span>
        )}
      </div>
      <div className="field">
        <label htmlFor="resolution-note">Resolution note (optional)</label>
        <textarea id="resolution-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </fieldset>
  );
}

export function ArrivalForm({ delivery, onSaved, onCancel }: { delivery: DeliveryRow; onSaved: (r: SaveResult) => void; onCancel: () => void }) {
  const { meta } = useDemo();
  const [unknown, setUnknown] = useState(delivery.expectedArrival === null);
  const [date, setDate] = useState(delivery.expectedArrival ?? '');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<ResolutionOutcome>('accepted_delay');
  const [resolutionNote, setResolutionNote] = useState('');
  const { saving, error, fields, run } = useSubmit();
  const proposed = unknown ? null : date || null;
  const dateRestoredValid = meetsDateRestored({ ...delivery, expectedArrival: proposed }, meta?.demoDate ?? '');

  async function submit(e: FormEvent, resolve: boolean) {
    e.preventDefault();
    const issue = delivery.issue;
    const result = await run(() =>
      api<MutationResponse>(`/deliveries/${delivery.deliveryId}`, {
        method: 'PATCH',
        body: {
          expectedArrival: proposed,
          source,
          note,
          version: delivery.version,
          resolve:
            resolve && issue ? { issueId: issue.id, expectedIssueVersion: issue.version, outcome, note: resolutionNote } : undefined,
        },
      }),
    );
    if (result) onSaved({ message: savedMessage(resolve ? 'Arrival saved and issue resolved.' : 'Expected arrival saved.', delivery, result.deliveries) });
  }

  const missingDate = !unknown && !date;
  return (
    <form onSubmit={(e) => submit(e, false)} className="form">
      <DeliveryContext delivery={delivery} />
      <FormErrors error={error} fields={fields} />
      <div className="field">
        <label htmlFor="arrival-date">New expected arrival</label>
        <div className="inline">
          <input id="arrival-date" type="date" value={date} disabled={unknown} onChange={(e) => setDate(e.target.value)} />
          <label className="checkbox">
            <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} /> Date unknown
          </label>
        </div>
      </div>
      <DatesPreview delivery={delivery} proposed={[proposed]} />
      <div className="field">
        <label htmlFor="arrival-source">Source</label>
        <SourceSelect id="arrival-source" value={source} onChange={setSource} />
      </div>
      <div className="field">
        <label htmlFor="arrival-note">Note (optional)</label>
        <textarea id="arrival-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {delivery.issue && (
        <ResolutionFields
          legend="Resolve with this update (Save and resolve issue)"
          outcomes={['accepted_delay', 'date_restored', 'reviewed']}
          outcome={outcome}
          setOutcome={setOutcome}
          note={resolutionNote}
          setNote={setResolutionNote}
          dateRestoredValid={dateRestoredValid}
        />
      )}
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={delivery.issue ? undefined : 'primary'} disabled={saving || missingDate}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {delivery.issue && (
          <button
            type="button"
            className="primary"
            disabled={saving || missingDate || (outcome === 'date_restored' && !dateRestoredValid)}
            onClick={(e) => submit(e, true)}
          >
            Save and resolve issue
          </button>
        )}
      </div>
    </form>
  );
}

interface PartState {
  quantity: string;
  date: string;
  unknown: boolean;
}

const toInt = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : NaN);

/** Split a not-shipped delivery into dated quantities. Children keep the PO item and work order. */
export function SplitForm({ delivery, onSaved, onCancel }: { delivery: DeliveryRow; onSaved: (r: SaveResult) => void; onCancel: () => void }) {
  const { meta } = useDemo();
  const [parts, setParts] = useState<PartState[]>([
    { quantity: String(delivery.quantity), date: delivery.expectedArrival ?? '', unknown: delivery.expectedArrival === null },
    { quantity: '', date: '', unknown: false },
  ]);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<ResolutionOutcome>('split_agreed');
  const [resolutionNote, setResolutionNote] = useState('');
  const { saving, error, fields, run } = useSubmit();

  const update = (index: number, patch: Partial<PartState>) => setParts((ps) => ps.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const quantities = parts.map((p) => toInt(p.quantity));
  const total = quantities.reduce((s, q) => s + (Number.isNaN(q) ? 0 : q), 0);
  const arrivals = parts.map((p) => (p.unknown || !p.date ? null : p.date));
  const dateRestoredValid = arrivals.every((a) => meetsDateRestored({ ...delivery, expectedArrival: a }, meta?.demoDate ?? ''));

  const problems: string[] = [];
  if (quantities.some((q) => Number.isNaN(q) || q <= 0)) problems.push('Each delivery needs a positive whole-number quantity.');
  if (total !== delivery.quantity) problems.push(`Quantities total ${total}; they must total ${delivery.quantity}.`);
  if (parts.some((p) => !p.unknown && !p.date)) problems.push('Each delivery needs an expected arrival or “Date unknown”.');

  async function submit(e: FormEvent, resolve: boolean) {
    e.preventDefault();
    if (problems.length > 0) return;
    const issue = delivery.issue;
    const result = await run(() =>
      api<MutationResponse>(`/deliveries/${delivery.deliveryId}/split`, {
        method: 'POST',
        body: {
          version: delivery.version,
          source,
          note,
          parts: parts.map((_, i) => ({ quantity: quantities[i], expectedArrival: arrivals[i] })),
          resolve:
            resolve && issue ? { issueId: issue.id, expectedIssueVersion: issue.version, outcome, note: resolutionNote } : undefined,
        },
      }),
    );
    if (result) onSaved({ message: savedMessage(resolve ? 'Split saved and issue resolved.' : 'Split saved.', delivery, result.deliveries) });
  }

  return (
    <form onSubmit={(e) => submit(e, false)} className="form">
      <DeliveryContext delivery={delivery} />
      <FormErrors error={error} fields={fields} />
      <table className="grid-table">
        <thead>
          <tr>
            <th scope="col">Delivery</th>
            <th scope="col" className="num">
              Quantity
            </th>
            <th scope="col">Expected arrival</th>
            <th scope="col">Required dock</th>
            <th scope="col">Production start</th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p, i) => {
            const facts = { ...delivery, state: 'planned' as const, expectedArrival: arrivals[i] };
            const preview = { ...facts, risk: physicalRisk(facts, meta?.demoDate ?? '') };
            return (
              <tr key={i}>
                <th scope="row">Delivery {i + 1}</th>
                <td>
                  <input
                    aria-label={`Delivery ${i + 1} quantity`}
                    inputMode="numeric"
                    className="qty-input"
                    value={p.quantity}
                    onChange={(e) => update(i, { quantity: e.target.value })}
                  />
                </td>
                <td>
                  <div className="inline">
                    <input
                      aria-label={`Delivery ${i + 1} expected arrival`}
                      type="date"
                      value={p.date}
                      disabled={p.unknown}
                      onChange={(e) => update(i, { date: e.target.value })}
                    />
                    <label className="checkbox small">
                      <input type="checkbox" checked={p.unknown} onChange={(e) => update(i, { unknown: e.target.checked })} /> Unknown
                    </label>
                    {(p.unknown || p.date) && <ArrivalDate row={preview} />}
                  </div>
                </td>
                <td>
                  <DateText date={delivery.requiredDock} />
                </td>
                <td>
                  <ProductionStartDate row={preview} />
                </td>
                <td>
                  {parts.length > 2 && (
                    <button
                      type="button"
                      className="link-button small"
                      onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
                      aria-label={`Remove delivery ${i + 1}`}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className={`num${total !== delivery.quantity ? ' warn' : ''}`}>
              {total} / {delivery.quantity}
            </td>
            <td colSpan={4}></td>
          </tr>
        </tfoot>
      </table>
      <button
        type="button"
        className="link-button"
        onClick={() => setParts((ps) => [...ps, { quantity: '', date: '', unknown: false }])}
        disabled={parts.length >= 10}
      >
        + Add another delivery
      </button>
      {problems.length > 0 && (
        <ul className="problems" aria-live="polite">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="field">
        <label htmlFor="split-source">Source</label>
        <SourceSelect id="split-source" value={source} onChange={setSource} />
      </div>
      <div className="field">
        <label htmlFor="split-note">Note (optional)</label>
        <textarea id="split-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {delivery.issue && (
        <ResolutionFields
          legend="Resolve with this split (Save and resolve issue)"
          outcomes={['split_agreed', 'accepted_delay', 'date_restored', 'reviewed']}
          outcome={outcome}
          setOutcome={setOutcome}
          note={resolutionNote}
          setNote={setResolutionNote}
          dateRestoredValid={dateRestoredValid}
        />
      )}
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={delivery.issue ? undefined : 'primary'} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {delivery.issue && (
          <button
            type="button"
            className="primary"
            disabled={saving || problems.length > 0 || (outcome === 'date_restored' && !dateRestoredValid)}
            onClick={(e) => submit(e, true)}
          >
            Save and resolve issue
          </button>
        )}
      </div>
    </form>
  );
}

/** Resolve the open issue without changing dates. Accepted delay is the default inline action. */
export function ResolveForm({ delivery, onSaved, onCancel }: { delivery: DeliveryRow; onSaved: (r: SaveResult) => void; onCancel: () => void }) {
  const { meta } = useDemo();
  const [outcome, setOutcome] = useState<ResolutionOutcome>('accepted_delay');
  const [note, setNote] = useState('');
  const { saving, error, fields, run } = useSubmit();
  const issue = delivery.issue!;
  const dateRestoredValid = meetsDateRestored(delivery, meta?.demoDate ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = await run(() =>
      api<MutationResponse>(`/deliveries/${delivery.deliveryId}/resolve`, {
        method: 'POST',
        body: { issueId: issue.id, expectedIssueVersion: issue.version, expectedDeliveryVersion: delivery.version, outcome, note },
      }),
    );
    if (result) onSaved({ message: `Issue resolved: ${OUTCOME_LABELS[outcome]}.` });
  }

  return (
    <form onSubmit={submit} className="form">
      <DeliveryContext delivery={delivery} />
      <DatesPreview delivery={delivery} proposed={[]} />
      <p className="hint">Resolving records your decision. Dates and date warnings stay as they are.</p>
      <FormErrors error={error} fields={fields} />
      <ResolutionFields
        legend="Resolution"
        outcomes={['accepted_delay', 'date_restored', 'reviewed']}
        outcome={outcome}
        setOutcome={setOutcome}
        note={note}
        setNote={setNote}
        dateRestoredValid={dateRestoredValid}
      />
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving || (outcome === 'date_restored' && !dateRestoredValid)}>
          {saving ? 'Saving…' : outcome === 'accepted_delay' ? 'Accept delay and resolve' : 'Resolve issue'}
        </button>
      </div>
    </form>
  );
}
