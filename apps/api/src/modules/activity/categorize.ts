import type { ObjectId } from 'mongodb';
import { AppCategory } from '@workpulse/shared';
import { collections } from '../../db/client.js';

/**
 * Application categorization (spec §15).
 *
 * We ship NO built-in opinion about which applications are productive. The
 * spec is explicit that "VS Code = productive, YouTube = unproductive" is the
 * wrong default, so every unmapped application is NEUTRAL until an admin
 * classifies it. What the product measures is time, not virtue.
 */

/** Per-request cache: one telemetry batch touches the same few executables. */
export class CategoryResolver {
  private readonly cache = new Map<string, AppCategory>();
  private loaded = false;

  constructor(private readonly organizationId: ObjectId) {}

  private async load(): Promise<void> {
    if (this.loaded) return;

    const rules = await collections.appCategories().find({ organizationId: this.organizationId }).toArray();
    for (const rule of rules) {
      this.cache.set(rule.exeName.toLowerCase(), rule.category);
    }
    this.loaded = true;
  }

  async resolve(exeName: string): Promise<AppCategory> {
    await this.load();
    return this.cache.get(exeName.toLowerCase()) ?? AppCategory.Neutral;
  }
}

/**
 * Turns `C:\Users\x\AppData\Local\Programs\Microsoft VS Code\Code.exe` into
 * `Code.exe`. The agent already sends a bare executable name, but a full path
 * arriving from an older agent must not create a distinct category key.
 */
export function normalizeExeName(value: string): string {
  const trimmed = value.trim();
  const lastSlash = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  const base = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  return base.toLowerCase();
}
