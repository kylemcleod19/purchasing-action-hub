// Issue transition rule (PRD §7 "Separate buyer action from physical delivery risk" and "Reopening").
// Physical risk is derived; issue disposition is persisted. This pure function decides, after a change
// to one delivery's facts, whether an issue should open, stay open with updated reasons, or not change.
import { physicalRisk } from './impact.js';
import type { DeliveryFacts, IssueReason, ReviewedFacts } from './types.js';

export type IssueTransition =
  | { action: 'none' }
  | { action: 'open'; reasons: IssueReason[] }
  | { action: 'update'; reasons: IssueReason[] };

export interface TransitionInput {
  /** Facts before the change; null when the delivery is first evaluated (seed, migration, new child). */
  before: Pick<DeliveryFacts, 'expectedArrival'> | null;
  after: DeliveryFacts;
  demoDate: string;
  /** Reasons on the delivery's currently open issue, if any. */
  openIssueReasons: IssueReason[] | null;
  /** Facts reviewed at the most recent disposition for this delivery (or its split parent), if any. */
  lastReviewed: ReviewedFacts | null;
}

const ORDER: IssueReason[] = ['production_conflict', 'late', 'overdue', 'unknown', 'moved_later'];
const ordered = (reasons: Iterable<IssueReason>) => {
  const set = new Set(reasons);
  return ORDER.filter((r) => set.has(r));
};

export function evaluateIssueTransition({ before, after, demoDate, openIssueReasons, lastReviewed }: TransitionInput): IssueTransition {
  if (after.state === 'received') return { action: 'none' };

  const risk = physicalRisk(after, demoDate).reasons;
  const priorArrival = before?.expectedArrival ?? null;
  const movedLater = priorArrival !== null && after.expectedArrival !== null && after.expectedArrival > priorArrival;
  const becameUnknown = before !== null && priorArrival !== null && after.expectedArrival === null;
  const triggers: IssueReason[] = [...risk, ...(movedLater ? (['moved_later'] as const) : [])];

  // At most one open issue: it stays open (Save changes never closes it) and gathers new reasons.
  if (openIssueReasons) {
    const merged = ordered([...openIssueReasons, ...triggers]);
    return merged.length === openIssueReasons.length ? { action: 'none' } : { action: 'update', reasons: merged };
  }

  if (lastReviewed) {
    // After a disposition, reopen only for a worse estimate, a new unknown, or a newly active reason.
    // Identical facts, source/note-only edits, and improved dates with the same accepted risks do not.
    const newReason = risk.some((r) => !lastReviewed.reasons.includes(r));
    if (movedLater || becameUnknown || newReason) return { action: 'open', reasons: ordered(triggers) };
    return { action: 'none' };
  }

  return triggers.length > 0 ? { action: 'open', reasons: ordered(triggers) } : { action: 'none' };
}
