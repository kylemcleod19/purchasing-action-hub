import { formatDate } from '../../../shared/dates';
import { DELIVERY_STATE_LABELS, OUTCOME_LABELS, REASON_LABELS, sourceLabel } from '../../../shared/labels';
import type { DeliveryRow, DeliveryState, IssueReason, PhysicalRisk } from '../../../shared/types';
import { Icon, SOURCE_ICONS, type IconName } from './Icons';

export function StateLabel({ state }: { state: DeliveryState }) {
  return <span className={`state state-${state}`}>{DELIVERY_STATE_LABELS[state]}</span>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Tooltip text for the exact date comparisons behind a risk icon. */
export function riskTitle(risk: PhysicalRisk, row: Pick<DeliveryRow, 'requiredDock' | 'productionStart'>): string {
  const parts: string[] = [];
  if (risk.daysLate !== null) parts.push(`Late: ${plural(risk.daysLate, 'day')} after required dock date ${formatDate(row.requiredDock)}`);
  if (risk.daysOverdue !== null) parts.push(`Overdue: expected ${plural(risk.daysOverdue, 'day')} ago, no receipt recorded`);
  if (risk.daysAfterStart !== null) {
    parts.push(`Production conflict: ${plural(risk.daysAfterStart, 'day')} after production start ${formatDate(row.productionStart)}`);
  }
  return parts.join('. ');
}

type ArrivalRow = Pick<DeliveryRow, 'state' | 'expectedArrival' | 'receivedAt' | 'risk' | 'requiredDock' | 'productionStart'>;

/**
 * Expected arrival with risk icons, actual receipt date with a check, or an em dash for unknown.
 * `showTransit` adds a package icon for in-transit shipments (PO Arrivals).
 */
export function ArrivalDate({ row, quantity, showTransit }: { row: ArrivalRow; quantity?: number; showTransit?: boolean }) {
  const qty = (
    <>
      {showTransit && row.state === 'in_transit' && (
        <>
          {' '}
          <Icon name="package" label="In transit" className="transit" />
        </>
      )}
      {quantity !== undefined && <span className="arrival-qty"> ({quantity})</span>}
    </>
  );
  if (row.state === 'received') {
    return (
      <span className="date-cell">
        {row.receivedAt ? formatDate(row.receivedAt) : '—'} <Icon name="check" label={`Received${row.receivedAt ? ` ${formatDate(row.receivedAt)}` : ''}`} className="ok" />
        {qty}
      </span>
    );
  }
  if (row.expectedArrival === null) {
    return (
      <span className="date-cell">
        — <Icon name="question" label="Date unknown: no expected arrival" className="unknown" />
        {qty}
      </span>
    );
  }
  const late = row.risk.reasons.includes('late');
  const overdue = row.risk.reasons.includes('overdue');
  return (
    <span className={`date-cell${late || overdue ? ' risk-text' : ''}`}>
      {formatDate(row.expectedArrival)}
      {late && (
        <>
          {' '}
          <Icon name="warning" label={riskTitle({ ...row.risk, daysAfterStart: null, daysOverdue: null }, row)} className="risk" />
        </>
      )}
      {overdue && (
        <>
          {' '}
          <Icon name="clock" label={riskTitle({ ...row.risk, daysAfterStart: null, daysLate: null }, row)} className="risk" />
        </>
      )}
      {qty}
    </span>
  );
}

const REASON_ICONS: Record<IssueReason, IconName> = {
  production_conflict: 'conflict',
  late: 'warning',
  overdue: 'clock',
  unknown: 'question',
  moved_later: 'later',
};

/** Accessible label for one issue reason, with exact days when that risk is currently active. */
function reasonLabel(reason: IssueReason, row: Pick<DeliveryRow, 'risk' | 'requiredDock' | 'productionStart'>): string {
  const { risk } = row;
  const none = { daysLate: null, daysAfterStart: null, daysOverdue: null };
  if (reason === 'late' && risk.daysLate !== null) return riskTitle({ ...risk, ...none, daysLate: risk.daysLate }, row);
  if (reason === 'production_conflict' && risk.daysAfterStart !== null) {
    return riskTitle({ ...risk, ...none, daysAfterStart: risk.daysAfterStart }, row);
  }
  if (reason === 'overdue' && risk.daysOverdue !== null) return riskTitle({ ...risk, ...none, daysOverdue: risk.daysOverdue }, row);
  if (reason === 'unknown') return 'Date unknown: no expected arrival';
  if (reason === 'moved_later') return 'Estimate moved later than the previous expected arrival';
  return `${REASON_LABELS[reason]} when the issue opened`;
}

/** Production start, with an accessible marker when the expected arrival conflicts with it. */
export function ProductionStartDate({ row }: { row: ArrivalRow }) {
  const conflict = row.risk.reasons.includes('production_conflict');
  return (
    <span className={`date-cell${conflict ? ' conflict-text' : ''}`}>
      {formatDate(row.productionStart)}
      {conflict && (
        <>
          {' '}
          <Icon name="conflict" label={riskTitle({ ...row.risk, daysLate: null, daysOverdue: null }, row)} className="conflict" />
        </>
      )}
    </span>
  );
}

/**
 * Row tint for physical date risk: past production start (light red) outranks past required dock
 * (very light red). Received deliveries have no risk, so they are never tinted.
 */
export function riskRowClass(rows: Pick<DeliveryRow, 'risk'>[]): string {
  if (rows.some((r) => r.risk.reasons.includes('production_conflict'))) return 'row-conflict';
  if (rows.some((r) => r.risk.reasons.includes('late'))) return 'row-late';
  return '';
}

export function DateText({ date }: { date: string | null }) {
  return <span className="date-cell">{formatDate(date)}</span>;
}

export const reasonList = (reasons: IssueReason[]) => reasons.map((r) => REASON_LABELS[r]).join(', ');

/** Compact issue status: Open plus one labeled icon per reason, Resolved (with outcome), or an em dash. */
export function IssueStatus({ row }: { row: Pick<DeliveryRow, 'issue' | 'lastResolution' | 'risk' | 'requiredDock' | 'productionStart'> }) {
  if (row.issue) {
    return (
      <span className="issue-open">
        <Icon name="flag" label="Open issue" /> Open
        <span className="issue-reasons">
          {row.issue.reasons.map((r) => (
            <Icon key={r} name={REASON_ICONS[r]} label={reasonLabel(r, row)} className="reason" />
          ))}
        </span>
      </span>
    );
  }
  if (row.lastResolution) {
    const r = row.lastResolution;
    return (
      <span className="issue-resolved" title={`${OUTCOME_LABELS[r.outcome]} by ${r.resolvedBy}, ${new Date(r.resolvedAt).toLocaleString()}`}>
        Resolved
      </span>
    );
  }
  return <span className="muted-text">—</span>;
}

const lastUpdateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Date of the latest arrival-information update plus a source icon. Not a delivery date. */
export function LastUpdate({ at, source }: { at: string | null; source: string }) {
  if (!at) return <span>—</span>;
  const date = new Date(at);
  const label = sourceLabel(source);
  return (
    <span className="date-cell last-update" title={`${label} · ${date.toLocaleString()}`}>
      {lastUpdateFormat.format(date)} <Icon name={SOURCE_ICONS[source] ?? 'document'} label={label} className="source" />
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
