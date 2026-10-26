import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { formatDate } from '../../../shared/dates';
import { dateStatus } from '../../../shared/impact';
import type { DeliveryRow } from '../../../shared/types';
import { DeliveryContext, SourceSelect } from './ArrivalForm';
import { DateStatusLabel, FormErrors } from './Labels';

interface PartState {
  quantity: string;
  date: string;
  unknown: boolean;
}

const toInt = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : NaN);

/** Split a planned delivery into dated quantities. Every part keeps the PO's single work order. */
export function SplitForm({ delivery, onSaved, onCancel }: { delivery: DeliveryRow; onSaved: () => void; onCancel: () => void }) {
  const [parts, setParts] = useState<PartState[]>([
    { quantity: String(delivery.quantity), date: delivery.expectedArrival ?? '', unknown: delivery.expectedArrival === null },
    { quantity: '', date: '', unknown: false },
  ]);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const update = (index: number, patch: Partial<PartState>) =>
    setParts((ps) => ps.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const quantities = parts.map((p) => toInt(p.quantity));
  const total = quantities.reduce((s, q) => s + (Number.isNaN(q) ? 0 : q), 0);

  const problems: string[] = [];
  if (quantities.some((q) => Number.isNaN(q) || q <= 0)) problems.push('Each delivery needs a positive whole-number quantity.');
  if (total !== delivery.quantity) problems.push(`Quantities total ${total}; they must total ${delivery.quantity}.`);
  if (parts.some((p) => !p.unknown && !p.date)) problems.push('Each delivery needs an expected arrival or “Date unknown”.');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || problems.length > 0) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      await api(`/deliveries/${delivery.deliveryId}/split`, {
        method: 'POST',
        body: {
          version: delivery.version,
          source,
          note,
          parts: parts.map((p, i) => ({ quantity: quantities[i], expectedArrival: p.unknown ? null : p.date })),
        },
      });
      onSaved();
    } catch (err) {
      const apiErr = err instanceof ApiRequestError ? err : new ApiRequestError(0, 'Save failed.');
      setError(apiErr.message);
      setFields(apiErr.fields);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <DeliveryContext delivery={delivery} />
      <p className="hint">
        Splitting records an agreed delivery schedule. All deliveries stay on this PO item and its work order
        {` ${delivery.workOrderNumber}`}; the ordered quantity does not change.
      </p>
      <FormErrors error={error} fields={fields} />

      <table className="grid-table">
        <thead>
          <tr>
            <th scope="col">Delivery</th>
            <th scope="col">Quantity</th>
            <th scope="col">Expected arrival</th>
            <th scope="col">Production start</th>
            <th scope="col">Date impact</th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p, i) => {
            const arrival = p.unknown || !p.date ? null : p.date;
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
                      <input type="checkbox" checked={p.unknown} onChange={(e) => update(i, { unknown: e.target.checked })} /> Date
                      unknown
                    </label>
                  </div>
                </td>
                <td className="nowrap">{formatDate(delivery.productionStart)}</td>
                <td>
                  {p.unknown || p.date ? <DateStatusLabel status={dateStatus('planned', arrival, delivery.productionStart)} /> : '—'}
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
              {total} of {delivery.quantity}
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
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : 'Save split'}
        </button>
      </div>
    </form>
  );
}
