import { daysBetween, formatDate } from '../../../shared/dates';
import { ATTENTION_LABELS, DATE_STATUS_LABELS, DELIVERY_STATE_LABELS, sourceLabel } from '../../../shared/labels';
import type { AttentionReason, DateStatus, DeliveryRow, DeliveryState } from '../../../shared/types';

export function ReasonBadge({ reason }: { reason: AttentionReason }) {
  return <span className={`badge reason-${reason}`}>{ATTENTION_LABELS[reason]}</span>;
}

export function StateLabel({ state }: { state: DeliveryState }) {
  return <span className={`state state-${state}`}>{DELIVERY_STATE_LABELS[state]}</span>;
}

export function DateStatusLabel({ status }: { status: DateStatus }) {
  return <span className={`link-status status-${status}`}>{DATE_STATUS_LABELS[status]}</span>;
}

/** Expected arrival, or the receipt date for received deliveries. "Date unknown" for null. */
export function ArrivalText({ row }: { row: Pick<DeliveryRow, 'state' | 'expectedArrival' | 'receivedDate' | 'productionStart'> }) {
  if (row.state === 'received') return <span className="nowrap">Received {formatDate(row.receivedDate)}</span>;
  if (!row.expectedArrival) return <span className="nowrap status-unknown">Date unknown</span>;
  const late = daysBetween(row.productionStart, row.expectedArrival);
  return (
    <span className="nowrap">
      {formatDate(row.expectedArrival)}
      {late > 0 && (
        <span className="late-text supplementary">
          {late} day{late === 1 ? '' : 's'} after start
        </span>
      )}
    </span>
  );
}

const ICON_PATHS: Record<string, string> = {
  // Envelope
  supplier_email: 'M2 4h12v8H2z M2 4l6 5 6-5',
  // Phone handset
  supplier_call:
    'M4.5 2h2l1 3-1.5 1a8 8 0 0 0 4 4l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 3 3.5 1.5 1.5 0 0 1 4.5 2z',
  // Package
  carrier_update: 'M2 5l6-3 6 3v6l-6 3-6-3z M2 5l6 3 6-3 M8 8v6',
  // Document (Other / initial PO schedule)
  document: 'M4 2h5l3 3v9H4z M9 2v3h3 M6 8h4 M6 10.5h4',
};

export function SourceIcon({ source }: { source: string }) {
  const label = sourceLabel(source);
  const path = ICON_PATHS[source] ?? ICON_PATHS.document;
  return (
    <svg className="source-icon" viewBox="0 0 16 16" width="14" height="14" role="img" aria-label={label}>
      <title>{label}</title>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const lastUpdateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Date of the latest arrival-information update plus a source icon. Not a delivery date. */
export function LastUpdate({ updatedAt, source }: { updatedAt: string | null; source: string }) {
  if (!updatedAt) return <span>—</span>;
  const at = new Date(updatedAt);
  return (
    <span className="nowrap last-update" title={`${sourceLabel(source)} · ${at.toLocaleString()}`}>
      {lastUpdateFormat.format(at)} <SourceIcon source={source} />
    </span>
  );
}

export function Flash({ message, onDismiss }: { message: { kind: 'success' | 'error'; text: string } | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div className={`flash flash-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      <span>{message.text}</span>
      <button type="button" className="link-button" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export function FormErrors({ error, fields }: { error: string | null; fields: Record<string, string> }) {
  if (!error) return null;
  const messages = Object.entries(fields).filter(([, m]) => m);
  return (
    <div className="form-error" role="alert">
      <strong>{error}</strong>
      {messages.length > 0 && (
        <ul>
          {messages.map(([key, m]) => (
            <li key={key}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
