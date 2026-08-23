import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateOnly, toDateKey } from '@workpulse/shared';
import { adminOf } from '../../plugins/auth.js';
import { toObjectId } from '../../lib/ids.js';
import * as attendanceService from './service.js';
import { getEmployee } from '../employees/service.js';

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const { date } = z.object({ date: dateOnly.optional() }).parse(request.query);
    const dateKey = date ?? toDateKey(new Date());

    return {
      date: dateKey,
      rows: await attendanceService.getAttendanceForDay(admin.organizationId, dateKey),
    };
  });

  app.get('/:employeeId', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { employeeId: string }).employeeId, 'employee id');
    await getEmployee(admin, employeeId);

    const query = z.object({ from: dateOnly.optional(), to: dateOnly.optional() }).parse(request.query);
    const today = toDateKey(new Date());

    return {
      rows: await attendanceService.getAttendanceRange(
        admin.organizationId,
        employeeId,
        query.from ?? today,
        query.to ?? today,
      ),
    };
  });

  /**
   * Forces a recompute. Rollups are debounced by up to ROLLUP_INTERVAL_SEC,
   * so the dashboard uses this after an action that should show immediately,
   * and the test suite uses it to avoid sleeping on the worker.
   */
  app.post('/recompute', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const body = z
      .object({ employeeId: z.string().optional(), date: dateOnly.optional() })
      .parse(request.body ?? {});

    if (body.employeeId) {
      const employeeId = toObjectId(body.employeeId, 'employee id');
      await getEmployee(admin, employeeId);
      await attendanceService.recomputeAttendance(
        admin.organizationId,
        employeeId,
        body.date ?? toDateKey(new Date()),
      );
      return { ok: true, recomputed: 1 };
    }

    return { ok: true, recomputed: await attendanceService.flushAttendance() };
  });
}
