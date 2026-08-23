import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentHealthResponse,
  AppCategoryRule,
  AppUsage,
  AttendanceDay,
  AuditLog,
  CategoryBreakdown,
  CreateEmployeeRequest,
  CredentialStatus,
  Device,
  Employee,
  EmployeeUsageRow,
  GeneratedCredentials,
  OverviewResponse,
  Paginated,
  Policy,
  TimelineResponse,
  UpdateEmployeeRequest,
  UpdatePolicyRequest,
  UpsertAppCategoryRequest,
} from '@workpulse/shared';
import { api, qs } from '@/lib/api';

/**
 * Every server call the dashboard makes, in one file.
 *
 * Query keys are structured so an invalidation can be as narrow or as broad
 * as the mutation actually warrants — revoking a device should not refetch
 * the audit log.
 */

export const keys = {
  overview: ['overview'] as const,
  employees: (params: unknown) => ['employees', params] as const,
  employee: (id: string) => ['employee', id] as const,
  credentials: (id: string) => ['credentials', id] as const,
  timeline: (id: string, date: string) => ['timeline', id, date] as const,
  inactivity: (id: string, date: string) => ['inactivity', id, date] as const,
  attendanceDay: (date: string) => ['attendance', 'day', date] as const,
  attendanceRange: (id: string, from: string, to: string) =>
    ['attendance', 'range', id, from, to] as const,
  applications: (params: unknown) => ['applications', params] as const,
  applicationsByEmployee: (params: unknown) => ['applications-by-employee', params] as const,
  devices: (params: unknown) => ['devices', params] as const,
  agentHealth: ['agent-health'] as const,
  policy: ['policy'] as const,
  categories: ['app-categories'] as const,
  audit: (params: unknown) => ['audit', params] as const,
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: () => api.get<OverviewResponse>('/api/overview'),
    // A fallback for when the WebSocket is down; the socket normally pushes
    // this far more promptly than the poll would.
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface EmployeeFilters {
  page?: number;
  limit?: number;
  search?: string;
  departmentId?: string;
  status?: string;
  presence?: string;
}

export function useEmployees(filters: EmployeeFilters) {
  return useQuery({
    queryKey: keys.employees(filters),
    queryFn: () => api.get<Paginated<Employee>>(`/api/employees${qs(filters)}`),
  });
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: keys.employee(id ?? ''),
    queryFn: () => api.get<Employee>(`/api/employees/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateEmployee() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateEmployeeRequest) => api.post<Employee>('/api/employees', body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['employees'] });
      client.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

export function useUpdateEmployee(id: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateEmployeeRequest) => api.patch<Employee>(`/api/employees/${id}`, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['employees'] });
      client.invalidateQueries({ queryKey: keys.employee(id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export function useCredentialStatus(employeeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.credentials(employeeId ?? ''),
    queryFn: () => api.get<CredentialStatus>(`/api/employees/${employeeId}/credentials`),
    enabled: Boolean(employeeId) && enabled,
  });
}

/**
 * Issues the one-time password.
 *
 * The plaintext is in the mutation result and nowhere else — it is never put
 * into the query cache, because anything cached would survive in memory long
 * after the dialog that showed it was closed.
 */
export function useGenerateCredentials(employeeId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<GeneratedCredentials>(`/api/employees/${employeeId}/credentials`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.credentials(employeeId) });
      client.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

export function useRevokeCredentials(employeeId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/api/employees/${employeeId}/credentials`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.credentials(employeeId) });
      client.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export function useTimeline(employeeId: string | undefined, date: string) {
  return useQuery({
    queryKey: keys.timeline(employeeId ?? '', date),
    queryFn: () => api.get<TimelineResponse>(`/api/activity/timeline/${employeeId}${qs({ date })}`),
    enabled: Boolean(employeeId),
  });
}

export interface ApplicationFilters {
  from?: string;
  to?: string;
  employeeId?: string;
  limit?: number;
}

interface ApplicationsResponse {
  from: string;
  to: string;
  applications: AppUsage[];
  categories: CategoryBreakdown[];
}

export function useApplications(filters: ApplicationFilters) {
  return useQuery({
    queryKey: keys.applications(filters),
    queryFn: () => api.get<ApplicationsResponse>(`/api/activity/applications${qs(filters)}`),
  });
}

interface ApplicationsByEmployeeResponse {
  from: string;
  to: string;
  employees: EmployeeUsageRow[];
}

export function useApplicationsByEmployee(filters: { from?: string; to?: string; limit?: number }) {
  return useQuery({
    queryKey: keys.applicationsByEmployee(filters),
    queryFn: () => api.get<ApplicationsByEmployeeResponse>(`/api/activity/by-employee${qs(filters)}`),
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export function useAttendanceDay(date: string) {
  return useQuery({
    queryKey: keys.attendanceDay(date),
    queryFn: () => api.get<{ date: string; rows: AttendanceDay[] }>(`/api/attendance${qs({ date })}`),
  });
}

export function useAttendanceRange(employeeId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: keys.attendanceRange(employeeId ?? '', from, to),
    queryFn: () =>
      api.get<{ rows: AttendanceDay[] }>(`/api/attendance/${employeeId}${qs({ from, to })}`),
    enabled: Boolean(employeeId),
  });
}

/**
 * Forces a rollup. Rollups are debounced server-side by up to a minute, so
 * the detail page offers this rather than showing a stale figure and hoping
 * the admin refreshes at the right moment.
 */
export function useRecomputeAttendance() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: { employeeId?: string; date?: string }) =>
      api.post<{ ok: boolean; recomputed: number }>('/api/attendance/recompute', body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['attendance'] });
      client.invalidateQueries({ queryKey: ['employees'] });
      client.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface DeviceFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  presence?: string;
}

export function useDevices(filters: DeviceFilters) {
  return useQuery({
    queryKey: keys.devices(filters),
    queryFn: () => api.get<Paginated<Device>>(`/api/devices${qs(filters)}`),
  });
}

export function useAgentHealth() {
  return useQuery({
    queryKey: keys.agentHealth,
    queryFn: () => api.get<AgentHealthResponse>('/api/devices/health'),
    refetchInterval: 60_000,
  });
}

export function useRevokeDevice() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (deviceId: string) => api.post<Device>(`/api/devices/${deviceId}/revoke`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['devices'] });
      client.invalidateQueries({ queryKey: keys.agentHealth });
    },
  });
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export function usePolicy() {
  return useQuery({
    queryKey: keys.policy,
    queryFn: () => api.get<Policy>('/api/policies'),
  });
}

export function useUpdatePolicy() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdatePolicyRequest) => api.patch<Policy>('/api/policies', body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.policy });
      // A policy change is auditable, so the audit view is now stale too.
      client.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export function useAppCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => api.get<{ rules: AppCategoryRule[] }>('/api/policies/categories'),
  });
}

export function useUpsertAppCategory() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: UpsertAppCategoryRequest) => api.put('/api/policies/categories', body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.categories });
      client.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditFilters {
  page?: number;
  limit?: number;
  action?: string;
  actorId?: string;
}

export function useAuditLogs(filters: AuditFilters) {
  return useQuery({
    queryKey: keys.audit(filters),
    queryFn: () => api.get<Paginated<AuditLog>>(`/api/audit${qs(filters)}`),
  });
}
