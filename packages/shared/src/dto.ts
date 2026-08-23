import { z } from 'zod';
import {
  appCategorySchema,
  entityStatusSchema,
  inactivityKindSchema,
  presenceStateSchema,
  roleSchema,
} from './enums.js';
import { agentConfigSchema, isoDateTime } from './protocol.js';

/**
 * Admin dashboard <-> API contracts.
 *
 * These are imported by both the API (for validation) and the admin app
 * (for response types), so a shape change surfaces as a compile error on
 * both sides at once.
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    pages: z.number().int().nonnegative(),
  });
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** `YYYY-MM-DD` in the organization's local reporting day. */
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const dateRangeQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  organizationId: z.string(),
  organizationName: z.string(),
  departmentId: z.string().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTime,
  user: adminUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Self-service company creation — the "Create Company" option on the
 * pre-login welcome screen. Creates a new organization and its first
 * ORG_OWNER account in one step, then signs them in immediately.
 */
export const registerOrganizationSchema = z.object({
  organizationName: z.string().min(2).max(120),
  adminName: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).max(256),
});
export type RegisterOrganizationRequest = z.infer<typeof registerOrganizationSchema>;

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const createEmployeeSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  jobTitle: z.string().max(120).optional(),
  departmentId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
});
export type CreateEmployeeRequest = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  status: entityStatusSchema.optional(),
});
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeSchema>;

/** Live presence, folded into list rows so the board renders in one request. */
export const employeePresenceSchema = z.object({
  state: presenceStateSchema,
  currentApplication: z.string().nullable(),
  /** Seconds in the current state — the UI ticks this forward locally. */
  stateSinceSec: z.number().int().nonnegative().nullable(),
  lastSeenAt: isoDateTime.nullable(),
  deviceId: z.string().nullable(),
});
export type EmployeePresence = z.infer<typeof employeePresenceSchema>;

export const employeeSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  managerId: z.string().nullable(),
  status: entityStatusSchema,
  hasCredentials: z.boolean(),
  deviceCount: z.number().int().nonnegative(),
  presence: employeePresenceSchema,
  todayActiveSec: z.number().int().nonnegative(),
  todayIdleSec: z.number().int().nonnegative(),
  createdAt: isoDateTime,
});
export type Employee = z.infer<typeof employeeSchema>;

export const employeeListQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(120).optional(),
  departmentId: z.string().optional(),
  status: entityStatusSchema.optional(),
  presence: presenceStateSchema.optional(),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

/**
 * The one-time credential payload. `tempPassword` is present exactly once,
 * in the response to generation; it is never stored in plaintext or returned
 * by any other endpoint.
 */
export const generatedCredentialsSchema = z.object({
  userId: z.string(),
  tempPassword: z.string(),
  mustChangePassword: z.boolean(),
  generatedAt: isoDateTime,
});
export type GeneratedCredentials = z.infer<typeof generatedCredentialsSchema>;

export const credentialStatusSchema = z.object({
  exists: z.boolean(),
  userId: z.string().nullable(),
  status: entityStatusSchema.nullable(),
  mustChangePassword: z.boolean(),
  lastLoginAt: isoDateTime.nullable(),
  generatedAt: isoDateTime.nullable(),
});
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const deviceSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  hostname: z.string(),
  os: z.string(),
  osVersion: z.string(),
  arch: z.string(),
  cpu: z.string().nullable(),
  cpuCores: z.number().int().nullable(),
  ramMb: z.number().int().nullable(),
  agentVersion: z.string(),
  status: entityStatusSchema,
  presence: presenceStateSchema,
  lastSeenAt: isoDateTime.nullable(),
  enrolledAt: isoDateTime,
});
export type Device = z.infer<typeof deviceSchema>;

export const deviceListQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(120).optional(),
  status: entityStatusSchema.optional(),
  presence: presenceStateSchema.optional(),
});
export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const appSessionSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  deviceId: z.string(),
  appName: z.string(),
  exeName: z.string(),
  windowTitle: z.string().nullable(),
  category: appCategorySchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSec: z.number().int().nonnegative(),
});
export type AppSession = z.infer<typeof appSessionSchema>;

/**
 * A single row of the §13 timeline. Application and inactivity spans are
 * merged into one chronological list so the UI renders a single track.
 */
