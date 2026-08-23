import { ObjectId } from 'mongodb';
import { EventEmitter } from 'node:events';
import { EntityStatus, PresenceState, type PresenceUpdate } from '@workpulse/shared';
import { collections } from '../db/client.js';
import { env } from '../config/env.js';

/**
 * THE STATUS ENGINE (spec §24).
 *
 * Presence has two sources of truth that have to be reconciled:
 *
 *   - what the agent last *said*  (ACTIVE / IDLE / LOCKED)
 *   - whether it is still talking (heartbeats arriving)
 *
 * OFFLINE is never reported by an agent — a machine that crashes or loses
 * power cannot send "I'm gone". It is derived here by a sweeper that watches
 * for heartbeats going quiet.
 *
 * The in-memory map is a cache over the `devices` collection, not a second
 * source of truth: it is rebuilt from Mongo on boot, so a restart does not
 * blank the live board.
 */

export interface PresenceRecord {
  deviceId: string;
  employeeId: string;
  organizationId: string;
  state: PresenceState;
  currentApplication: string | null;
  lastSeenAt: Date;
  /** When the device entered its current state — drives the "active for" timer. */
  stateSince: Date;
}

export interface PresenceEvents {
  change: (update: PresenceUpdate & { organizationId: string }) => void;
}

class PresenceStore extends EventEmitter {
  private readonly byDevice = new Map<string, PresenceRecord>();
  private sweepTimer: NodeJS.Timeout | null = null;

  /** Rebuilds the cache from Mongo so presence survives an API restart. */
  async hydrate(): Promise<void> {
    this.byDevice.clear();

    const devices = await collections
      .devices()
      .find({ status: EntityStatus.Active, lastSeenAt: { $ne: null } })
      .toArray();

    const cutoff = Date.now() - env.PRESENCE_OFFLINE_AFTER_SEC * 1000;

    for (const device of devices) {
      if (!device.lastSeenAt) continue;

      // A device that went quiet while we were down is offline, not frozen in
      // whatever state it last reported.
      const isStale = device.lastSeenAt.getTime() < cutoff;
      const state = isStale
        ? PresenceState.Offline
        : device.lastReportedState ?? PresenceState.Offline;

      this.byDevice.set(device._id.toHexString(), {
        deviceId: device._id.toHexString(),
        employeeId: device.employeeId.toHexString(),
        organizationId: device.organizationId.toHexString(),
        state,
        currentApplication: isStale ? null : device.currentApplication,
        lastSeenAt: device.lastSeenAt,
        stateSince: device.stateSince ?? device.lastSeenAt,
      });
    }
  }

  /** Called on every heartbeat. Returns true when the state actually changed. */
  record(input: {
    deviceId: ObjectId;
    employeeId: ObjectId;
    organizationId: ObjectId;
    state: PresenceState;
    currentApplication: string | null;
    at: Date;
  }): { changed: boolean; record: PresenceRecord } {
    const key = input.deviceId.toHexString();
    const previous = this.byDevice.get(key);

    const stateChanged = previous?.state !== input.state;
    const appChanged = previous?.currentApplication !== input.currentApplication;

    const record: PresenceRecord = {
      deviceId: key,
      employeeId: input.employeeId.toHexString(),
      organizationId: input.organizationId.toHexString(),
      state: input.state,
      currentApplication: input.currentApplication,
      lastSeenAt: input.at,
      // Only reset the timer on a real transition; a steady stream of ACTIVE
      // heartbeats must not keep restarting "active for 2h 17m".
      stateSince: stateChanged || !previous ? input.at : previous.stateSince,
    };

    this.byDevice.set(key, record);

    const changed = stateChanged || appChanged;
    if (changed) this.emitChange(record);

    return { changed, record };
  }

  private emitChange(record: PresenceRecord): void {
    const update: PresenceUpdate & { organizationId: string } = {
      employeeId: record.employeeId,
      deviceId: record.deviceId,
      organizationId: record.organizationId,
      state: record.state,
      currentApplication: record.currentApplication,
      lastSeenAt: record.lastSeenAt.toISOString(),
      stateSinceSec: Math.max(0, Math.round((Date.now() - record.stateSince.getTime()) / 1000)),
    };
    this.emit('change', update);
  }

  get(deviceId: string): PresenceRecord | undefined {
    return this.byDevice.get(deviceId);
  }

  /**
   * An employee may have several devices (laptop + desktop). The most
   * "present" one wins, so working on either machine shows as working.
   */
  forEmployee(employeeId: string): PresenceRecord | undefined {
    const ranked: PresenceState[] = [
      PresenceState.Active,
      PresenceState.Idle,
      PresenceState.Locked,
      PresenceState.Offline,
    ];

    let best: PresenceRecord | undefined;
    for (const record of this.byDevice.values()) {
      if (record.employeeId !== employeeId) continue;
      if (!best || ranked.indexOf(record.state) < ranked.indexOf(best.state)) {
        best = record;
      }
    }
    return best;
  }

  /** Snapshot for one organization, keyed by employee id. */
  snapshotForOrg(organizationId: string): Map<string, PresenceRecord> {
    const byEmployee = new Map<string, PresenceRecord>();
    const ranked: PresenceState[] = [
      PresenceState.Active,
      PresenceState.Idle,
      PresenceState.Locked,
      PresenceState.Offline,
    ];

    for (const record of this.byDevice.values()) {
      if (record.organizationId !== organizationId) continue;
      const existing = byEmployee.get(record.employeeId);
      if (!existing || ranked.indexOf(record.state) < ranked.indexOf(existing.state)) {
        byEmployee.set(record.employeeId, record);
      }
    }
    return byEmployee;
  }

  remove(deviceId: string): void {
    this.byDevice.delete(deviceId);
  }

  /**
   * Marks devices offline once heartbeats stop. Runs on an interval rather
   * than being computed at read time so the transition emits a WebSocket
   * event — the dashboard must show someone dropping off without a refresh.
   */
  async sweep(now = new Date()): Promise<string[]> {
    const cutoff = now.getTime() - env.PRESENCE_OFFLINE_AFTER_SEC * 1000;
    const wentOffline: string[] = [];

    for (const record of this.byDevice.values()) {
      if (record.state === PresenceState.Offline) continue;
      if (record.lastSeenAt.getTime() >= cutoff) continue;

      const updated: PresenceRecord = {
        ...record,
        state: PresenceState.Offline,
        currentApplication: null,
        stateSince: now,
      };
      this.byDevice.set(record.deviceId, updated);
      wentOffline.push(record.deviceId);
      this.emitChange(updated);
    }

    if (wentOffline.length > 0) {
      await collections.devices().updateMany(
        { _id: { $in: wentOffline.map((id) => new ObjectId(id)) } },
        {
          $set: {
            lastReportedState: PresenceState.Offline,
            currentApplication: null,
            stateSince: now,
            updatedAt: now,
          },
        },
      );
    }

    return wentOffline;
  }

  startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.sweep().catch(() => undefined);
    }, env.PRESENCE_SWEEP_INTERVAL_SEC * 1000);
    // Never hold the process open just for the sweeper.
    this.sweepTimer.unref();
  }

  stopSweeper(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /** Test hook: wipes the cache without touching the database. */
  clear(): void {
    this.byDevice.clear();
  }

  size(): number {
    return this.byDevice.size;
  }
}

export const presence = new PresenceStore();
