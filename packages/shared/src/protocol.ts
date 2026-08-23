import { z } from 'zod';
import {
  agentLogLevelSchema,
  inactivityKindSchema,
  reportedPresenceSchema,
} from './enums.js';

/**
 * THE AGENT <-> API CONTRACT.
 *
 * `agent/crates/wp-core/src/protocol.rs` mirrors this file field for field.
 * Changing anything here means changing that file too; the agent's `--selftest`
 * mode exists to catch the moment they drift apart.
 *
 * Timestamps are always RFC3339 / ISO-8601 strings in UTC. We keep them as
 * strings on the wire so serde and Zod agree without timezone guesswork, and
 * parse to Date only at the storage boundary.
 */

export const PROTOCOL_VERSION = 1;

export const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .describe('RFC3339 timestamp');

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/**
 * Hardware/OS facts collected once at enrollment and refreshed on version
 * change. Nothing here identifies a *person* — that link is made server-side
 * from the credentials used to enroll.
 */
export const deviceInfoSchema = z.object({
  hostname: z.string().min(1).max(255),
  os: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(64),
  arch: z.string().min(1).max(32),
  cpu: z.string().max(255).optional(),
  cpuCores: z.number().int().positive().max(1024).optional(),
  ramMb: z.number().int().positive().max(8_388_608).optional(),
  agentVersion: z.string().min(1).max(32),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

/**
 * First contact. The employee types their admin-issued userId and one-time
 * password into the tray exactly once; the agent trades them for a device
 * secret and then forgets the password.
 */
export const enrollRequestSchema = z.object({
  userId: z.string().min(3).max(64),
  password: z.string().min(8).max(256),
  device: deviceInfoSchema,
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export const enrollResponseSchema = z.object({
  deviceId: z.string(),
  /** Returned exactly once, at enrollment. Never retrievable again. */
  deviceSecret: z.string(),
  employee: z.object({
    id: z.string(),
    name: z.string(),
    organizationId: z.string(),
    organizationName: z.string(),
  }),
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTime,
  config: z.lazy(() => agentConfigSchema),
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Steady-state auth: device secret in, short-lived access token out. */
export const tokenRequestSchema = z.object({
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1),
});
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTime,
  configVersion: z.number().int().nonnegative(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// ---------------------------------------------------------------------------
// Policy / config
// ---------------------------------------------------------------------------

/**
 * What the agent is permitted to collect, decided centrally (spec §30).
 * The agent gates every collector on these flags — a disabled collector does
 * not run at all, rather than running and discarding.
 */
export const agentConfigSchema = z.object({
  configVersion: z.number().int().nonnegative(),
  trackApplications: z.boolean(),
  trackWindowTitles: z.boolean(),
  trackWebsites: z.boolean(),
  trackScreenshots: z.boolean(),
  idleThresholdSec: z.number().int().min(30).max(3600),
  heartbeatSec: z.number().int().min(5).max(600),
  telemetryFlushSec: z.number().int().min(10).max(600),
  configRefreshSec: z.number().int().min(60).max(86_400),
  maxQueueBytes: z.number().int().min(1_048_576).max(1_073_741_824),
  retentionDays: z.number().int().min(1).max(3650),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/** Sent to the tray so it can show the employee what is and isn't collected. */
export const agentConfigResponseSchema = z.object({
  config: agentConfigSchema,
  serverTime: isoDateTime,
});
export type AgentConfigResponse = z.infer<typeof agentConfigResponseSchema>;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const heartbeatRequestSchema = z.object({
  status: reportedPresenceSchema,
  idleSeconds: z.number().int().nonnegative().max(86_400),
  currentApplication: z.string().max(255).nullable().optional(),
  agentVersion: z.string().min(1).max(32),
  queueDepth: z.number().int().nonnegative().optional(),
  sentAt: isoDateTime,
});
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const heartbeatResponseSchema = z.object({
  ok: z.literal(true),
  serverTime: isoDateTime,
  /** Agent compares this to its own; a mismatch triggers a config fetch. */
  configVersion: z.number().int().nonnegative(),
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

// ---------------------------------------------------------------------------
// Telemetry events
// ---------------------------------------------------------------------------

/**
 * A completed span of foreground application use. The agent sessionizes
 * locally so the server never has to reconstruct spans from raw samples.
 */
export const appSessionEventSchema = z.object({
  type: z.literal('app_session'),
  /** Agent-generated, used for idempotent ingest across queue replays. */
  eventId: z.string().min(8).max(64),
  appName: z.string().min(1).max(255),
  exeName: z.string().min(1).max(255),
  /** Only populated when policy.trackWindowTitles is on. */
  windowTitle: z.string().max(512).nullable().optional(),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSec: z.number().int().nonnegative().max(86_400),
});
export type AppSessionEvent = z.infer<typeof appSessionEventSchema>;

/** A completed span of not-working: idle, screen locked, or long-away. */
export const inactivityEventSchema = z.object({
  type: z.literal('inactivity'),
  eventId: z.string().min(8).max(64),
  kind: inactivityKindSchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSec: z.number().int().nonnegative().max(86_400),
});
export type InactivityEvent = z.infer<typeof inactivityEventSchema>;

/** Agent lifecycle: started, stopped, service recovered, update applied. */
export const agentLogEventSchema = z.object({
  type: z.literal('agent_log'),
  eventId: z.string().min(8).max(64),
  level: agentLogLevelSchema,
  message: z.string().min(1).max(1024),
  occurredAt: isoDateTime,
});
export type AgentLogEvent = z.infer<typeof agentLogEventSchema>;

export const telemetryEventSchema = z.discriminatedUnion('type', [
  appSessionEventSchema,
  inactivityEventSchema,
  agentLogEventSchema,
]);
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/** Batches are capped so a long offline period replays in chunks. */
export const TELEMETRY_MAX_BATCH = 500;

export const telemetryRequestSchema = z.object({
  batchId: z.string().min(8).max(64),
  events: z.array(telemetryEventSchema).min(1).max(TELEMETRY_MAX_BATCH),
});
export type TelemetryRequest = z.infer<typeof telemetryRequestSchema>;

export const telemetryResponseSchema = z.object({
  ok: z.literal(true),
  accepted: z.number().int().nonnegative(),
  /** Events already stored from an earlier delivery of the same eventIds. */
  duplicates: z.number().int().nonnegative(),
  rejected: z.array(
    z.object({ eventId: z.string(), reason: z.string() }),
  ),
  serverTime: isoDateTime,
});
export type TelemetryResponse = z.infer<typeof telemetryResponseSchema>;

// ---------------------------------------------------------------------------
// Status (tray transparency screen)
// ---------------------------------------------------------------------------

export const agentStatusResponseSchema = z.object({
  employee: z.object({ id: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), name: z.string() }),
  device: z.object({
    id: z.string(),
    hostname: z.string(),
    status: z.string(),
    enrolledAt: isoDateTime,
  }),
  /** Human-readable, rendered verbatim by the tray (spec §43). */
  collected: z.array(z.string()),
  notCollected: z.array(z.string()),
  serverTime: isoDateTime,
});
export type AgentStatusResponse = z.infer<typeof agentStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Error codes the agent branches on. Anything else is treated as retryable.
 * DEVICE_REVOKED and DEVICE_UNKNOWN are terminal: the agent wipes its stored
 * secret and returns to the un-enrolled state rather than retrying forever.
 */
export const AgentErrorCode = {
  InvalidCredentials: 'INVALID_CREDENTIALS',
  CredentialsRevoked: 'CREDENTIALS_REVOKED',
  DeviceRevoked: 'DEVICE_REVOKED',
  DeviceUnknown: 'DEVICE_UNKNOWN',
  TokenExpired: 'TOKEN_EXPIRED',
  RateLimited: 'RATE_LIMITED',
} as const;
export type AgentErrorCode = (typeof AgentErrorCode)[keyof typeof AgentErrorCode];

/** Terminal for the device: stop retrying, drop local identity, re-enroll. */
export const TERMINAL_AGENT_ERRORS: readonly string[] = [
  AgentErrorCode.DeviceRevoked,
  AgentErrorCode.DeviceUnknown,
  AgentErrorCode.CredentialsRevoked,
];
