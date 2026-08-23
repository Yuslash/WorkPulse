import { closeDatabase, connectDatabase, getDb } from './client.js';
import { syncIndexes } from './indexes.js';
import { env } from '../config/env.js';

/**
 * `npm run db:reset` — drops the WorkPulse database and recreates its schema.
 *
 * The cluster this connects to also hosts unrelated databases, so the guard
 * below is not decoration: it refuses to run against anything except the two
 * names WorkPulse owns, and requires --force to touch the development one.
 */
const ALLOWED = new Set([env.MONGODB_DB, env.MONGODB_TEST_DB]);

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const db = await connectDatabase();
  const name = db.databaseName;

  if (!ALLOWED.has(name)) {
    await closeDatabase();
    throw new Error(
      `Refusing to reset "${name}". Only ${[...ALLOWED].join(' and ')} may be reset.`,
    );
  }

  if (name === env.MONGODB_DB && !force) {
    await closeDatabase();
    console.error(
      `This would delete every record in "${name}", including any real activity data.\n` +
        'Re-run with --force if that is what you want:\n\n  npm run db:reset -- --force\n',
    );
    process.exit(1);
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  console.log(`Dropping ${collections.length} collections from "${name}"...`);

  for (const collection of collections) {
    // A time-series collection and its backing system.buckets view are
    // dropped together; ignore the second attempt.
    await db.dropCollection(collection.name).catch(() => undefined);
  }

  await syncIndexes(db);
  console.log(`Reset complete. Run "npm run seed" to repopulate "${name}".`);

  await closeDatabase();
}

main().catch((error) => {
  console.error('Reset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
