import { closeDatabase, connectDatabase } from './client.js';
import { syncIndexes } from './indexes.js';
import { env } from '../config/env.js';

/** `npm run db:indexes` — creates collections, indexes and TTLs. Idempotent. */
async function main(): Promise<void> {
  const db = await connectDatabase();
  console.log(`Syncing indexes on "${db.databaseName}" (${env.NODE_ENV})...`);

  await syncIndexes(db);

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  console.log(`Done. ${collections.length} collections:`);
  for (const collection of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  - ${collection.name}`);
  }

  await closeDatabase();
}

main().catch((error) => {
  console.error('Index sync failed:', error);
  process.exit(1);
});
