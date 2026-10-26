import { existsSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

export const config = {
  port: Number(process.env.PORT || 3000),
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/demo.sqlite'),
  demoMode: process.env.DEMO_MODE !== 'false',
  production: process.env.NODE_ENV === 'production',
  clientDir: path.resolve(process.env.CLIENT_DIR || 'dist/client'),
};
