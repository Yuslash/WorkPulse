import { randomUUID } from 'node:crypto';
import {
  agentConfigResponseSchema,
  enrollResponseSchema,
  heartbeatResponseSchema,
  telemetryResponseSchema,
  tokenResponseSchema,
  type AgentConfig,
  type DeviceInfo,
  type ReportedPresence,
  type TelemetryEvent,
} from '@workpulse/shared';

/**
 * A software endpoint that speaks the real agent protocol.
 *
 * Every response is validated against the shared Zod schemas, so this is not
 * just a load generator — it is a conformance check that runs on every build.
 * If the API changes a field name, this fails immediately instead of the
 * breakage surfacing weeks later on a deployed Rust binary.
 *
 * It also lets a scenario play out an eight-hour workday in milliseconds by
 * generating spans with explicit timestamps rather than waiting for them.
 */

export interface VirtualAgentOptions {
  baseUrl: string;
  hostname?: string;
  agentVersion?: string;
}

export class ProtocolError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`${code} (${status}): ${message}`);
    this.name = 'ProtocolError';
    this.status = status;
    this.code = code;
  }
}

export class VirtualAgent {
  readonly hostname: string;
  readonly agentVersion: string;

  private readonly baseUrl: string;
  private deviceId: string | null = null;
  private deviceSecret: string | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  /** Events collected but not yet delivered — the endpoint's offline queue. */
  private queue: TelemetryEvent[] = [];
  private online = true;

  config: AgentConfig | null = null;
  employeeId: string | null = null;

  constructor(options: VirtualAgentOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.hostname = options.hostname ?? `VM-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.agentVersion = options.agentVersion ?? '1.0.0';
  }

  get deviceInfo(): DeviceInfo {
    return {
      hostname: this.hostname,
      os: 'Windows',
      osVersion: '10.0.19045',
      arch: 'x86_64',
      cpu: 'Virtual CPU',
      cpuCores: 8,
      ramMb: 16384,
      agentVersion: this.agentVersion,
    };
  }

  get id(): string {
    if (!this.deviceId) throw new Error('agent is not enrolled');
    return this.deviceId;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  /** Simulates losing and regaining the network. */
  setOnline(online: boolean): void {
    this.online = online;
  }

  private async call<T>(
    path: string,
    init: { method: string; body?: unknown; auth?: boolean },
  ): Promise<T> {
    if (!this.online) throw new ProtocolError(0, 'OFFLINE', 'network unavailable');

    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    if (init.auth) {
      headers.authorization = `Bearer ${await this.ensureToken()}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (!response.ok) {
      let code = 'UNKNOWN';
      let message = response.statusText;

      try {
        const body = (await response.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        // Non-JSON error body; the status alone has to carry the meaning.
      }

      throw new ProtocolError(response.status, code, message);
    }

    return (await response.json()) as T;
  }

  /** Refreshes the access token when it is close to expiring. */
  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    if (!this.deviceId || !this.deviceSecret) {
      throw new Error('agent is not enrolled');
    }

    const raw = await this.call<unknown>('/api/agent/token', {
      method: 'POST',
      body: { deviceId: this.deviceId, deviceSecret: this.deviceSecret },
    });

    const parsed = tokenResponseSchema.parse(raw);
    this.accessToken = parsed.accessToken;
    this.accessTokenExpiresAt = new Date(parsed.accessTokenExpiresAt).getTime();
    return parsed.accessToken;
  }

  async enroll(userId: string, password: string): Promise<void> {
    const raw = await this.call<unknown>('/api/agent/enroll', {
      method: 'POST',
      body: { userId, password, device: this.deviceInfo },
    });

    const parsed = enrollResponseSchema.parse(raw);

    this.deviceId = parsed.deviceId;
    this.deviceSecret = parsed.deviceSecret;
    this.accessToken = parsed.accessToken;
    this.accessTokenExpiresAt = new Date(parsed.accessTokenExpiresAt).getTime();
    this.config = parsed.config;
    this.employeeId = parsed.employee.id;
  }

  async heartbeat(
    status: ReportedPresence,
    options: { idleSeconds?: number; currentApplication?: string | null } = {},
  ): Promise<{ configVersion: number }> {
    const raw = await this.call<unknown>('/api/agent/heartbeat', {
      method: 'POST',
      auth: true,
      body: {
        status,
        idleSeconds: options.idleSeconds ?? 0,
        currentApplication: options.currentApplication ?? null,
        agentVersion: this.agentVersion,
        queueDepth: this.queue.length,
        sentAt: new Date().toISOString(),
      },
    });

    return heartbeatResponseSchema.parse(raw);
  }

  /** Queues an event locally, exactly as the real agent does. */
  enqueue(event: TelemetryEvent): void {
    this.queue.push(event);
  }

  /**
   * Delivers the queue in batches. Events are removed only after the server
   * acknowledges them, so an offline flush leaves the queue intact.
   */
  async flush(): Promise<{ accepted: number; duplicates: number; rejected: number }> {
    const totals = { accepted: 0, duplicates: 0, rejected: 0 };

    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, 500);

      const raw = await this.call<unknown>('/api/agent/telemetry', {
        method: 'POST',
        auth: true,
        body: { batchId: `batch-${randomUUID()}`, events: batch },
      });

      const parsed = telemetryResponseSchema.parse(raw);
      totals.accepted += parsed.accepted;
      totals.duplicates += parsed.duplicates;
      totals.rejected += parsed.rejected.length;

      this.queue = this.queue.slice(batch.length);
    }

    return totals;
  }

  /** Re-sends the last delivery without clearing, to test idempotency. */
  async resend(events: TelemetryEvent[]): Promise<{ accepted: number; duplicates: number }> {
    const raw = await this.call<unknown>('/api/agent/telemetry', {
      method: 'POST',
      auth: true,
      body: { batchId: `batch-${randomUUID()}`, events },
    });

    const parsed = telemetryResponseSchema.parse(raw);
    return { accepted: parsed.accepted, duplicates: parsed.duplicates };
  }

  async fetchConfig(): Promise<AgentConfig> {
    const raw = await this.call<unknown>('/api/agent/config', { method: 'GET', auth: true });
    const parsed = agentConfigResponseSchema.parse(raw);
    this.config = parsed.config;
    return parsed.config;
  }

  async fetchStatus(): Promise<{ collected: string[]; notCollected: string[] }> {
    return this.call('/api/agent/status', { method: 'GET', auth: true });
  }

  /** Forces the next call to re-exchange the device secret. */
  expireToken(): void {
    this.accessTokenExpiresAt = 0;
  }
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

export function appSession(
  appName: string,
  exeName: string,
  startedAt: Date,
  durationSec: number,
  windowTitle: string | null = null,
): TelemetryEvent {
  return {
    type: 'app_session',
    eventId: `app-${randomUUID()}`,
    appName,
    exeName,
    windowTitle,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + durationSec * 1000).toISOString(),
    durationSec,
  };
}

export function inactivity(
  kind: 'idle' | 'locked' | 'away',
  startedAt: Date,
  durationSec: number,
): TelemetryEvent {
  return {
    type: 'inactivity',
    eventId: `idle-${randomUUID()}`,
    kind,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + durationSec * 1000).toISOString(),
    durationSec,
  };
}

export function agentLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  occurredAt = new Date(),
): TelemetryEvent {
  return {
    type: 'agent_log',
    eventId: `log-${randomUUID()}`,
    level,
    message,
    occurredAt: occurredAt.toISOString(),
  };
}
