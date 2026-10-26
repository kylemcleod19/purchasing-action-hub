import { ATTENTION_LABELS, DELIVERY_STATE_LABELS, LINK_STATUS_LABELS } from '../../../shared/labels';
import type { AttentionReason, DeliveryState, LinkStatus } from '../../../shared/types';

export function ReasonBadge({ reason }: { reason: AttentionReason }) {
  return <span className={`badge reason-${reason}`}>{ATTENTION_LABELS[reason]}</span>;
}

export function StateLabel({ state }: { state: DeliveryState }) {
  return <span className={`state state-${state}`}>{DELIVERY_STATE_LABELS[state]}</span>;
}

export function LinkStatusLabel({ status }: { status: LinkStatus }) {
  return <span className={`link-status status-${status}`}>{LINK_STATUS_LABELS[status]}</span>;
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
