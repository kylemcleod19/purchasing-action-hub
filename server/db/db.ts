import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDatabase } from './seed.js';
import { reconcileIssues } from '../services/issues.js';
import { todayUtc } from '../../shared/dates.js';
import { DEFAULT_OUTREACH_SETTINGS } from '../../shared/outreach.js';
import type { OutreachSettings } from '../../shared/types.js';

export type DB = Database.Database;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDatabase(databasePath: string): DB {
  if (databasePath !== ':memory:') mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => (r as { name: string }).name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    })();
  }
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)').run(key, value);
}

export function getDemoDate(db: DB): string {
  const value = getMeta(db, 'demo_date');
  if (!value) throw new Error('Database is not seeded: demo_date missing');
  return value;
}

/** Midday-ish local time on a demo date: 15:00 UTC is morning in America/Chicago all year. */
export const clockForDate = (demoDate: string) => `${demoDate}T15:00:00.000Z`;

/**
 * Simulated clock (UTC). Moves only through the explicit advance-clock control; restarts and reads
 * never move it. Data that predates the clock falls back to the demo date.
 */
export function getDemoClock(db: DB): string {
  return getMeta(db, 'demo_clock') ?? clockForDate(getDemoDate(db));
}

/**
 * Timestamp for a buyer mutation: real time, but never earlier than the simulated clock, so a buyer
 * edit made after a simulated event is recorded as newer than that event.
 */
export function mutationNow(db: DB): string {
  const real = new Date().toISOString();
  const clock = getDemoClock(db);
  return real > clock ? real : clock;
}

export function getOutreachSettings(db: DB): OutreachSettings {
  const read = (key: string, fallback: number) => Number(getMeta(db, key) ?? fallback);
  return {
    staleBusinessDays: read('cadence_stale_business_days', DEFAULT_OUTREACH_SETTINGS.staleBusinessDays),
    responseWindowBusinessDays: read('cadence_response_business_days', DEFAULT_OUTREACH_SETTINGS.responseWindowBusinessDays),
    elapsedThreshold: read('cadence_elapsed_threshold', DEFAULT_OUTREACH_SETTINGS.elapsedThreshold),
    itemCap: read('cadence_item_cap', DEFAULT_OUTREACH_SETTINGS.itemCap),
  };
}

/** Migrates, then seeds only when the database has never been seeded. Returns whether it seeded. */
export function initializeDatabase(db: DB, demoDate: string = todayUtc()): boolean {
  migrate(db);
  if (getMeta(db, 'seeded_at')) {
    // Data seeded before issues existed (migration 003): open issues once for current exceptions.
    if (!getMeta(db, 'issues_initialized')) {
      db.transaction(() => {
        const now = new Date().toISOString();
        reconcileIssues(db, getDemoDate(db), now);
        setMeta(db, 'issues_initialized', now);
      })();
    }
    return false;
  }
  db.transaction(() => seedDatabase(db, demoDate))();
  return true;
}

// Child tables first so foreign keys hold while clearing.
const DATA_TABLES = [
  'call_task_items',
  'call_tasks',
  'message_results',
  'supplier_messages',
  'outreach_items',
  'outreach_requests',
  'carrier_events',
  'shipment_deliveries',
  'shipments',
  'change_history',
  'delivery_issues',
  'follow_ups',
  'deliveries',
  'po_lines',
  'purchase_orders',
  'work_orders',
  'warehouses',
  'suppliers',
  'app_metadata',
];

/**
 * Replaces all data with a fresh baseline in one transaction: messages, processing receipts, tasks,
 * carrier events, issues, and the clock all return to the deterministic baseline. Explicit demo
 * utility only.
 */
export function resetDatabase(db: DB, demoDate: string = todayUtc()): void {
  db.transaction(() => {
    for (const table of DATA_TABLES) db.prepare(`DELETE FROM ${table}`).run();
    seedDatabase(db, demoDate);
  })();
}
