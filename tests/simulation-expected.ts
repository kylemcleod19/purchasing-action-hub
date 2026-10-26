// Expected effects of the simulation fixtures (PRD §13), kept apart from the fixtures themselves
// (server/simulation/fixtures.ts) so tests compare applied state against an independent statement of
// the scenario. Day values are offsets from the scenario anchor (the demo date at reset). Passing these
// shows fixture-driven workflow behavior only, not extraction accuracy.
import type { IssueReason, ResponseState } from '../shared/types.js';

export interface ExpectedItem {
  /** Index into CASE_A.poNumbers. */
  po: 0 | 1;
  line: number;
  arrival: number;
  /** Open issue reasons after the step; null for no open issue. */
  issue: IssueReason[] | null;
  /** Whether Last update / last confirmation moved to the reply time. */
  refreshed: boolean;
  response: ResponseState;
}

export const CASE_A_ELIGIBLE = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [0, 6],
  [1, 1],
  [1, 2],
] as const;

export const CASE_A_EXCLUDED: Record<number, string> = {
  7: 'recent_update',
  8: 'recent_update',
  9: 'received',
  10: 'tracked',
};

export const CASE_A_REPLY_1 = {
  applied: 6,
  needsReview: 1,
  notMentioned: 1,
  items: [
    { po: 0, line: 1, arrival: 2, issue: null, refreshed: true, response: 'answered' },
    { po: 0, line: 2, arrival: 2, issue: null, refreshed: true, response: 'answered' },
    { po: 0, line: 3, arrival: 2, issue: null, refreshed: true, response: 'answered' },
    { po: 0, line: 4, arrival: 2, issue: null, refreshed: true, response: 'answered' },
    // Late against dock D+3, before production start D+5.
    { po: 0, line: 5, arrival: 4, issue: ['late', 'moved_later'], refreshed: true, response: 'answered' },
    // Dock and production conflict.
    { po: 1, line: 1, arrival: 7, issue: ['production_conflict', 'late', 'moved_later'], refreshed: true, response: 'answered' },
    // "Should ship Friday" is not an arrival; the old estimate stays.
    { po: 0, line: 6, arrival: 2, issue: null, refreshed: false, response: 'needs_review' },
    // Not mentioned: unchanged and still awaiting an answer.
    { po: 1, line: 2, arrival: 2, issue: null, refreshed: false, response: 'awaiting' },
  ] satisfies ExpectedItem[],
};

/** At the response deadline: one call task holding exactly the two unresolved items. */
export const CASE_A_DEADLINE_TASK_ITEMS = [
  [0, 6],
  [1, 2],
] as const;

export const CASE_B_DELAY = {
  eta: 6,
  /** [PO index into CASE_B.poNumbers, line, quantity, open issue reasons] for the three linked rows. */
  linked: [
    [0, 1, 30, ['production_conflict', 'late', 'moved_later']],
    [0, 2, 12, ['production_conflict', 'late', 'moved_later']],
    [1, 1, 8, ['late', 'moved_later']],
  ] as const,
  /** PO-C line 1's not-shipped remainder keeps its date. */
  remainder: { po: 0, line: 1, quantity: 20, arrival: 2 },
};
