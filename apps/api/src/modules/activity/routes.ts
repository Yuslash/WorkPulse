import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateOnly, toDateKey } from '@workpulse/shared';
import { adminOf } from '../../plugins/auth.js';
import { toObjectId } from '../../lib/ids.js';
import * as activityService from './service.js';
import { getEmployee } from '../employees/service.js';

const dayQuerySchema = z.object({ date: dateOnly.optional() });
const rangeQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  employeeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Defaults to today when no date is supplied. */
function resolveDay(query: { date?: string }): string {
  return query.date ?? toDateKey(new Date());
}

function resolveRange(query: { from?: string; to?: string }): { fromKey: string; toKey: string } {
  const today = toDateKey(new Date());
  return { fromKey: query.from ?? today, toKey: query.to ?? query.from ?? today };
}

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/timeline/:employeeId', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { employeeId: string }).employeeId, 'employee id');

    // Re-uses the scoped lookup so a department-restricted admin cannot read
    // the timeline of someone outside their department.
    await getEmployee(admin, employeeId);

    const { date } = dayQuerySchema.parse(request.query);
    return activityService.getTimeline(admin.organizationId, employeeId, resolveDay({ date }));
  });

  app.get('/inactivity/:employeeId', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { employeeId: string }).employeeId, 'employee id');
    await getEmployee(admin, employeeId);

    const { date } = dayQuerySchema.parse(request.query);
    return {
      spans: await activityService.getInactivitySpans(
        admin.organizationId,
        employeeId,
        resolveDay({ date }),
      ),
    };
  });

  app.get('/applications', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const query = rangeQuerySchema.parse(request.query);
    const { fromKey, toKey } = resolveRange(query);

    const employeeId = query.employeeId ? toObjectId(query.employeeId, 'employee id') : undefined;
    if (employeeId) await getEmployee(admin, employeeId);

    const [applications, categories] = await Promise.all([
      activityService.getAppUsage(admin.organizationId, {
        employeeId,
        fromKey,
        toKey,
        limit: query.limit,
      }),
      activityService.getCategoryBreakdown(admin.organizationId, { employeeId, fromKey, toKey }),
    ]);

    return { from: fromKey, to: toKey, applications, categories };
  });

  app.get('/by-employee', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const query = rangeQuerySchema.parse(request.query);
    const { fromKey, toKey } = resolveRange(query);

    const employees = await activityService.getEmployeeUsage(admin.organizationId, {
      fromKey,
      toKey,
      limit: query.limit,
    });

    return { from: fromKey, to: toKey, employees };
  });
}
