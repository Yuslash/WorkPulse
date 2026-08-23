import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ObjectId } from 'mongodb';
import { EntityStatus, roleAtLeast, type Role } from '@workpulse/shared';
import { collections } from '../db/client.js';
import { ApiError } from '../lib/errors.js';
import { extractBearer, verifyAdminToken, verifyAgentToken } from '../lib/tokens.js';

/**
 * Two independent identities live on a request:
 *
 *   `request.admin`  a human in the dashboard  (audience workpulse:admin)
 *   `request.agent`  an enrolled machine       (audience workpulse:agent)
 *
 * They are never interchangeable: the audience claim means an agent token is
 * rejected outright by an admin route and vice versa, even though both are
 * signed with the same key.
 */

export interface AdminIdentity {
  userId: ObjectId;
  organizationId: ObjectId;
  role: Role;
  departmentId: ObjectId | null;
  name: string;
}

export interface AgentIdentity {
  deviceId: ObjectId;
  organizationId: ObjectId;
  employeeId: ObjectId;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminIdentity;
    agent?: AgentIdentity;
  }

  interface FastifyInstance {
    /** Requires a valid admin token. Populates `request.admin`. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Requires an admin token whose role is at least `role`. */
    requireRole: (
      role: Role,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Requires a valid agent token for an ACTIVE device. Populates `request.agent`. */
    requireAgent: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authenticateAdmin(request: FastifyRequest): Promise<void> {
  const token = extractBearer(request.headers.authorization);
  if (!token) throw ApiError.unauthorized('Missing bearer token');

  const claims = await verifyAdminToken(token);

  // The token proves who signed in; the database decides whether they still
  // may. A suspended admin's unexpired token must stop working immediately.
  const user = await collections.users().findOne({ _id: new ObjectId(claims.sub) });
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.status !== EntityStatus.Active) {
    throw ApiError.forbidden('Account is not active', 'ACCOUNT_INACTIVE');
  }

  request.admin = {
    userId: user._id,
    organizationId: user.organizationId,
    role: user.role,
    departmentId: user.departmentId,
    name: user.name,
  };
}

async function authenticateAgent(request: FastifyRequest): Promise<void> {
  const token = extractBearer(request.headers.authorization);
  if (!token) throw ApiError.unauthorized('Missing bearer token');

  const claims = await verifyAgentToken(token);

  const device = await collections.devices().findOne({ _id: new ObjectId(claims.sub) });
  if (!device) {
    // Terminal for the agent: it wipes its identity and returns to un-enrolled.
    throw ApiError.unauthorized('Device no longer registered', 'DEVICE_UNKNOWN');
  }
  if (device.status !== EntityStatus.Active) {
    throw ApiError.forbidden('Device has been revoked', 'DEVICE_REVOKED');
  }

  request.agent = {
    deviceId: device._id,
    organizationId: device.organizationId,
    employeeId: device.employeeId,
  };
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('admin', undefined);
  app.decorateRequest('agent', undefined);

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    await authenticateAdmin(request);
  });

  app.decorate('requireRole', (role: Role) => async (request: FastifyRequest) => {
    await authenticateAdmin(request);
    if (!request.admin || !roleAtLeast(request.admin.role, role)) {
      throw ApiError.forbidden(`Requires ${role} or higher`);
    }
  });

  app.decorate('requireAgent', async (request: FastifyRequest) => {
    await authenticateAgent(request);
  });
});

/** Narrowing helper so routes get a non-optional identity without `!`. */
export function adminOf(request: FastifyRequest): AdminIdentity {
  if (!request.admin) throw ApiError.unauthorized();
  return request.admin;
}

export function agentOf(request: FastifyRequest): AgentIdentity {
  if (!request.agent) throw ApiError.unauthorized();
  return request.agent;
}