export const timelineEntrySchema = z.object({
  kind: z.enum(['app', 'idle', 'locked', 'away']),
  label: z.string(),
  category: appCategorySchema.nullable(),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSec: z.number().int().nonnegative(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const timelineResponseSchema = z.object({
  date: dateOnly,
  entries: z.array(timelineEntrySchema),
  firstSeen: isoDateTime.nullable(),
  lastSeen: isoDateTime.nullable(),
});
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;

export const appUsageSchema = z.object({
  appName: z.string(),
  exeName: z.string(),
  category: appCategorySchema,
  durationSec: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
});
export type AppUsage = z.infer<typeof appUsageSchema>;

export const categoryBreakdownSchema = z.object({
  category: appCategorySchema,
  durationSec: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
});
export type CategoryBreakdown = z.infer<typeof categoryBreakdownSchema>;

/** The Applications page's "by employee" view — same window, grouped the
 *  other way, so a row can link straight to that person's detail page. */
export const employeeUsageRowSchema = z.object({
  employeeId: z.string(),
  employeeName: z.string(),
  topAppName: z.string(),
  topAppCategory: appCategorySchema,
  durationSec: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
});
export type EmployeeUsageRow = z.infer<typeof employeeUsageRowSchema>;

export const inactivitySpanSchema = z.object({
  id: z.string(),
  kind: inactivityKindSchema,
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSec: z.number().int().nonnegative(),
});
export type InactivitySpan = z.infer<typeof inactivitySpanSchema>;

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const attendanceDaySchema = z.object({
  employeeId: z.string(),
  employeeName: z.string(),
  date: dateOnly,
  firstSeen: isoDateTime.nullable(),
  lastSeen: isoDateTime.nullable(),
  activeSec: z.number().int().nonnegative(),
  idleSec: z.number().int().nonnegative(),
  lockedSec: z.number().int().nonnegative(),
  sessionSec: z.number().int().nonnegative(),
});
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;

export const attendanceSummarySchema = z.object({
  present: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  idle: z.number().int().nonnegative(),
  offline: z.number().int().nonnegative(),
});
export type AttendanceSummary = z.infer<typeof attendanceSummarySchema>;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export const overviewResponseSchema = z.object({
  employees: z.number().int().nonnegative(),
  online: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  idle: z.number().int().nonnegative(),
  locked: z.number().int().nonnegative(),
  offline: z.number().int().nonnegative(),
  devices: z.number().int().nonnegative(),
  todayActiveSec: z.number().int().nonnegative(),
  todayIdleSec: z.number().int().nonnegative(),
  todaySessions: z.number().int().nonnegative(),
  topActive: z.array(
    z.object({
      employeeId: z.string(),
      employeeName: z.string(),
      currentApplication: z.string().nullable(),
      activeSec: z.number().int().nonnegative(),
      presence: presenceStateSchema,
    }),
  ),
  hourlyActivity: z.array(
    z.object({ hour: z.number().int().min(0).max(23), activeSec: z.number().int().nonnegative() }),
  ),
});
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

// ---------------------------------------------------------------------------
// Policies & categories
// ---------------------------------------------------------------------------

/** Everything an admin may change; configVersion is bumped server-side. */
export const updatePolicySchema = agentConfigSchema
  .omit({ configVersion: true })
  .partial();
export type UpdatePolicyRequest = z.infer<typeof updatePolicySchema>;

export const policySchema = agentConfigSchema.extend({
  organizationId: z.string(),
  updatedAt: isoDateTime,
  updatedBy: z.string().nullable(),
});
export type Policy = z.infer<typeof policySchema>;

export const appCategoryRuleSchema = z.object({
  id: z.string(),
  exeName: z.string(),
  displayName: z.string(),
  category: appCategorySchema,
});
export type AppCategoryRule = z.infer<typeof appCategoryRuleSchema>;

export const upsertAppCategorySchema = z.object({
  exeName: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  category: appCategorySchema,
});
export type UpsertAppCategoryRequest = z.infer<typeof upsertAppCategorySchema>;

// ---------------------------------------------------------------------------
// Agent health & audit
// ---------------------------------------------------------------------------

export const agentHealthResponseSchema = z.object({
  installed: z.number().int().nonnegative(),
  healthy: z.number().int().nonnegative(),
  outdated: z.number().int().nonnegative(),
  offline: z.number().int().nonnegative(),
  revoked: z.number().int().nonnegative(),
  latestVersion: z.string().nullable(),
  versions: z.array(
    z.object({ version: z.string(), count: z.number().int().nonnegative() }),
  ),
});
export type AgentHealthResponse = z.infer<typeof agentHealthResponseSchema>;

export const auditLogSchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  targetLabel: z.string().nullable(),
  ip: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: isoDateTime,
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditListQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(120).optional(),
  actorId: z.string().optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

// ---------------------------------------------------------------------------
// Realtime (WebSocket)
// ---------------------------------------------------------------------------

/** Client -> server. Subscriptions are per-topic so pages get only what they show. */
export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), topics: z.array(z.string()).max(20) }),
  z.object({ type: z.literal('unsubscribe'), topics: z.array(z.string()).max(20) }),
  z.object({ type: z.literal('ping') }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export const presenceUpdateSchema = z.object({
  employeeId: z.string(),
  deviceId: z.string(),
  state: presenceStateSchema,
  currentApplication: z.string().nullable(),
  lastSeenAt: isoDateTime,
  stateSinceSec: z.number().int().nonnegative(),
});
export type PresenceUpdate = z.infer<typeof presenceUpdateSchema>;

/** Server -> client. */
export const wsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), serverTime: isoDateTime }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('subscribed'), topics: z.array(z.string()) }),
  z.object({ type: z.literal('presence'), data: presenceUpdateSchema }),
  z.object({ type: z.literal('overview'), data: overviewResponseSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

export const WS_TOPICS = {
  Presence: 'presence',
  Overview: 'overview',
} as const;
