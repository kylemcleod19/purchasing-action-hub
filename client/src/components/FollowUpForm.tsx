import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { formatDate } from '../../../shared/dates';
import type { FollowUp } from '../../../shared/types';
import { FormErrors } from './Labels';

export interface DeliveryOption {
  id: number;
  label: string;
}

/** Add or edit a follow-up. A follow-up records a task only; it never changes delivery dates. */
export function FollowUpForm({
  poId,
  poNumber,
  deliveries,
  defaultDeliveryId,
  defaultDueDate,
  existing,
  onSaved,
  onCancel,
}: {
  poId: number;
  poNumber: string;
  deliveries: DeliveryOption[];
  defaultDeliveryId: number | null;
  defaultDueDate: string;
  existing?: FollowUp;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [deliveryId, setDeliveryId] = useState<string>(String(existing ? (existing.deliveryId ?? '') : (defaultDeliveryId ?? '')));
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? defaultDueDate);
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setFields({});
    const delivery = deliveryId === '' ? null : Number(deliveryId);
    try {
      if (existing) {
        await api(`/follow-ups/${existing.id}`, {
          method: 'PATCH',
          body: { action: 'edit', version: existing.version, deliveryId: delivery, dueDate, note },
        });
      } else {
        await api(`/purchase-orders/${poId}/follow-ups`, { method: 'POST', body: { deliveryId: delivery, dueDate, note } });
      }
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
      <p className="hint">
        Follow-up for {poNumber}. No message is sent to the supplier; this records a task for you.
      </p>
      <FormErrors error={error} fields={fields} />
      <div className="field">
        <label htmlFor="fu-delivery">Delivery</label>
        <select id="fu-delivery" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)}>
          <option value="">Whole PO (no specific delivery)</option>
          {deliveries.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="fu-due">Due date</label>
        <input id="fu-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="fu-note">What to follow up on</label>
        <textarea id="fu-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required />
      </div>
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save follow-up' : 'Add follow-up'}
        </button>
      </div>
    </form>
  );
}

export function CompleteFollowUpForm({ followUp, onSaved, onCancel }: { followUp: FollowUp; onSaved: () => void; onCancel: () => void }) {
  const [completionNote, setCompletionNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/follow-ups/${followUp.id}`, {
        method: 'PATCH',
        body: { action: 'complete', version: followUp.version, completionNote },
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
      <p>
        <strong>{followUp.note}</strong> (due {formatDate(followUp.dueDate)})
      </p>
      <p className="hint">Completing a follow-up does not change expected arrivals or clear a delivery’s date risk.</p>
      <FormErrors error={error} fields={fields} />
      <div className="field">
        <label htmlFor="fu-completion">Completion note (optional)</label>
        <textarea
          id="fu-completion"
          rows={2}
          maxLength={500}
          value={completionNote}
          onChange={(e) => setCompletionNote(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Mark completed'}
        </button>
      </div>
    </form>
  );
}
