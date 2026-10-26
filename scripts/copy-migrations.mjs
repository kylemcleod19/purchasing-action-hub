// Copies SQL migrations next to the compiled server so the runtime image finds them.
import { cpSync } from 'node:fs';

cpSync('server/db/migrations', 'dist/server/server/db/migrations', { recursive: true });
