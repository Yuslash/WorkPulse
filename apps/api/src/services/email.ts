import { ShiftType } from '@workpulse/shared';
import { collections } from '../db/client.js';
import { ObjectId } from 'mongodb';

export const emailService = {
  /**
   * Evaluates if a device disconnecting right now is considered "unexpected"
   * based on its current shift, and if so, sends a confirmation email.
   */
  async checkAndSendDisconnectEmail(
    deviceId: string,
    employeeId: string,
    shift: string | null,
    now: Date = new Date()
  ): Promise<void> {
    if (!shift) return;

    // Check if the current time is within the shift bounds.
    // Shift bounds (UTC): 
    // DAY_SHIFT: 09:00 - 16:00
    // NIGHT_SHIFT: 16:00 - 00:00
    // MIDNIGHT_SHIFT: 00:00 - 09:00
    // Note: Assuming these are local times for the org, but we'll approximate with UTC for this MVP.
    const hour = now.getUTCHours();
    let isWithinShift = false;

    if (shift === ShiftType.Day) {
      isWithinShift = hour >= 9 && hour < 16;
    } else if (shift === ShiftType.Night) {
      isWithinShift = hour >= 16;
    } else if (shift === ShiftType.Midnight) {
      isWithinShift = hour >= 0 && hour < 9;
    }

    if (isWithinShift) {
      // The disconnect happened during an active shift.
      const emp = await collections.employees().findOne({ _id: new ObjectId(employeeId) });
      if (!emp) return;

      const confirmLink = `http://localhost:5173/confirm-disconnect?device=${deviceId}&employee=${employeeId}`;

      // Mock sending email
      console.log('----------------------------------------------------');
      console.log(`[EMAIL SERVICE] Sending unexpected disconnect email to ${emp.email}`);
      console.log(`Subject: Unexpected Disconnect Detected`);
      console.log(`Hello ${emp.name},`);
      console.log(`Your device appears to have gone offline during your active ${shift}.`);
      console.log(`Was this an accidental disconnect (e.g. power failure/internet loss)?`);
      console.log(`Please confirm here: ${confirmLink}`);
      console.log('----------------------------------------------------');
    }
  }
};
