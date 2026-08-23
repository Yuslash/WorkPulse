import { ObjectId } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import type { AuditAction, AuditLog, Paginated } from '@workpulse/shared';
import { collections } from '../../db/client.js';
import type { AuditLogDoc } from '../../db/types.js';
import { idToString } from '../../lib/ids.js';
import type { AdminIdentity } from '../../plugins/auth.js';

/**
 * The audit trail (spec §33).
 *
 * Writes are deliberately fire-and-forget: an audit failure must never turn a
 * successful policy change into a 500 for the admin. It is logged loudly
 * instead, and the TTL index on `createdAt` handles retention.
 */

export interface AuditEntry {
  action: AuditAction | string;
  targetType?: string | null;
  targetId?: string | ObjectId | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Best-effort client IP, honouring the proxy header Fastify already parsed. */
function clientIp(request: FastifyRequest): string | null {
  return request.ip ?? null;
}

export async function recordAudit(
  request: FastifyRequest,
  admin: Pick<AdminIdentity, 'userId' | 'organizationId' | 'name'>,
  entry: AuditEntry,
): Promise<void> {
  const targetId =
    entry.targetId instanceof ObjectId ? entry.targetId.toHexString() : entry.targetId ?? null;

  try {
    await collections.auditLogs().insertOne({
      _id: new ObjectId(),
      organizationId: admin.organizationId,
      actorId: admin.userId,
      actorName: admin.name,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId,
      targetLabel: entry.targetLabel ?? null,
      ip: clientIp(request),
      metadata: entry.metadata ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    request.log.error({ err: error, action: entry.action }, 'failed to write audit log');
  }
}

/**
 * For events with no signed-in admin — a failed login, or an agent enrolling.
 * `actorName` carries the attempted identity so the trail stays readable.
 */
export async function recordSystemAudit(
  request: FastifyRequest,
  organizationId: ObjectId,
  actorName: string,
  entry: AuditEntry,
): Promise<void> {
  const targetId =
    entry.targetId instanceof ObjectId ? entry.targetId.toHexString() : entry.targetId ?? null;

  try {
    await collections.auditLogs().insertOne({
      _id: new ObjectId(),
      organizationId,
      actorId: null,
      actorName,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId,
      targetLabel: entry.targetLabel ?? null,
      ip: clientIp(request),
      metadata: entry.metadata ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    request.log.error({ err: error, action: entry.action }, 'failed to write audit log');
  }
}

function toDto(doc: AuditLogDoc): AuditLog {
  return {
    id: doc._id.toHexString(),
    actorId: idToString(doc.actorId),
    actorName: doc.actorName,
    action: doc.action,
    targetType: doc.targetType,
    targetId: doc.targetId,
    targetLabel: doc.targetLabel,
    ip: doc.ip,
    metadata: doc.metadata,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listAuditLogs(
  organizationId: ObjectId,
  options: { page: number; limit: number; action?: string; actorId?: string },
): Promise<Paginated<AuditLog>> {
  const filter: Record<string, unknown> = { organizationId };
  if (options.action) filter.action = options.action;
  if (options.actorId && ObjectId.isValid(options.actorId)) {
    filter.actorId = new ObjectId(options.actorId);
  }

  const skip = (options.page - 1) * options.limit;
  const [docs, total] = await Promise.all([
    collections
      .auditLogs()
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(options.limit)
      .toArray(),
    collections.auditLogs().countDocuments(filter),
  ]);

  return {
    items: docs.map(toDto),
    total,
    page: options.page,
    limit: options.limit,
    pages: Math.ceil(total / options.limit),
  };
}
