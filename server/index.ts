// Startup: resolve database path, migrate, seed only an uninitialized database, then listen.
import { config } from './config.js';
import { getDemoDate, initializeDatabase, openDatabase, type DB } from './db/db.js';
import { createApp } from './app.js';

let db: DB;
try {
  db = openDatabase(config.databasePath);
  const seeded = initializeDatabase(db);
  console.log(
    `Database ready at ${config.databasePath} (${seeded ? 'seeded new baseline' : 'existing data kept'}; demo date ${getDemoDate(db)})`,
  );
} catch (err) {
  console.error('Database initialization failed; not starting.', err);
  process.exit(1);
}

const app = createApp(db, { demoMode: config.demoMode, clientDir: config.clientDir });
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Listening on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
