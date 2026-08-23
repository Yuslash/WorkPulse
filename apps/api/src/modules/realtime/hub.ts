import type { WebSocket } from 'ws';
import { WS_TOPICS, type PresenceUpdate, type WsServerMessage } from '@workpulse/shared';
import { presence } from '../../services/presence.js';
import { getOverview } from '../overview/service.js';
import { ObjectId } from 'mongodb';

/**
 * WebSocket fan-out (spec §23).
 *
 * Connections are grouped by organization, so a presence change is delivered
 * only to dashboards of that tenant — the isolation that applies to HTTP has
 * to apply to the socket too, or the live board becomes a cross-tenant leak.
 *
 * Overview snapshots are throttled: presence can change many times a second
 * across a large fleet, but a header showing "72 active" does not need to be
 * recomputed more than once every few seconds.
 */

const OVERVIEW_THROTTLE_MS = 3000;

interface Client {
  socket: WebSocket;
  organizationId: string;
  topics: Set<string>;
}

class RealtimeHub {
  private readonly clients = new Set<Client>();
  private readonly pendingOverview = new Map<string, NodeJS.Timeout>();
  private listening = false;

  /** Wires the presence store's change events into the socket fan-out. */
  start(): void {
    if (this.listening) return;
    this.listening = true;

    presence.on('change', (update: PresenceUpdate & { organizationId: string }) => {
      const { organizationId, ...payload } = update;
      this.broadcast(organizationId, WS_TOPICS.Presence, { type: 'presence', data: payload });
      this.scheduleOverview(organizationId);
    });
  }

  add(socket: WebSocket, organizationId: string): Client {
    const client: Client = { socket, organizationId, topics: new Set() };
    this.clients.add(client);
    return client;
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  subscribe(client: Client, topics: string[]): string[] {
    for (const topic of topics) client.topics.add(topic);
    return [...client.topics];
  }

  unsubscribe(client: Client, topics: string[]): string[] {
    for (const topic of topics) client.topics.delete(topic);
    return [...client.topics];
  }

  private broadcast(organizationId: string, topic: string, message: WsServerMessage): void {
    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.organizationId !== organizationId) continue;
      if (!client.topics.has(topic)) continue;
      send(client.socket, payload);
    }
  }

  /**
   * Coalesces a burst of presence changes into one overview recompute per
   * organization per throttle window.
   */
  private scheduleOverview(organizationId: string): void {
    if (this.pendingOverview.has(organizationId)) return;

    const timer = setTimeout(() => {
      this.pendingOverview.delete(organizationId);
      void this.pushOverview(organizationId).catch(() => undefined);
    }, OVERVIEW_THROTTLE_MS);

    timer.unref();
    this.pendingOverview.set(organizationId, timer);
  }

  private async pushOverview(organizationId: string): Promise<void> {
    const hasSubscribers = [...this.clients].some(
      (client) => client.organizationId === organizationId && client.topics.has(WS_TOPICS.Overview),
    );
    if (!hasSubscribers) return;

    const data = await getOverview(new ObjectId(organizationId));
    this.broadcast(organizationId, WS_TOPICS.Overview, { type: 'overview', data });
  }

  /** Sends the current board to a client that just subscribed. */
  async sendInitialOverview(client: Client): Promise<void> {
    if (!client.topics.has(WS_TOPICS.Overview)) return;
    const data = await getOverview(new ObjectId(client.organizationId));
    send(client.socket, JSON.stringify({ type: 'overview', data } satisfies WsServerMessage));
  }

  sendInitialPresence(client: Client): void {
    if (!client.topics.has(WS_TOPICS.Presence)) return;

    for (const record of presence.snapshotForOrg(client.organizationId).values()) {
      const message: WsServerMessage = {
        type: 'presence',
        data: {
          employeeId: record.employeeId,
          deviceId: record.deviceId,
          state: record.state,
          currentApplication: record.currentApplication,
          lastSeenAt: record.lastSeenAt.toISOString(),
          stateSinceSec: Math.max(0, Math.round((Date.now() - record.stateSince.getTime()) / 1000)),
        },
      };
      send(client.socket, JSON.stringify(message));
    }
  }

  closeAll(): void {
    for (const timer of this.pendingOverview.values()) clearTimeout(timer);
    this.pendingOverview.clear();

    for (const client of this.clients) {
      try {
        client.socket.close();
      } catch {
        // Socket already gone; nothing to clean up.
      }
    }
    this.clients.clear();
  }

  clientCount(): number {
    return this.clients.size;
  }
}

/** OPEN === 1; guarded so a closing socket cannot throw into the emitter. */
function send(socket: WebSocket, payload: string): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(payload);
  } catch {
    // A client that vanished mid-broadcast is removed on its 'close' event.
  }
}

export const hub = new RealtimeHub();
export type { Client as RealtimeClient };
