// Demo clock and scenario status (PRD §13 "UI and acceptance additions", ARCHITECTURE §14 "Selection
// and clock services"). The clock moves only forward and only through this explicit control; each
// move reconciles newly overdue conditions and due call tasks once, in one transaction. Both cases
// anchor to the reset date: run Case A before advancing to the Case B delivery time, or reset first.
import type { DB } from '../db/db.js';
import { getDemoClock, getDemoDate, getMeta, setMeta } from '../db/db.js';
import { HttpError } from '../errors.js';
import { formatClock, localDate } from '../../shared/clock.js';
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

  // Case A
  const aSupplier = supplierId(db, CASE_A.supplier);
  const request = aSupplier
    ? (db.prepare('SELECT id, response_due_at AS dueAt FROM outreach_requests WHERE supplier_id = ? ORDER BY id DESC LIMIT 1').get(aSupplier) as
        | { id: number; dueAt: string }
        | undefined)
    : undefined;
  const sentToday = aSupplier ? db.prepare('SELECT 1 FROM outreach_requests WHERE supplier_id = ? AND local_date = ?').get(aSupplier, demoDate) : undefined;
  const messageDone = (key: string) => !!db.prepare('SELECT 1 FROM supplier_messages WHERE external_message_id = ?').get(REPLY_FIXTURES[key].externalMessageId);
  const needsRequest = request ? null : 'Simulate the send first.';
  const replyStep = (key: string): ScenarioStep => ({
    key,
    kind: 'reply',
    label: REPLY_FIXTURES[key].label,
    blockedReason: notInstalled ?? needsRequest,
    done: messageDone(key),
  });
  const caseA: ScenarioCase = {
    key: 'A',
    title: 'Case A: partial supplier reply across two POs',
    summary: `${CASE_A.supplier}: ${CASE_A.poNumbers.join(' and ')}. Eight not-shipped lines are due for confirmation; the reply confirms four, revises two, is vague on one, and skips one.`,
    supplierId: aSupplier,
    supplierName: CASE_A.supplier,
    poIds: poIds(db, CASE_A.poNumbers),
    steps: [
      { key: 'case-a-send', kind: 'send', label: 'Simulate send', blockedReason: notInstalled ?? (sentToday ? 'Already sent on this demo date.' : null), done: !!request },
      replyStep('case-a-reply-1'),
      {
        key: 'case-a-deadline',
        kind: 'clock',
        label: request ? `Advance to response deadline (${formatClock(request.dueAt)})` : 'Advance to response deadline',
        blockedReason: notInstalled ?? needsRequest ?? (request && request.dueAt <= clock ? 'The clock is already past the deadline.' : null),
        done: !!request && request.dueAt <= clock,
      },
      replyStep('case-a-reply-2'),
      replyStep('case-a-reply-past'),
    ],
  };

  // Case B
  const eventDone = (key: string) => !!db.prepare('SELECT 1 FROM carrier_events WHERE external_event_id = ?').get(CARRIER_FIXTURES[key].externalEventId);
  const carrierStep = (key: string): ScenarioStep => {
    const occurredAt = CARRIER_FIXTURES[key].occurredAt(anchor);
    const replay = key === 'case-b-delay-replay';
    return {
      key,
      kind: 'carrier',
      label: CARRIER_FIXTURES[key].label,
      blockedReason:
        notInstalled ??
        (occurredAt > clock ? `Happens at ${formatClock(occurredAt)}; advance the clock first.` : replay && !eventDone('case-b-delay') ? 'Run the delay event first.' : null),
      done: !replay && eventDone(key),
    };
  };
  const deliveredAt = caseBDeliveredAt(anchor);
  const caseB: ScenarioCase = {
    key: 'B',
    title: 'Case B: one carrier delay, several items, partial PO quantity',
    summary: `${CASE_B.carrier} ${CASE_B.tracking} (${CASE_B.shipment}, simulated, not live) carries 30 of 50 on ${CASE_B.poNumbers[0]} line 1, ${CASE_B.poNumbers[0]} line 2, and ${CASE_B.poNumbers[1]} line 1. The other 20 on line 1 are not shipped.`,
    supplierId: supplierId(db, CASE_B.supplier),
    supplierName: CASE_B.supplier,
    poIds: poIds(db, CASE_B.poNumbers),
    steps: [
      carrierStep('case-b-delay'),
      carrierStep('case-b-delay-replay'),
      carrierStep('case-b-older'),
      carrierStep('case-b-later'),
      {
        key: 'case-b-clock',
        kind: 'clock',
        label: `Advance clock to carrier delivery (${formatClock(deliveredAt)})`,
        blockedReason: notInstalled ?? (clock >= deliveredAt ? 'The clock is already there.' : null),
        done: clock >= deliveredAt,
      },
      carrierStep('case-b-delivered'),
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
