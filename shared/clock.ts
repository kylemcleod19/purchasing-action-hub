// Simulated demo clock (PRD §13, ARCHITECTURE §14). One persisted UTC timestamp, presented in
// America/Chicago. Local dates derive from that timestamp. Business-day arithmetic skips weekends only
// (no holiday calendar) and keeps the local wall-clock time across timezone offset changes.
import { addDays } from './dates.js';

export const DEMO_TIME_ZONE = 'America/Chicago';

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DEMO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface LocalParts {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

function localParts(ms: number): LocalParts {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

const asUtcMs = (p: LocalParts) => Date.parse(`${p.date}T00:00:00Z`) + ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;

/** Local (America/Chicago) calendar date of a UTC timestamp. */
export function localDate(iso: string): string {
  return localParts(Date.parse(iso)).date;
}

/** UTC timestamp for a local wall-clock time on a local date. */
export function zonedTimeToUtc(date: string, hour: number, minute = 0, second = 0): string {
  const wanted = asUtcMs({ date, hour, minute, second });
  let guess = wanted;
  // Two passes settle the offset, including on the days the offset changes.
  for (let i = 0; i < 2; i++) guess = wanted - (asUtcMs(localParts(guess)) - guess);
  return new Date(guess).toISOString();
}

export function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

/** Adds business days (Mon–Fri) to a timestamp, keeping its local wall-clock time. */
export function addBusinessDays(iso: string, days: number): string {
  const p = localParts(Date.parse(iso));
  let date = p.date;
  for (let added = 0; added < days; ) {
    date = addDays(date, 1);
    if (isWeekday(date)) added++;
  }
  return zonedTimeToUtc(date, p.hour, p.minute, p.second);
}

/** Business days after `from` up to and including `to` (local dates). Zero when `to` is not later. */
export function businessDaysBetween(from: string, to: string): number {
  let count = 0;
  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1)) if (isWeekday(date)) count++;
  return count;
}

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DEMO_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/** "Oct 26, 2026, 10:00 AM CDT" — demo clock and simulated message times. */
export function formatClock(iso: string | null | undefined): string {
  return iso ? clockFormat.format(new Date(iso)) : '—';
}
