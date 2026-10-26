import { defineConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';

// The browser flow runs against the production build with its own fresh database per run.
// Playwright loads this file in each process, so the path is fixed once via the environment.
if (!process.env.E2E_DATABASE_PATH) {
  try {
    rmSync(path.resolve('.tmp/e2e'), { recursive: true, force: true });
  } catch {
    // A previous run's file may still be locked on Windows; a new path is used regardless.
  }
  process.env.E2E_DATABASE_PATH = path.resolve(`.tmp/e2e/run-${Date.now()}/e2e.sqlite`);
}
const dbPath = process.env.E2E_DATABASE_PATH;
const port = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node dist/server/server/index.js',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(port),
      DATABASE_PATH: dbPath,
      DEMO_MODE: 'true',
      NODE_ENV: 'production',
    },
  },
});
