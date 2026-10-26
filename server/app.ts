import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DB } from './db/db.js';
import { HttpError } from './errors.js';
import { apiRouter } from './routes/api.js';

export function createApp(db: DB, options: { demoMode: boolean; clientDir?: string }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // API first; unknown API routes are JSON 404s, never the SPA page.
  app.use('/api', apiRouter(db, options));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Built client and SPA fallback for page routes such as /purchase-orders/:id.
  if (options.clientDir && existsSync(path.join(options.clientDir, 'index.html'))) {
    const indexHtml = path.join(options.clientDir, 'index.html');
    app.use(express.static(options.clientDir, { index: false }));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(indexHtml);
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, fields: err.fields });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request too large.' });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Nothing was saved.' });
  };
  app.use(errorHandler);

  return app;
}
