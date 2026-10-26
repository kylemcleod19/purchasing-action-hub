import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { formatDate } from '../../../shared/dates';
import { linkStatus } from '../../../shared/impact';
import type { DeliveryRow } from '../../../shared/types';
import { DeliveryContext, SourceSelect } from './ArrivalForm';
import { FormErrors, LinkStatusLabel } from './Labels';

interface PartState {
  quantity: string;
  date: string;
  unknown: boolean;
  links: Record<number, string>;
}

const toInt = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : NaN);

/**
 * Split a planned delivery into dated quantities. Work-order assignment is always explicit when
 * more than one work order is linked; the form never decides which work order gets the earlier date.
 */
export function SplitForm({ delivery, onSaved, onCancel }: { delivery: DeliveryRow; onSaved: () => void; onCancel: () => void }) {
  const links = delivery.affected;
  // With a single work-order link that covers the whole delivery, each part's quantity is its assignment.
  const autoAssign = links.length === 1 && links[0].quantity === delivery.quantity;
  const showGrid = links.length > 0 && !autoAssign;

  const [parts, setParts] = useState<PartState[]>([
    { quantity: String(delivery.quantity), date: delivery.expectedArrival ?? '', unknown: delivery.expectedArrival === null, links: {} },
    { quantity: '', date: '', unknown: false, links: {} },
  ]);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const update = (index: number, patch: Partial<PartState>) =>
    setParts((ps) => ps.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const setLink = (index: number, linkId: number, value: string) =>
    setParts((ps) => ps.map((p, i) => (i === index ? { ...p, links: { ...p.links, [linkId]: value } } : p)));

  const quantities = parts.map((p) => toInt(p.quantity));
  const assignment = (part: PartState, index: number, linkId: number) =>
    autoAssign ? quantities[index] || 0 : toInt(part.links[linkId] || '0') || 0;
  const total = quantities.reduce((s, q) => s + (Number.isNaN(q) ? 0 : q), 0);

  const problems: string[] = [];
  if (quantities.some((q) => Number.isNaN(q) || q <= 0)) problems.push('Each delivery needs a positive whole-number quantity.');
  if (total !== delivery.quantity) problems.push(`Quantities total ${total}; they must total ${delivery.quantity}.`);
  if (parts.some((p) => !p.unknown && !p.date)) problems.push('Each delivery needs an expected arrival or “Date unknown”.');
  if (showGrid) {
    for (const link of links) {
      const assigned = parts.reduce((s, p, i) => s + assignment(p, i, link.workOrderLinkId), 0);
      if (assigned !== link.quantity) problems.push(`${link.number}: assign ${link.quantity} (currently ${assigned}).`);
    }
    parts.forEach((p, i) => {
      const assigned = links.reduce((s, l) => s + assignment(p, i, l.workOrderLinkId), 0);
      if (!Number.isNaN(quantities[i]) && assigned > quantities[i]) {
        problems.push(`Delivery ${i + 1}: assigned ${assigned} exceeds its quantity ${quantities[i]}.`);
      }
    });
  }

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
          parts: parts.map((p, i) => ({
            quantity: quantities[i],
            expectedArrival: p.unknown ? null : p.date,
            links: links.map((l) => ({ workOrderLinkId: l.workOrderLinkId, quantity: assignment(p, i, l.workOrderLinkId) })),
          })),
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
        Splitting records an agreed delivery schedule. It keeps the PO item total and each work order’s committed quantity;
        it does not move demand between POs.
      </p>
      <FormErrors error={error} fields={fields} />

      <table className="grid-table">
        <thead>
          <tr>
            <th></th>
            {parts.map((_, i) => (
              <th key={i}>
                Delivery {i + 1}
                {parts.length > 2 && (
                  <button
                    type="button"
                    className="link-button small"
                    onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
                    aria-label={`Remove delivery ${i + 1}`}
                  >
                    remove
                  </button>
                )}
              </th>
            ))}
            {showGrid && <th>Remaining</th>}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Quantity</th>
            {parts.map((p, i) => (
              <td key={i}>
                <input
                  aria-label={`Delivery ${i + 1} quantity`}
                  inputMode="numeric"
                  className="qty-input"
                  value={p.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                />
              </td>
            ))}
            {showGrid && <td className="num">{delivery.quantity - total}</td>}
          </tr>
          <tr>
            <th scope="row">Expected arrival</th>
            {parts.map((p, i) => (
              <td key={i}>
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
              </td>
            ))}
            {showGrid && <td></td>}
          </tr>
          {showGrid &&
            links.map((l) => {
              const assigned = parts.reduce((s, p, i) => s + assignment(p, i, l.workOrderLinkId), 0);
              return (
                <tr key={l.workOrderLinkId}>
                  <th scope="row">
                    {l.number}
                    <div className="hint">
                      {l.quantity} committed · starts {formatDate(l.productionStart)}
                    </div>
                  </th>
                  {parts.map((p, i) => (
                    <td key={i}>
                      <input
                        aria-label={`Delivery ${i + 1} quantity for ${l.number}`}
                        inputMode="numeric"
                        className="qty-input"
                        placeholder="0"
                        value={p.links[l.workOrderLinkId] ?? ''}
                        onChange={(e) => setLink(i, l.workOrderLinkId, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className={`num${assigned !== l.quantity ? ' warn' : ''}`}>{l.quantity - assigned}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      <button
        type="button"
        className="link-button"
        onClick={() => setParts((ps) => [...ps, { quantity: '', date: '', unknown: false, links: {} }])}
        disabled={parts.length >= 10}
      >
        + Add another delivery
      </button>

      <h3>Preview</h3>
      {links.length === 0 ? (
        <p className="hint">No linked work orders, so there is no production-start impact to preview.</p>
      ) : (
        <table className="compact">
          <thead>
            <tr>
              <th>Delivery</th>
              <th>Work order</th>
              <th className="num">Qty</th>
              <th>Expected arrival</th>
              <th>Production start</th>
              <th>Date impact</th>
            </tr>
          </thead>
          <tbody>
            {parts.flatMap((p, i) =>
              links
                .filter((l) => assignment(p, i, l.workOrderLinkId) > 0)
                .map((l) => {
                  const arrival = p.unknown || !p.date ? null : p.date;
                  return (
                    <tr key={`${i}-${l.workOrderLinkId}`}>
                      <td>Delivery {i + 1}</td>
                      <td>{l.number}</td>
                      <td className="num">{assignment(p, i, l.workOrderLinkId)}</td>
                      <td>{arrival ? formatDate(arrival) : 'Date unknown'}</td>
                      <td>{formatDate(l.productionStart)}</td>
                      <td>
                        <LinkStatusLabel status={linkStatus('planned', arrival, l.productionStart)} />
                      </td>
                    </tr>
                  );
                }),
            )}
          </tbody>
        </table>
      )}

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
        <label htmlFor="split-note">Note</label>
        <textarea id="split-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required />
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
