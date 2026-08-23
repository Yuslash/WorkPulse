import type { LoginResponse } from '@workpulse/shared';

/**
 * The single HTTP entry point for the dashboard.
 *
 * It owns two things no component should have to think about:
 *
 *   1. Attaching the access token.
 *   2. Refreshing it silently when it expires, and replaying the request.
 *
 * Because refresh happens here, a 15-minute token is invisible to the UI —
 * nobody gets logged out mid-task.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

/** In-flight refresh, shared so parallel 401s trigger exactly one refresh. */
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

async function refreshSession(): Promise<boolean> {
  // Collapse concurrent refreshes: five parallel queries hitting a expired
  // token must not rotate the refresh cookie five times, which would
  // invalidate four of them.
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) return false;

      const body = (await response.json()) as LoginResponse;
      accessToken = body.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting it all see the result.
      queueMicrotask(() => {
        refreshPromise = null;
      });
    }
  })();

  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: set when replaying after a refresh, to avoid a loop. */
  isRetry?: boolean;
}

/**
 * Endpoints where a 401 is the answer, not a stale token.
 *
 * Running the refresh-and-retry path against these would swallow "invalid
 * email or password" and report it as an expired session — the user would be
 * told to sign in again while they were already trying to.
 */
const AUTH_ENDPOINTS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const isAuthEndpoint = AUTH_ENDPOINTS.some((endpoint) => path.startsWith(endpoint));

  if (response.status === 401 && !options.isRetry && !isAuthEndpoint) {
    if (await refreshSession()) {
      return request<T>(path, { ...options, isRetry: true });
    }

    onUnauthenticated?.();
    throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  }

  if (!response.ok) {
    let code = 'REQUEST_FAILED';
    let message = `Request failed with status ${response.status}`;
    let details: unknown;

    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      details = body.error?.details;
    } catch {
      // A non-JSON error body (a proxy's HTML 502) keeps the defaults.
    }

    throw new ApiError(response.status, code, message, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Builds a query string, dropping empty values so the URL stays readable.
 *
 * Accepts any object rather than an indexed record, so the typed filter
 * interfaces in `features/queries.ts` can be passed straight through.
 */
export function qs(params: object): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}
