import { ObjectId } from 'mongodb';
import {
  EntityStatus,
  Role,
  parseDurationMs,
  type AdminUser,
  type LoginResponse,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { hashPassword, hashToken, randomToken, verifyPassword } from '../../lib/crypto.js';
import { signAdminAccessToken } from '../../lib/tokens.js';
import { idToString } from '../../lib/ids.js';
import { getOrCreatePolicy } from '../policies/service.js';
import type { UserDoc } from '../../db/types.js';

/**
 * Admin authentication.
 *
 * Access tokens are short-lived JWTs returned in the body; refresh tokens are
 * opaque, stored hashed, and delivered as an httpOnly cookie so dashboard
 * JavaScript can never read them.
 */

export interface LoginResult extends LoginResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
  /** Internal ids, so the caller can audit without re-querying. */
  actor: { userId: ObjectId; organizationId: ObjectId; name: string };
}

/**
 * Resolves which organization a failed login attempt belongs to, so the
 * failure lands in the right tenant's audit trail. Returns null for an
 * unknown email — there is no tenant to attribute it to.
 */
export async function organizationForEmail(email: string): Promise<ObjectId | null> {
  const user = await collections
    .users()
    .findOne({ email: email.toLowerCase().trim() }, { projection: { organizationId: 1 } });
  return user?.organizationId ?? null;
}

/** `lowercase-with-dashes`, matching the pattern the dev seed script uses. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'company';
}

/**
 * Self-service company creation (spec §31's multi-tenant model, reached from
 * the pre-login welcome screen rather than an internal script).
 *
 * Creates the organization and its first ORG_OWNER in one transaction-free
 * sequence, then signs them in immediately — the same response shape as
 * `login`, so the route can treat the two identically.
 */
export async function registerOrganization(input: {
  organizationName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}): Promise<LoginResult> {
  const email = input.adminEmail.toLowerCase().trim();

  // Checked up front for a clear error; the unique index is still the real
  // guarantee against a race between two concurrent registrations.
  const existing = await collections.users().findOne({ email }, { projection: { _id: 1 } });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const now = new Date();
  const baseSlug = slugify(input.organizationName);
  const organizationId = new ObjectId();

  // Slugs are unique; a name collision gets a short random suffix rather
  // than failing the whole signup over a cosmetic clash.
  let slug = baseSlug;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await collections.organizations().insertOne({
        _id: organizationId,
        name: input.organizationName.trim(),
        slug,
        createdAt: now,
        updatedAt: now,
      });
      break;
    } catch (error) {
      const isDuplicate = (error as { code?: number }).code === 11000;
      if (!isDuplicate || attempt === 5) throw error;
      slug = `${baseSlug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }
  }

  const userId = new ObjectId();
  await collections.users().insertOne({
    _id: userId,
    organizationId,
    email,
    name: input.adminName.trim(),
    passwordHash: await hashPassword(input.adminPassword),
    role: Role.OrgOwner,
    departmentId: null,
    status: EntityStatus.Active,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // A fresh organization needs its policy row before any agent can enrol
  // against it; creating it here means the owner never sees a "not found"
  // on their first visit to Policies.
  await getOrCreatePolicy(organizationId);

  const user = await collections.users().findOne({ _id: userId });
  if (!user) throw ApiError.internal('Failed to create the new account');

  const [access, refresh] = await Promise.all([
    signAdminAccessToken({
      userId: user._id.toHexString(),
      organizationId: user.organizationId.toHexString(),
      role: user.role,
      departmentId: null,
    }),
    issueRefreshToken(user),
  ]);

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    user: await toAdminUser(user),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    actor: { userId: user._id, organizationId: user.organizationId, name: user.name },
  };
}

async function toAdminUser(user: UserDoc): Promise<AdminUser> {
  const org = await collections.organizations().findOne({ _id: user.organizationId });

  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId.toHexString(),
    organizationName: org?.name ?? 'Unknown organization',
    departmentId: idToString(user.departmentId),
  };
}

async function issueRefreshToken(user: UserDoc): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + parseDurationMs(env.ADMIN_REFRESH_TTL));

  await collections.refreshTokens().insertOne({
    _id: new ObjectId(),
    organizationId: user.organizationId,
    subjectType: 'admin',
    subjectId: user._id,
    tokenHash: hashToken(token),
    expiresAt,
    revokedAt: null,
    createdAt: new Date(),
  });

  return { token, expiresAt };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await collections.users().findOne({ email: email.toLowerCase().trim() });

  // Identical error for "no such user" and "wrong password" so the endpoint
  // cannot be used to enumerate which admin accounts exist.
  const invalid = ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  if (!user) {
    // Still spend the hashing time, so response latency does not reveal
    // whether the account exists.
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    throw invalid;
  }

  if (!(await verifyPassword(password, user.passwordHash))) throw invalid;

  if (user.status !== EntityStatus.Active) {
    throw ApiError.forbidden('Account is not active', 'ACCOUNT_INACTIVE');
  }

  const [access, refresh] = await Promise.all([
    signAdminAccessToken({
      userId: user._id.toHexString(),
      organizationId: user.organizationId.toHexString(),
      role: user.role,
      departmentId: idToString(user.departmentId),
    }),
    issueRefreshToken(user),
  ]);

  await collections
    .users()
    .updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } });

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    user: await toAdminUser(user),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    actor: { userId: user._id, organizationId: user.organizationId, name: user.name },
  };
}

/**
 * Refresh rotates: the presented token is revoked and a new one issued. A
 * replayed old token therefore fails, which surfaces token theft instead of
 * silently allowing two parallel sessions.
 */
export async function refresh(presentedToken: string): Promise<LoginResult> {
  const tokenHash = hashToken(presentedToken);
  const stored = await collections.refreshTokens().findOne({ tokenHash, subjectType: 'admin' });

  const invalid = ApiError.unauthorized('Invalid or expired session', 'INVALID_REFRESH_TOKEN');
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) throw invalid;

  const user = await collections.users().findOne({ _id: stored.subjectId });
  if (!user || user.status !== EntityStatus.Active) throw invalid;

  await collections
    .refreshTokens()
    .updateOne({ _id: stored._id }, { $set: { revokedAt: new Date() } });

  const [access, next] = await Promise.all([
    signAdminAccessToken({
      userId: user._id.toHexString(),
      organizationId: user.organizationId.toHexString(),
      role: user.role,
      departmentId: idToString(user.departmentId),
    }),
    issueRefreshToken(user),
  ]);

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    user: await toAdminUser(user),
    refreshToken: next.token,
    refreshExpiresAt: next.expiresAt,
    actor: { userId: user._id, organizationId: user.organizationId, name: user.name },
  };
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  await collections
    .refreshTokens()
    .updateOne({ tokenHash: hashToken(presentedToken) }, { $set: { revokedAt: new Date() } });
}

export async function currentUser(userId: ObjectId): Promise<AdminUser> {
  const user = await collections.users().findOne({ _id: userId });
  if (!user) throw ApiError.notFound('User');
  return toAdminUser(user);
}
