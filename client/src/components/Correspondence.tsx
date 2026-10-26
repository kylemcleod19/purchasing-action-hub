// Simulated supplier correspondence and call tasks (PRD §13 "UI and acceptance additions"). Email
// bodies are readable text; requested items and extracted results are tables. A cross-PO request or
// task shows identically from either PO.
import { useState } from 'react';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { CALL_TASK_STATE_LABELS, CLASSIFICATION_LABELS, RESPONSE_STATE_LABELS, SIMULATION_LABEL } from '../../../shared/labels';
import type { CallTaskView, OutreachItemView, OutreachRequestView, SupplierMessageView } from '../../../shared/types';
import { EmailButton, EmailModal } from './EmailPanel';

const itemLabel = (i: Pick<OutreachItemView, 'poNumber' | 'lineNo'>) => `${i.poNumber} line ${i.lineNo}`;

function RequestedItems({ items }: { items: OutreachItemView[] }) {
  return (
    <table className="compact">
      <caption>Requested items</caption>
      <thead>
        <tr>
          <th>Item</th>
          <th>Part</th>
          <th>Delivery</th>
          <th className="num">Quantity</th>
          <th>Expected arrival when requested</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id} data-request-item={i.deliveryId}>
            <td className="nowrap">{itemLabel(i)}</td>
            <td className="nowrap">{i.partNumber}</td>
            <td>#{i.deliveryId}</td>
            <td className="num">{i.requestedQty}</td>
            <td className="nowrap">{formatDate(i.expectedArrivalSnapshot)}</td>
            <td className={`nowrap response-${i.responseState}`}>{RESPONSE_STATE_LABELS[i.responseState]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Message({ message, items }: { message: SupplierMessageView; items: OutreachItemView[] }) {
  const itemFor = (id: number | null) => items.find((i) => i.id === id);
  const [open, setOpen] = useState(false);
  const outbound = message.direction === 'outbound';
  return (
    <div className={`message message-${message.direction}`}>
      <p className="message-meta">
        <strong>{message.direction === 'outbound' ? 'Request (simulated, not sent)' : 'Supplier reply (simulated)'}</strong> ·{' '}
        {formatClock(message.at)}
        {message.recipient && <> · to {message.recipient}</>} · {message.subject}
      </p>
      <EmailButton label={outbound ? 'View sent email' : 'View supplier reply'} onClick={() => setOpen(true)} />
      {open && (
        <EmailModal
          title={outbound ? 'Sent request email' : 'Supplier reply'}
          email={{ from: message.from, to: message.to, subject: message.subject, at: message.at, body: message.body, sample: false }}
          onClose={() => setOpen(false)}
        />
      )}
      {message.results.length > 0 && (
        <table className="compact results-table">
          <caption>{SIMULATION_LABEL}: extracted results</caption>
          <thead>
            <tr>
              <th>Item</th>
              <th>Result</th>
              <th>Date type</th>
              <th>Arrival</th>
              <th className="num">Qty</th>
              <th>Outcome</th>
              <th>Supporting text</th>
            </tr>
          </thead>
          <tbody>
            {message.results.map((r) => {
              const item = itemFor(r.outreachItemId);
              return (
                <tr key={r.id} className={r.appliedAt ? undefined : 'needs-review-row'}>
                  <td className="nowrap">{item ? itemLabel(item) : '—'}</td>
                  <td className="nowrap">{CLASSIFICATION_LABELS[r.classification]}</td>
                  <td>{r.dateType === 'unknown' ? '—' : r.dateType === 'ship' ? 'Ship' : 'Arrival'}</td>
                  <td className="nowrap">{formatDate(r.proposedDate)}</td>
                  <td className="num">{r.proposedQty ?? '—'}</td>
                  <td>{r.appliedAt ? 'Applied' : <span className="review-reason">{r.reviewReason ?? 'Needs review'}</span>}</td>
                  <td className="evidence">{r.evidenceText ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CorrespondenceList({ requests }: { requests: OutreachRequestView[] }) {
  if (requests.length === 0) return <p className="empty">No supplier requests for this PO.</p>;
  return (
    <div className="correspondence">
      {requests.map((r) => (
        <section key={r.id} className="request" aria-label={`Request ${r.id}`}>
          <p className="request-meta">
            <strong>Request #{r.id}</strong> · {r.supplierName} · sent {formatClock(r.sentAt)} · reply due {formatClock(r.responseDueAt)} ·{' '}
            {r.state === 'open' ? 'Open' : 'Closed'}
            {r.callTaskId !== null && <> · call task #{r.callTaskId}</>}
          </p>
          <RequestedItems items={r.items} />
          {r.messages.map((m) => (
            <Message key={m.id} message={m} items={r.items} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function CallTasksTable({
  tasks,
  onStart,
  onComplete,
}: {
  tasks: CallTaskView[];
  onStart?: (t: CallTaskView) => void;
  onComplete?: (t: CallTaskView) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="table-scroll">
      <table className="data-table call-tasks-table">
        <caption>Supplier call tasks (system-generated after the response deadline)</caption>
        <thead>
          <tr>
            <th>Task</th>
            <th>Supplier</th>
            <th>Created</th>
            <th>State</th>
            <th>Items to confirm by phone</th>
            {(onStart || onComplete) && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} data-call-task={t.id} className={t.state === 'completed' || t.state === 'answered' ? 'muted' : undefined}>
              <td className="nowrap">
                #{t.id} · request #{t.requestId}
              </td>
              <td>{t.supplierName}</td>
              <td className="nowrap">{formatClock(t.createdAt)}</td>
              <td className="nowrap">
                {CALL_TASK_STATE_LABELS[t.state]}
                {t.completionNote && <div className="hint">{t.completionNote}</div>}
              </td>
              <td>
                <table className="compact nested">
                  <tbody>
                    {t.items.map((i) => (
                      <tr key={i.id}>
                        <td className="nowrap">{itemLabel(i)}</td>
                        <td className="nowrap">{i.partNumber}</td>
                        <td className="num">
                          {i.requestedQty} {i.unit}
                        </td>
                        <td className="nowrap">{RESPONSE_STATE_LABELS[i.taskResponseState]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td>
              {(onStart || onComplete) && (
                <td className="actions">
                  {t.state === 'open' && onStart && (
                    <button type="button" className="small" onClick={() => onStart(t)}>
                      Start call
                    </button>
                  )}
                  {(t.state === 'open' || t.state === 'in_progress') && onComplete && (
                    <button type="button" className="small" onClick={() => onComplete(t)}>
                      Complete call task
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
