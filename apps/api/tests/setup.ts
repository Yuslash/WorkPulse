import { afterAll, beforeAll } from 'vitest';
import { connectDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { syncIndexes } from '../src/db/indexes.js';
import { env } from '../src/config/env.js';

/**
 * Global test bootstrap.
 *
 * THE GUARD BELOW IS LOAD-BEARING. This suite runs against a real Atlas
 * cluster that also hosts unrelated production databases. Every destructive
 * helper checks the database name first; if `NODE_ENV=test` ever failed to
 * take effect, we abort rather than touch the wrong database.
 */

beforeAll(async () => {
  if (env.databaseName !== env.MONGODB_TEST_DB) {
    throw new Error(
      `TEST SAFETY: expected database "${env.MONGODB_TEST_DB}" but got "${env.databaseName}". ` +
        'Refusing to run tests against a non-test database.',
    );
  }

  await connectDatabase();

  const db = getDb();
  if (db.databaseName !== env.MONGODB_TEST_DB) {
    await closeDatabase();
    throw new Error(`TEST SAFETY: connected to "${db.databaseName}", aborting.`);
  }

  await syncIndexes(db);
});

afterAll(async () => {
  await closeDatabase();
});
