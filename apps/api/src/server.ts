import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase, connectDatabase } from './db/client.js';
import { syncIndexes } from './db/indexes.js';
import { presence } from './services/presence.js';
import { hub } from './modules/realtime/hub.js';
import { startAttendanceWorker, stopAttendanceWorker, flushAttendance } from './modules/attendance/service.js';

/**
 * Process entry point. Boot order matters: the database has to be reachable
 * and indexed, and presence has to be rehydrated, before the first request is
 * accepted — otherwise the live board would come up blank after a restart.
 */
async function main(): Promise<void> {
  const db = await connectDatabase();
  await syncIndexes(db);

  await presence.hydrate();
  presence.startSweeper();
  hub.start();
  startAttendanceWorker();

  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');

    presence.stopSweeper();
    stopAttendanceWorker();
    hub.closeAll();

    // Drain pending rollups so a deploy does not discard the last minute of
    // attendance data.
    await flushAttendance().catch(() => undefined);

    await app.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(
    { db: db.databaseName, port: env.API_PORT },
    'workpulse api ready',
  );
}

main().catch((error) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
