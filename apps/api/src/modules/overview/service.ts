import { ObjectId } from 'mongodb';
import {
  EntityStatus,
  PresenceState,
  toDateKey,
  type OverviewResponse,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { presence } from '../../services/presence.js';
import { getHourlyActivity } from '../activity/service.js';

/**
 * The main dashboard (spec §26).
 *
 * Counters come from the in-memory presence store rather than a database
 * aggregation: presence changes every few seconds, and this endpoint is
 * polled by every open dashboard plus pushed over WebSocket.
 */
export async function getOverview(organizationId: ObjectId): Promise<OverviewResponse> {
  const dateKey = toDateKey(new Date());
  const orgId = organizationId.toHexString();

  const [employees, devices, attendance, hourlyActivity] = await Promise.all([
    collections
      .employees()
      .find({ organizationId, status: EntityStatus.Active })
      .project<{ _id: ObjectId; name: string }>({ name: 1 })
      .toArray(),
    collections.devices().countDocuments({ organizationId, status: EntityStatus.Active }),
    collections.attendanceDaily().find({ organizationId, dateKey }).toArray(),
    getHourlyActivity(organizationId, dateKey),
  ]);

  const livePresence = presence.snapshotForOrg(orgId);

  let active = 0;
  let idle = 0;
  let locked = 0;

  for (const employee of employees) {
    const state = livePresence.get(employee._id.toHexString())?.state ?? PresenceState.Offline;
    if (state === PresenceState.Active) active += 1;
    else if (state === PresenceState.Idle) idle += 1;
    else if (state === PresenceState.Locked) locked += 1;
  }

  // "Online" is anyone whose agent is reporting, whatever they are doing.
  const online = active + idle + locked;
  const offline = Math.max(0, employees.length - online);

  const totalsById = new Map(attendance.map((row) => [row.employeeId.toHexString(), row]));
  const nameById = new Map(employees.map((e) => [e._id.toHexString(), e.name]));

  const topActive = [...totalsById.entries()]
    .map(([employeeId, row]) => {
      const live = livePresence.get(employeeId);
      return {
        employeeId,
        employeeName: nameById.get(employeeId) ?? 'Unknown',
        currentApplication: live?.currentApplication ?? null,
        activeSec: row.activeSec,
        presence: live?.state ?? PresenceState.Offline,
      };
    })
    .sort((a, b) => b.activeSec - a.activeSec)
    .slice(0, 10);

  return {
    employees: employees.length,
    online,
    active,
    idle,
    locked,
    offline,
    devices,
    todayActiveSec: attendance.reduce((sum, row) => sum + row.activeSec, 0),
    todayIdleSec: attendance.reduce((sum, row) => sum + row.idleSec, 0),
    todaySessions: attendance.length,
    topActive,
    hourlyActivity,
  };
}
