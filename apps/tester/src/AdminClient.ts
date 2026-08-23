import type {
  AgentHealthResponse,
  AttendanceDay,
  AuditLog,
  Device,
  Employee,
  GeneratedCredentials,
  OverviewResponse,
  Paginated,
  Policy,
  TimelineResponse,
} from '@workpulse/shared';

/**
 * The dashboard's side of the API, driven from Node.
 *
 * Scenarios use this to assert that what an agent reported actually shows up
 * where an admin would look for it — the end-to-end property that unit tests
 * on either side cannot establish.
 */
export class AdminClient {
  private accessToken: string | null = null;
  private refreshCookie: string | null = null;

  constructor(private readonly baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async login(email: string, password: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error(`admin login failed (${response.status}): ${await response.text()}`);
    }

    const body = (await response.json()) as { accessToken: string };
    this.accessToken = body.accessToken;

    // Node's fetch does not keep a cookie jar; capture it so refresh works.
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.refreshCookie = setCookie.split(';')[0] ?? null;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    if (this.refreshCookie) headers.cookie = this.refreshCookie;
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${await response.text()}`);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Returns the status code instead of throwing — for authorization checks. */
  async status(path: string, init: { method?: string; body?: unknown } = {}): Promise<number> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    return response.status;
  }

  get token(): string {
    if (!this.accessToken) throw new Error('admin is not signed in');
    return this.accessToken;
  }

  // --- employees ---------------------------------------------------------

  listEmployees(limit = 100): Promise<Paginated<Employee>> {
    return this.call(`/api/employees?limit=${limit}`);
  }

  getEmployee(id: string): Promise<Employee> {
    return this.call(`/api/employees/${id}`);
  }

  createEmployee(name: string, email: string): Promise<Employee> {
    return this.call('/api/employees', { method: 'POST', body: { name, email } });
  }

  generateCredentials(employeeId: string): Promise<GeneratedCredentials> {
    return this.call(`/api/employees/${employeeId}/credentials`, { method: 'POST' });
  }

  // --- activity ----------------------------------------------------------

  getTimeline(employeeId: string, date: string): Promise<TimelineResponse> {
    return this.call(`/api/activity/timeline/${employeeId}?date=${date}`);
  }

  getApplications(params: { from: string; to: string; employeeId?: string }) {
    const search = new URLSearchParams({ from: params.from, to: params.to });
    if (params.employeeId) search.set('employeeId', params.employeeId);
    return this.call<{ applications: Array<{ exeName: string; durationSec: number; category: string }> }>(
      `/api/activity/applications?${search}`,
    );
  }

  // --- attendance --------------------------------------------------------

  recomputeAttendance(employeeId: string, date: string): Promise<{ ok: boolean }> {
    return this.call('/api/attendance/recompute', { method: 'POST', body: { employeeId, date } });
  }

  getAttendance(date: string): Promise<{ date: string; rows: AttendanceDay[] }> {
    return this.call(`/api/attendance?date=${date}`);
  }

  // --- devices -----------------------------------------------------------

  listDevices(): Promise<Paginated<Device>> {
    return this.call('/api/devices?limit=100');
  }

  revokeDevice(deviceId: string): Promise<Device> {
    return this.call(`/api/devices/${deviceId}/revoke`, { method: 'POST' });
  }

  getAgentHealth(): Promise<AgentHealthResponse> {
    return this.call('/api/devices/health');
  }

  // --- policy & audit ----------------------------------------------------

  getPolicy(): Promise<Policy> {
    return this.call('/api/policies');
  }

  updatePolicy(body: Record<string, unknown>): Promise<Policy> {
    return this.call('/api/policies', { method: 'PATCH', body });
  }

  getOverview(): Promise<OverviewResponse> {
    return this.call('/api/overview');
  }

  getAudit(action?: string): Promise<Paginated<AuditLog>> {
    return this.call(`/api/audit?limit=100${action ? `&action=${action}` : ''}`);
  }
}
