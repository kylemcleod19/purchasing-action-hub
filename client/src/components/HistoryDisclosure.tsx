// "Change history (N)" disclosure (PRD §6 "Follow-ups and history"). Collapsed on page entry; the
// page owns the expanded state, so it survives refreshes after saves and is never opened by a save.
import { useId } from 'react';
import { formatClock } from '../../../shared/clock';
import { formatDate } from '../../../shared/dates';
import { ACTOR_TYPE_LABELS, EVENT_LABELS, REASON_LABELS, sourceLabel } from '../../../shared/labels';
import type { HistoryEntry, IssueReason } from '../../../shared/types';

const dateText = (value: unknown) => (typeof value === 'string' ? formatDate(value) : 'Unknown');
const reasonsText = (value: unknown) => (Array.isArray(value) ? value.map((r) => REASON_LABELS[r as IssueReason] ?? r).join(', ') : '');

/** Old → new values for a history row. */
function describeChange(entry: HistoryEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.eventType) {
    case 'arrival_updated':
      return `${dateText(before.expectedArrival)} → ${dateText(after.expectedArrival)}`;
    case 'arrival_confirmed':
      return `${dateText(after.expectedArrival)} (unchanged)`;
    case 'delivery_split': {
      const parts = (after.deliveries as { id: number; quantity: number; expectedArrival: string | null }[]) ?? [];
      return `${before.quantity} (${dateText(before.expectedArrival)}) → ${parts.map((p) => `#${p.id} ${p.quantity} (${dateText(p.expectedArrival)})`).join(', ')}`;
    }
    case 'issue_opened':
      return `${reasonsText(after.reasons)}${before.previousIssue ? ` (reopens #${before.previousIssue})` : ''}${before.parentIssue ? ` (from split issue #${before.parentIssue})` : ''}`;
    case 'issue_updated':
      return `${reasonsText(before.reasons)} → ${reasonsText(after.reasons)}`;
    case 'issue_resolved':
      return `${String(after.outcome)} · arrival ${dateText(after.expectedArrival)}`;
    case 'issue_superseded':
      return `Issue #${before.issue} → split deliveries`;
    case 'follow_up_added':
      return `Due ${dateText(after.dueDate)}`;
    case 'follow_up_edited':
      return `Due ${dateText(before.dueDate)} → ${dateText(after.dueDate)}`;
    case 'follow_up_completed':
      return 'Open → Completed';
    case 'follow_up_moved':
      return `#${before.delivery} → Whole PO`;
    case 'outreach_sent': {
      const items = (after.items as { id: number }[]) ?? [];
      return `Request #${after.request} · ${items.length} item${items.length === 1 ? '' : 's'} · reply by ${formatClock(after.dueAt as string)}`;
    }
    case 'reply_processed':
      return `${after.applied} applied · ${after.needsReview} need review · ${after.notMentioned} not mentioned`;
    case 'reply_needs_review':
      return String(after.reason ?? '');
    case 'carrier_event_applied':
    case 'carrier_event_ignored':
      return `${after.shipment} · ${after.eta ? `ETA ${dateText(after.eta)}` : String(after.status)}`;
    case 'carrier_update_held':
      return after.carrierEta ? `Carrier ETA ${dateText(after.carrierEta)} not applied` : 'Held for review';
    case 'carrier_delivered':
      return `${after.shipment ?? ''} delivered · receipt pending`;
    case 'call_task_created':
    case 'call_task_updated':
    case 'call_task_started':
    case 'call_task_completed':
    case 'call_task_answered':
      return `Task #${after.task}`;
    default:
      return '';
  }
}

const actorText = (h: HistoryEntry) => {
  if (h.actorType === 'simulated_automation') return ACTOR_TYPE_LABELS.simulated_automation;
  return h.actor ? `${h.actor} (demo)` : 'System';
};

export function HistoryDisclosure({ history, expanded, onToggle }: { history: HistoryEntry[]; expanded: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <div className="history">
      <h2>
        <button type="button" className="disclosure" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
          {expanded ? '▾' : '▸'} Change history ({history.length})
        </button>
      </h2>
      {expanded && (
        <div id={id}>
          {history.length === 0 ? (
            <p className="empty">No changes recorded yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="compact">
                <thead>
                  <tr>
                    <th>When (demo time)</th>
                    <th>Event</th>
                    <th>Delivery</th>
                    <th>Old → new</th>
                    <th title="The PO buyer is the demo actor; there is no login. Simulated automation marks fixture-driven changes.">Actor</th>
                    <th>Source</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="nowrap">{formatClock(h.createdAt)}</td>
                      <td className="nowrap">{EVENT_LABELS[h.eventType] ?? h.eventType}</td>
                      <td>{h.deliveryId !== null ? `#${h.deliveryId}` : 'PO'}</td>
                      <td>{describeChange(h)}</td>
                      <td className="nowrap">{actorText(h)}</td>
                      <td>
                        {sourceLabel(h.source)}
                        {h.sourceRef && <div className="hint">{h.sourceRef}</div>}
                      </td>
                      <td>{h.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
