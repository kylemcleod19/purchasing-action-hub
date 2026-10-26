// Demo clock and scenario status (PRD §13 "UI and acceptance additions", ARCHITECTURE §14 "Selection
// and clock services"). The clock moves only forward and only through this explicit control; each
// move reconciles newly overdue conditions and due call tasks once, in one transaction. Both cases
// anchor to the reset date: run Case A before advancing to the Case B delivery time, or reset first.
import type { DB } from '../db/db.js';
import { getDemoClock, getDemoDate, getMeta, getOutreachSettings, setMeta } from '../db/db.js';
import { HttpError } from '../errors.js';
import { addBusinessDays, formatClock, localDate } from '../../shared/clock.js';
import { addDays, formatDate } from '../../shared/dates.js';
import type { ScenarioCase, ScenariosResponse, ScenarioStep } from '../../shared/types.js';
import { CASE_A, CASE_B } from '../db/seed.js';
import { CARRIER_FIXTURES, REPLY_FIXTURES } from '../simulation/fixtures.js';
import { escalateDueRequests } from './callTasks.js';
import { reconcileForDemoDate } from './issues.js';

export interface ClockOutcome {
  demoClock: string;
  demoDate: string;
  issuesChanged: number;
  callTasksCreated: number;
}

export function advanceClock(db: DB, to: string): ClockOutcome {
  return db.transaction((): ClockOutcome => {
    const current = getDemoClock(db);
    const target = new Date(to).toISOString();
    if (target <= current) throw new HttpError(422, 'The demo clock only moves forward.', { to: `Choose a time after ${formatClock(current)}.` });
    const demoDate = localDate(target);
    setMeta(db, 'demo_clock', target);
    setMeta(db, 'demo_date', demoDate);
    const issuesChanged = reconcileForDemoDate(db, demoDate, target);
    const callTasksCreated = escalateDueRequests(db, target);
    return { demoClock: target, demoDate, issuesChanged, callTasksCreated };
  })();
}

/** The Case B "carrier delivered" time; the delivered event needs the clock at or after it. */
export const caseBDeliveredAt = (anchor: string) => CARRIER_FIXTURES['case-b-delivered'].occurredAt(anchor);

const supplierId = (db: DB, name: string) => (db.prepare('SELECT id FROM suppliers WHERE name = ?').get(name) as { id: number } | undefined)?.id ?? null;
const poIds = (db: DB, numbers: readonly string[]) =>
  numbers.map((n) => (db.prepare('SELECT id FROM purchase_orders WHERE number = ?').get(n) as { id: number } | undefined)?.id).filter((id): id is number => !!id);

