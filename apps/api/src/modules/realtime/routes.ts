import type { FastifyInstance } from 'fastify';
import { WS_TOPICS, wsClientMessageSchema, type WsServerMessage } from '@workpulse/shared';
import { verifyAdminToken } from '../../lib/tokens.js';
import { hub } from './hub.js';

/**
 * The dashboard's live connection.
 *
 * Browsers cannot set an Authorization header on a WebSocket handshake, so the
 * access token arrives as a query parameter. It is the same short-lived admin
 * JWT used for HTTP — the socket is authenticated before a single frame is
 * accepted, and an unauthenticated handshake is closed immediately.
 */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { websocket: true }, async (socket, request) => {
    const token = (request.query as { token?: string } | undefined)?.token;

    if (!token) {
      socket.close(4401, 'Missing token');
      return;
    }

    let organizationId: string;
    try {
      const claims = await verifyAdminToken(token);
      organizationId = claims.org;
    } catch {
      socket.close(4401, 'Invalid token');
      return;
    }

    const client = hub.add(socket, organizationId);

    const reply = (message: WsServerMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(message));
    };

    reply({ type: 'ready', serverTime: new Date().toISOString() });

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        reply({ type: 'error', message: 'Malformed JSON' });
        return;
      }

      const result = wsClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        reply({ type: 'error', message: 'Unknown message' });
        return;
      }

      switch (result.data.type) {
        case 'ping':
          reply({ type: 'pong' });
          break;

        case 'subscribe': {
          const topics = hub.subscribe(client, result.data.topics);
          reply({ type: 'subscribed', topics });

          // Send the current state immediately so a freshly opened page is
          // populated without waiting for the next change.
          hub.sendInitialPresence(client);
          void hub.sendInitialOverview(client).catch(() => undefined);
          break;
        }

        case 'unsubscribe':
          reply({ type: 'subscribed', topics: hub.unsubscribe(client, result.data.topics) });
          break;
      }
    });

    socket.on('close', () => hub.remove(client));
    socket.on('error', () => hub.remove(client));
  });

  app.get('/topics', async () => ({ topics: Object.values(WS_TOPICS) }));
}
