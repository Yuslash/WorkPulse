import type { Filter } from 'mongodb';
import { Role, roleAtLeast } from '@workpulse/shared';
import type { AdminIdentity } from '../plugins/auth.js';
import type { EmployeeDoc } from '../db/types.js';

/**
 * Tenant + department scoping, in one place.
 *
 * Every read of employee-derived data goes through `employeeScope`. Routes
 * never write `{ organizationId }` by hand, which is what stops a missing
 * clause from turning into a cross-tenant data leak.
 *
 * MANAGER and TEAM_LEAD see only their own department (spec §32); HR_ADMIN and
 * above see the whole organization. SUPER_ADMIN is still org-scoped here —
 * cross-org access is a separate, explicit code path, not an implicit widening.
 */
export function employeeScope(admin: AdminIdentity): Filter<EmployeeDoc> {
  const filter: Filter<EmployeeDoc> = { organizationId: admin.organizationId };

  if (roleAtLeast(admin.role, Role.HrAdmin)) return filter;

  if (admin.departmentId === null) {
    // A department-scoped admin with no department must see NOBODY. Filtering
    // on `departmentId: null` would instead match every unassigned employee,
    // turning a missing assignment into a data leak.
    filter._id = { $in: [] };
    return filter;
  }

  filter.departmentId = admin.departmentId;
  return filter;
}

/** True when this admin is allowed to see department-restricted data at all. */
export function isOrgWide(admin: AdminIdentity): boolean {
  return roleAtLeast(admin.role, Role.HrAdmin);
}

/**
 * Scope for collections keyed by employeeId (sessions, attendance, ...).
 * Department-scoped admins get an explicit employee id list, which the caller
 * resolves once per request rather than joining on every document.
 */
export function orgScope(admin: AdminIdentity): { organizationId: typeof admin.organizationId } {
  return { organizationId: admin.organizationId };
}
