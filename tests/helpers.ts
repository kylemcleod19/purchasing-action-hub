import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { initializeDatabase, openDatabase, type DB } from '../server/db/db.js';
import { DEMO } from '../server/db/seed.js';
import type { DeliveryRow, IncomingResponse, PurchaseOrderDetail } from '../shared/types.js';

export const DEMO_DATE = '2026-10-26';

export function tempDbPath() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pah-test-'));
  return { dir, dbPath: path.join(dir, 'test.sqlite') };
}

export function createTestContext() {
  const { dir, dbPath } = tempDbPath();
  let db: DB = openDatabase(dbPath);
  initializeDatabase(db, DEMO_DATE);
  const ctx = {
    dbPath,
    get db() {
      return db;
    },
    get http() {
      return request(createApp(db, { demoMode: true }));
    },
    /** Closes and reopens the database file, as a server restart would. */
    reopen() {
      db.close();
      db = openDatabase(dbPath);
      return initializeDatabase(db, '2030-01-01');
    },
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
    async incoming(): Promise<IncomingResponse> {
      return (await ctx.http.get('/api/incoming').expect(200)).body;
    },
    async po(id: number): Promise<PurchaseOrderDetail> {
      return (await ctx.http.get(`/api/purchase-orders/${id}`).expect(200)).body;
    },
    async demoRows(): Promise<DeliveryRow[]> {
      const { rows } = await ctx.incoming();
      return rows.filter((r) => r.poNumber === DEMO.poNumber).sort((a, b) => a.deliveryId - b.deliveryId);
    },
    count(table: string): number {
      return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    },
  };
  return ctx;
}

export type TestContext = ReturnType<typeof createTestContext>;
