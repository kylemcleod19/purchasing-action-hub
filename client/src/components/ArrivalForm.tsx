import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { formatDate } from '../../../shared/dates';
import { SOURCE_LABELS } from '../../../shared/labels';
import { UPDATE_SOURCES, type DeliveryRow } from '../../../shared/types';
import { FormErrors, LinkStatusLabel } from './Labels';

export function DeliveryContext({ delivery }: { delivery: DeliveryRow }) {
  return (
    <dl className="context">
      <div>
        <dt>PO</dt>
        <dd>
          {delivery.poNumber} · line {delivery.lineNo}
        </dd>
      </div>
      <div>
        <dt>Supplier</dt>
        <dd>{delivery.supplierName}</dd>
      </div>
      <div>
        <dt>Part</dt>
        <dd>
          {delivery.partNumber} — {delivery.description}
        </dd>
      </div>
      <div>
        <dt>Delivery quantity</dt>
        <dd>
          {delivery.quantity} {delivery.unit}
        </dd>
      </div>
      <div>
        <dt>Current expected arrival</dt>
        <dd>{delivery.expectedArrival ? formatDate(delivery.expectedArrival) : 'Date unknown'}</dd>
      </div>
      <div>
        <dt>Linked production starts</dt>
        <dd>
          {delivery.affected.length === 0
            ? 'No linked work orders'
            : delivery.affected.map((a) => (
                <span key={a.workOrderLinkId} className="nowrap">
                  {a.number} ({a.quantity}) {formatDate(a.productionStart)} <LinkStatusLabel status={a.status} />
                  <br />
                </span>
              ))}
        </dd>
      </div>
    </dl>
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

export function ArrivalForm({ delivery, onSaved, onCancel }: { delivery: DeliveryRow; onSaved: () => void; onCancel: () => void }) {
  const [unknown, setUnknown] = useState(delivery.expectedArrival === null);
  const [date, setDate] = useState(delivery.expectedArrival ?? '');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!unknown && !date) {
      setError('Check the highlighted fields.');
      setFields({ expectedArrival: 'Enter a date or mark the arrival as unknown.' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    try {
      await api(`/deliveries/${delivery.deliveryId}`, {
        method: 'PATCH',
        body: { expectedArrival: unknown ? null : date, source, note, version: delivery.version },
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
      <p className="hint">Applies only to this delivery quantity. Production start dates are not changed.</p>
      <FormErrors error={error} fields={fields} />
      <div className="field">
        <label htmlFor="arrival-date">New expected arrival</label>
        <div className="inline">
          <input
            id="arrival-date"
            type="date"
            value={date}
            disabled={unknown}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={!!fields.expectedArrival}
          />
          <label className="checkbox">
            <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} /> Date unknown
          </label>
        </div>
      </div>
      <div className="field">
        <label htmlFor="arrival-source">Source</label>
        <SourceSelect id="arrival-source" value={source} onChange={setSource} />
        <span className="hint">Records where the information came from. It is not independently verified.</span>
      </div>
      <div className="field">
        <label htmlFor="arrival-note">Note</label>
        <textarea id="arrival-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required />
      </div>
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save arrival update'}
        </button>
      </div>
    </form>
  );
}
