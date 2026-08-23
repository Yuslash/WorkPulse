import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { parseDurationMs, type Role } from '@workpulse/shared';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';

/**
 * Access tokens are stateless JWTs; refresh tokens are opaque random strings
 * stored hashed in Mongo. That split means a compromised access token expires
 * on its own in 15 minutes, while a refresh token can be revoked instantly by
 * deleting one row — which is what "revoke this device" has to do.
 */

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const ISSUER = 'workpulse';

export const AUDIENCE = {
  admin: 'workpulse:admin',
  agent: 'workpulse:agent',
} as const;

export interface AdminTokenClaims extends JWTPayload {
  sub: string;
  org: string;
  role: Role;
  /** Department scope for MANAGER/TEAM_LEAD; absent for org-wide roles. */
  dept?: string | null;
}

export interface AgentTokenClaims extends JWTPayload {
  sub: string;
  org: string;
  emp: string;
}

async function sign(
  payload: JWTPayload,
  audience: string,
  ttl: string,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + parseDurationMs(ttl));

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(accessSecret);

  return { token, expiresAt };
}

export function signAdminAccessToken(claims: {
  userId: string;
  organizationId: string;
  role: Role;
  departmentId: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  return sign(
    {
      sub: claims.userId,
      org: claims.organizationId,
      role: claims.role,
      dept: claims.departmentId,
    },
    AUDIENCE.admin,
    env.ADMIN_ACCESS_TTL,
  );
}

export function signAgentAccessToken(claims: {
  deviceId: string;
  organizationId: string;
  employeeId: string;
}): Promise<{ token: string; expiresAt: Date }> {
  return sign(
    { sub: claims.deviceId, org: claims.organizationId, emp: claims.employeeId },
    AUDIENCE.agent,
    env.AGENT_ACCESS_TTL,
  );
}

async function verify<T extends JWTPayload>(token: string, audience: string): Promise<T> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: ISSUER,
      audience,
    });
    return payload as T;
  } catch (error) {
    // jose distinguishes expiry from tampering; the agent branches on
    // TOKEN_EXPIRED to refresh rather than to re-enroll.
    const code =
      error instanceof Error && error.name === 'JWTExpired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    throw ApiError.unauthorized('Invalid or expired token', code);
  }
}

export function verifyAdminToken(token: string): Promise<AdminTokenClaims> {
  return verify<AdminTokenClaims>(token, AUDIENCE.admin);
}

export function verifyAgentToken(token: string): Promise<AgentTokenClaims> {
  return verify<AgentTokenClaims>(token, AUDIENCE.agent);
}

/** Pulls a bearer token out of an Authorization header. */
export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
