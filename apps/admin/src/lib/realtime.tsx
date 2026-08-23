import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { OverviewResponse, PresenceUpdate, WsServerMessage } from '@workpulse/shared';
import { WS_TOPICS } from '@workpulse/shared';
import { getAccessToken } from './api';
import { useAuth } from './auth';

/**
 * One WebSocket for the whole dashboard (spec §23).
 *
 * Every page reads from the same connection rather than opening its own: a
 * hundred admins with five tabs each would otherwise be five hundred sockets
 * for data that is identical per organization.
 */

interface RealtimeContextValue {
  connected: boolean;
  /** Latest presence per employee id. */
  presence: Map<string, PresenceUpdate>;
  /** Pushed overview snapshot, or null before the first arrives. */
  overview: OverviewResponse | null;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  presence: new Map(),
  overview: null,
});

const WS_URL = import.meta.env.VITE_WS_URL ?? '';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 25_000;

function socketUrl(token: string): string {
  if (WS_URL) return `${WS_URL}/ws?token=${encodeURIComponent(token)}`;

  // Falling back to the page origin means the Vite dev proxy and a production
  // reverse proxy both work without extra configuration.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<Map<string, PresenceUpdate>>(new Map());
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const pingRef = useRef<number | null>(null);
  // Set while unmounting so a scheduled reconnect does not resurrect the socket.
  const closedRef = useRef(false);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || closedRef.current) return;

    const socket = new WebSocket(socketUrl(token));
    socketRef.current = socket;

    socket.onopen = () => {
      attemptRef.current = 0;
      setConnected(true);

      socket.send(
        JSON.stringify({
          type: 'subscribe',
          topics: [WS_TOPICS.Presence, WS_TOPICS.Overview],
        }),
      );

      // Keeps intermediaries from dropping an idle connection.
      pingRef.current = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      let message: WsServerMessage;
      try {
        message = JSON.parse(event.data as string) as WsServerMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'presence':
          setPresence((current) => {
            const next = new Map(current);
            next.set(message.data.employeeId, message.data);
            return next;
          });
          break;

        case 'overview':
          setOverview(message.data);
          break;

        default:
          break;
      }
    };

    const scheduleReconnect = () => {
      setConnected(false);
      if (pingRef.current) {
        window.clearInterval(pingRef.current);
        pingRef.current = null;
      }
      if (closedRef.current) return;

      // Exponential backoff so a server restart does not get hammered by
      // every open dashboard at once.
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
      attemptRef.current += 1;
      reconnectRef.current = window.setTimeout(connect, delay);
    };

    socket.onclose = scheduleReconnect;
    socket.onerror = () => socket.close();
  }, []);

  useEffect(() => {
    if (!user) {
      // Signed out: tear down and clear, so a different admin signing in does
      // not briefly see the previous organization's board.
      socketRef.current?.close();
      setPresence(new Map());
      setOverview(null);
      setConnected(false);
      return;
    }

    closedRef.current = false;
    connect();

    return () => {
      closedRef.current = true;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      if (pingRef.current) window.clearInterval(pingRef.current);
      socketRef.current?.close();
    };
  }, [user, connect]);

  const value = useMemo(
    () => ({ connected, presence, overview }),
    [connected, presence, overview],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/** Live presence for one employee, or undefined if nothing has arrived. */
export function useEmployeePresence(employeeId: string): PresenceUpdate | undefined {
  return useRealtime().presence.get(employeeId);
}
