// npm run db:reset — explicit local reset. Refuses production unless ALLOW_PROD_RESET=true.
import { config } from '../config.js';
import { getDemoDate, migrate, openDatabase, resetDatabase } from './db.js';

if (config.production && process.env.ALLOW_PROD_RESET !== 'true') {
  console.error('Refusing to reset a production database. Set ALLOW_PROD_RESET=true to override deliberately.');
  process.exit(1);
}

const db = openDatabase(config.databasePath);
migrate(db);
resetDatabase(db);
console.log(`Reset ${config.databasePath}; demo date ${getDemoDate(db)}`);
db.close();