export function getScenarios(db: DB): ScenariosResponse {
  const clock = getDemoClock(db);
  const fixturesInstalled = !!getMeta(db, 'fixture_version');
  const anchor = getMeta(db, 'scenario_anchor') ?? getDemoDate(db);
  const demoDate = localDate(clock);
  const notInstalled = fixturesInstalled ? null : 'Reset demo data to install the scenarios.';

  // ---- Supplier follow-up (Case A) ----
  const aSupplier = supplierId(db, CASE_A.supplier);
  const request = aSupplier
    ? (db.prepare('SELECT id, response_due_at AS dueAt FROM outreach_requests WHERE supplier_id = ? ORDER BY id DESC LIMIT 1').get(aSupplier) as
        | { id: number; dueAt: string }
        | undefined)
    : undefined;
  const sentToday = aSupplier ? db.prepare('SELECT 1 FROM outreach_requests WHERE supplier_id = ? AND local_date = ?').get(aSupplier, demoDate) : undefined;
  const messageDone = (key: string) => !!db.prepare('SELECT 1 FROM supplier_messages WHERE external_message_id = ?').get(REPLY_FIXTURES[key].externalMessageId);
  const needsRequest = request ? null : 'Send the request first.';
  const dueAt = request?.dueAt ?? addBusinessDays(clock, getOutreachSettings(db).responseWindowBusinessDays);
  const reply1Done = messageDone('case-a-reply-1');
  const deadlinePassed = !!request && request.dueAt <= clock;

  const caseA: ScenarioCase = {
    key: 'A',
    title: 'Supplier follow-up',
    explanation: 'Request arrival confirmations, process a partial reply, and escalate unanswered items to purchasing.',
    summary: `${CASE_A.supplier}: ${CASE_A.poNumbers.join(' and ')}.`,
    supplierId: aSupplier,
    supplierName: CASE_A.supplier,
    poIds: poIds(db, CASE_A.poNumbers),
    steps: [
      {
        key: 'case-a-send',
        kind: 'send',
        title: 'Request confirmation',
        description: `Simulates the automated request to ${CASE_A.supplier} for the selected lines, with a reply due ${formatClock(dueAt)}. Nothing is sent.`,
        actionLabel: 'Simulate sending request',
        blockedReason: notInstalled ?? (sentToday && !request ? 'A request already went to this supplier on this demo date.' : null),
        done: !!request,
      },
      {
        key: 'case-a-reply-1',
        kind: 'reply',
        title: 'Process partial reply',
        description: 'Simulates the supplier’s partial reply. The system then updates confirmed and revised arrivals automatically, opens delivery issues for new risk, and marks vague or missing items for follow-up.',
        actionLabel: 'Simulate supplier reply',
        blockedReason: notInstalled ?? needsRequest,
        done: reply1Done,
      },
      {
        key: 'case-a-deadline',
        kind: 'clock',
        title: 'Reach follow-up deadline',
        description: `Moves the demo clock to the reply deadline (${formatClock(dueAt)}). The system then turns items still unanswered or unclear into one call task for purchasing.`,
        actionLabel: `Advance clock to ${formatClock(dueAt)}`,
        blockedReason: notInstalled ?? needsRequest ?? (reply1Done ? null : 'Process the supplier reply first.'),
        done: deadlinePassed,
      },
      {
        key: 'case-a-reply-2',
        kind: 'reply',
        title: 'Process clarification',
        description: 'Simulates the supplier’s follow-up for the open items. The system then updates them automatically and closes the unstarted call task as answered; delivery issues stay open for the buyer.',
        actionLabel: 'Simulate clarification reply',
        blockedReason: notInstalled ?? needsRequest ?? (reply1Done ? null : 'Process the supplier reply first.'),
        done: messageDone('case-a-reply-2'),
      },
    ],
    extras: [
      {
        key: 'case-a-reply-past',
        kind: 'reply',
        title: 'Past-date supplier confirmation',
        description: `The supplier confirms ${formatDate(addDays(anchor, -1))} for unreceived material on ${CASE_A.poNumbers[1]} line 2; it shows as past expected arrival even though dock and production dates are later.`,
        actionLabel: 'Simulate past-date confirmation',
        blockedReason: notInstalled ?? needsRequest,
        done: messageDone('case-a-reply-past'),
      },
    ],
  };

  // ---- Shipment tracking (Case B) ----
  const eventDone = (key: string) => !!db.prepare('SELECT 1 FROM carrier_events WHERE external_event_id = ?').get(CARRIER_FIXTURES[key].externalEventId);
  const eta = (key: string) => formatDate(CARRIER_FIXTURES[key].payload(anchor).eta ?? null);
  const delayDone = eventDone('case-b-delay');
  const tooEarly = (key: string) => {
    const at = CARRIER_FIXTURES[key].occurredAt(anchor);
    return at > clock ? `The carrier reports this at ${formatClock(at)}; advance the clock first.` : null;
  };
  const deliveredAt = caseBDeliveredAt(anchor);
  const caseB: ScenarioCase = {
    key: 'B',
    title: 'Shipment tracking',
    explanation: 'Apply a shipment delay to its linked items while preserving unshipped quantities and warehouse receipt status.',
    summary: `${CASE_B.carrier} ${CASE_B.tracking} (${CASE_B.shipment}, simulated, not a live carrier).`,
    supplierId: supplierId(db, CASE_B.supplier),
    supplierName: CASE_B.supplier,
    poIds: poIds(db, CASE_B.poNumbers),
    steps: [
      {
        key: 'case-b-delay',
        kind: 'carrier',
        title: 'Apply carrier delay',
        description: `Simulates ${CASE_B.carrier} reporting a delay for ${CASE_B.tracking}. The system then moves its three linked deliveries to ${eta('case-b-delay')} and opens delivery issues automatically; the unshipped remainder keeps its date.`,
        actionLabel: `Simulate carrier delay (ETA ${eta('case-b-delay')})`,
        blockedReason: notInstalled ?? tooEarly('case-b-delay'),
        done: delayDone,
      },
      {
        key: 'case-b-later',
        kind: 'carrier',
        title: 'Apply further delay',
        description: `Simulates a later carrier update with ETA ${eta('case-b-later')}. The system then updates the linked deliveries, reopens any estimate the buyer already accepted, and updates open issues without duplicates.`,
        actionLabel: `Simulate further delay (ETA ${eta('case-b-later')})`,
        blockedReason: notInstalled ?? (delayDone ? tooEarly('case-b-later') : 'Apply the carrier delay first.'),
        done: eventDone('case-b-later'),
      },
      {
        key: 'case-b-clock',
        kind: 'clock',
        title: 'Advance to delivery time',
        description: `Move the shared demo clock to ${formatClock(deliveredAt)}, when the carrier delivers. Dates across the dataset are evaluated against the new day.`,
        actionLabel: `Advance clock to ${formatClock(deliveredAt)}`,
        blockedReason: notInstalled ?? (eventDone('case-b-later') ? null : 'Apply the further delay first.'),
        done: clock >= deliveredAt,
      },
      {
        key: 'case-b-delivered',
        kind: 'carrier',
        title: 'Record carrier delivery',
        description: 'Simulates the carrier reporting Delivered. The system marks the shipment delivered with warehouse receipt pending; Received quantities and open issues do not change.',
        actionLabel: 'Simulate carrier delivery',
        blockedReason: notInstalled ?? tooEarly('case-b-delivered'),
        done: eventDone('case-b-delivered'),
      },
    ],
    extras: [
      {
        key: 'case-b-delay-replay',
        kind: 'carrier',
        title: 'Duplicate carrier event',
        description: 'Deliver the same delay event (same event ID) again. Expected: nothing changes.',
        actionLabel: 'Simulate duplicate event',
        blockedReason: notInstalled ?? (delayDone ? null : 'Apply the carrier delay first.'),
        done: false,
      },
      {
        key: 'case-b-older',
        kind: 'carrier',
        title: 'Older carrier event',
        description: `Deliver a previously unseen event timestamped before the latest one, with ETA ${eta('case-b-older')}. Expected: recorded as ignored; estimates unchanged.`,
        actionLabel: 'Simulate older event',
        blockedReason: notInstalled ?? (delayDone ? null : 'Apply the carrier delay first, so this event is older than the latest one.'),
        done: eventDone('case-b-older'),
      },
    ],
  };
  return { demoClock: clock, demoDate, fixturesInstalled, cases: [caseA, caseB] };
}

/** Target time for a clock step key. */
export function clockTarget(db: DB, step: string): string {
  const anchor = getMeta(db, 'scenario_anchor') ?? getDemoDate(db);
  if (step === 'case-b-clock') return caseBDeliveredAt(anchor);
  if (step === 'case-a-deadline') {
    const due = db
      .prepare(
        `SELECT r.response_due_at AS dueAt FROM outreach_requests r JOIN suppliers s ON s.id = r.supplier_id
         WHERE s.name = ? ORDER BY r.id DESC LIMIT 1`,
      )
      .get(CASE_A.supplier) as { dueAt: string } | undefined;
    if (!due) throw new HttpError(409, 'Simulate the send first.');
    return due.dueAt;
  }
  throw new HttpError(404, 'Unknown clock step.');
}
