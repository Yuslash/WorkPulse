import type { ObjectId } from 'mongodb';
import type {
  AgentLogLevel,
  AppCategory,
  EntityStatus,
  InactivityKind,
  PresenceState,
  Role,
} from '@workpulse/shared';

/**
 * MongoDB document shapes.
 *
 * Every tenant-scoped document carries `organizationId` as its first field.
 * `db/repo.ts` builds filters that always include it, so a route physically
 * cannot query across tenants by forgetting a clause.
 */

export interface OrganizationDoc {
  _id: ObjectId;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  name: string;
  createdAt: Date;
}

export interface UserDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  email: string;
  name: string;
  /** scrypt: `scrypt$N$r$p$saltB64$hashB64`. Never a reversible encoding. */
  passwordHash: string;
  role: Role;
  /** Scopes MANAGER/TEAM_LEAD to a slice of the org; null for org-wide roles. */
  departmentId: ObjectId | null;
  status: EntityStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  name: string;
  email: string;
  jobTitle: string | null;
  departmentId: ObjectId | null;
  managerId: ObjectId | null;
  status: EntityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeCredentialDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  employeeId: ObjectId;
  /** Human-facing login, e.g. `EMP-4021`. Unique per organization. */
  userId: string;
  passwordHash: string;
  mustChangePassword: boolean;
  status: EntityStatus;
  lastLoginAt: Date | null;
  generatedBy: ObjectId | null;
  generatedAt: Date;
  updatedAt: Date;
}

export interface DeviceDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  employeeId: ObjectId;
  /** Hash of the device secret. The plaintext exists only on the endpoint. */
  secretHash: string;
  hostname: string;
  os: string;
  osVersion: string;
  arch: string;
  cpu: string | null;
  cpuCores: number | null;
  ramMb: number | null;
  agentVersion: string;
  status: EntityStatus;
  lastSeenAt: Date | null;
  /** Last reported by the agent; the sweeper derives OFFLINE from lastSeenAt. */
  lastReportedState: PresenceState | null;
  currentApplication: string | null;
  stateSince: Date | null;
  /** Current active shift sent via heartbeat (DAY_SHIFT, NIGHT_SHIFT, MIDNIGHT_SHIFT) */
  currentShift: string | null;
  enrolledAt: Date;
  updatedAt: Date;
}

export interface PolicyDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  configVersion: number;
  trackApplications: boolean;
  trackWindowTitles: boolean;
  trackWebsites: boolean;
  trackScreenshots: boolean;
  idleThresholdSec: number;
  heartbeatSec: number;
  telemetryFlushSec: number;
  configRefreshSec: number;
  maxQueueBytes: number;
  retentionDays: number;
  updatedBy: ObjectId | null;
  updatedAt: Date;
}

export interface AppSessionDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  employeeId: ObjectId;
  deviceId: ObjectId;
  /** Agent-generated id; a unique index on it makes replays idempotent. */
  eventId: string;
  appName: string;
  exeName: string;
  windowTitle: string | null;
  category: AppCategory;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  /** UTC `YYYY-MM-DD` of `startedAt`; lets rollups group without $dateToString. */
  dateKey: string;
  createdAt: Date;
}

export interface InactivityDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  employeeId: ObjectId;
  deviceId: ObjectId;
  eventId: string;
  kind: InactivityKind;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  dateKey: string;
  createdAt: Date;
}

/** Time-series collection: `timeField: ts`, `metaField: meta`. */
export interface HeartbeatDoc {
  ts: Date;
  meta: {
    organizationId: ObjectId;
    employeeId: ObjectId;
    deviceId: ObjectId;
  };
  state: PresenceState;
  idleSeconds: number;
  currentApplication: string | null;
  agentVersion: string;
  queueDepth: number | null;
}

export interface AttendanceDayDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  employeeId: ObjectId;
  dateKey: string;
  firstSeen: Date | null;
  lastSeen: Date | null;
  activeSec: number;
  idleSec: number;
  lockedSec: number;
  /** firstSeen -> lastSeen wall-clock, which includes breaks. */
  sessionSec: number;
  updatedAt: Date;
}

export interface AppCategoryDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  /** Lowercased executable name, e.g. `code.exe`. */
  exeName: string;
  displayName: string;
  category: AppCategory;
  updatedAt: Date;
}

export interface AuditLogDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  actorId: ObjectId | null;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AgentLogDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  employeeId: ObjectId;
  deviceId: ObjectId;
  eventId: string;
  level: AgentLogLevel;
  message: string;
  occurredAt: Date;
  createdAt: Date;
}

export interface RefreshTokenDoc {
  _id: ObjectId;
  organizationId: ObjectId;
  /** `admin` tokens belong to a UserDoc, `device` tokens to a DeviceDoc. */
  subjectType: 'admin' | 'device';
  subjectId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}
