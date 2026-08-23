import { z } from 'zod';

/**
 * Presence is what the *server* believes about a device right now.
 *
 * OFFLINE is derived, not reported: the sweeper assigns it when heartbeats stop.
 * Everything else is reported by the agent.
 */
export const PresenceState = {
  Active: 'ACTIVE',
  Idle: 'IDLE',
  Locked: 'LOCKED',
  Offline: 'OFFLINE',
} as const;
export type PresenceState = (typeof PresenceState)[keyof typeof PresenceState];
export const presenceStateSchema = z.enum(['ACTIVE', 'IDLE', 'LOCKED', 'OFFLINE']);

/** Reported presence — the subset an agent is allowed to claim. */
export const reportedPresenceSchema = z.enum(['ACTIVE', 'IDLE', 'LOCKED']);
export type ReportedPresence = z.infer<typeof reportedPresenceSchema>;

/** Non-active spans. `away` is a long idle promoted by the sessionizer. */
export const InactivityKind = {
  Idle: 'idle',
  Locked: 'locked',
  Away: 'away',
} as const;
export type InactivityKind = (typeof InactivityKind)[keyof typeof InactivityKind];
export const inactivityKindSchema = z.enum(['idle', 'locked', 'away']);

/**
 * Admin roles, ordered least to most privileged.
 * Comparisons use `roleRank` rather than string equality so new roles slot in.
 */
export const Role = {
  TeamLead: 'TEAM_LEAD',
  Manager: 'MANAGER',
  HrAdmin: 'HR_ADMIN',
  OrgOwner: 'ORG_OWNER',
  SuperAdmin: 'SUPER_ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const roleSchema = z.enum(['TEAM_LEAD', 'MANAGER', 'HR_ADMIN', 'ORG_OWNER', 'SUPER_ADMIN']);

export const roleRank: Record<Role, number> = {
  TEAM_LEAD: 10,
  MANAGER: 20,
  HR_ADMIN: 30,
  ORG_OWNER: 40,
  SUPER_ADMIN: 50,
};

/** True when `role` is at least as privileged as `required`. */
export function roleAtLeast(role: Role, required: Role): boolean {
  return roleRank[role] >= roleRank[required];
}

/**
 * Application categories are organization-configurable (spec §15).
 * We deliberately ship no opinion about which apps are "productive" — the
 * defaults map everything to Neutral until an admin says otherwise.
 */
export const AppCategory = {
  Productive: 'PRODUCTIVE',
  Neutral: 'NEUTRAL',
  Break: 'BREAK',
  Restricted: 'RESTRICTED',
} as const;
export type AppCategory = (typeof AppCategory)[keyof typeof AppCategory];
export const appCategorySchema = z.enum(['PRODUCTIVE', 'NEUTRAL', 'BREAK', 'RESTRICTED']);

/** Lifecycle shared by employees, devices and credentials. */
export const EntityStatus = {
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED',
  Revoked: 'REVOKED',
} as const;
export type EntityStatus = (typeof EntityStatus)[keyof typeof EntityStatus];
export const entityStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']);

/** Agent-reported log severity. */
export const agentLogLevelSchema = z.enum(['INFO', 'WARN', 'ERROR']);
export type AgentLogLevel = z.infer<typeof agentLogLevelSchema>;

/**
 * Audit actions. Every privileged read *and* write is recorded (spec §33) —
 * viewing an employee record is itself auditable.
 */
export const AuditAction = {
  OrganizationCreated: 'organization.created',
  AdminLogin: 'admin.login',
  AdminLoginFailed: 'admin.login_failed',
  AdminLogout: 'admin.logout',
  EmployeeCreated: 'employee.created',
  EmployeeUpdated: 'employee.updated',
  EmployeeViewed: 'employee.viewed',
  CredentialsGenerated: 'employee.credentials_generated',
  CredentialsRevoked: 'employee.credentials_revoked',
  DeviceEnrolled: 'device.enrolled',
  DeviceRevoked: 'device.revoked',
  PolicyUpdated: 'policy.updated',
  AppCategoryUpdated: 'app_category.updated',
  ReportExported: 'report.exported',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
