import { describe, expect, it } from 'vitest';
import { mergedDurationSec, overlapDurationSec } from './service.js';

/**
 * The attendance arithmetic is the one place where a bug silently produces a
 * plausible-but-wrong number on someone's timesheet, so it gets tested
 * directly rather than only through the pipeline.
 */

const span = (startIso: string, endIso: string) => ({
  startedAt: new Date(startIso),
  endedAt: new Date(endIso),
});

describe('mergedDurationSec', () => {
  it('returns zero for no spans', () => {
    expect(mergedDurationSec([])).toBe(0);
  });

  it('sums disjoint spans', () => {
    const result = mergedDurationSec([
      span('2026-08-19T09:00:00Z', '2026-08-19T09:30:00Z'),
      span('2026-08-19T10:00:00Z', '2026-08-19T10:15:00Z'),
    ]);
    expect(result).toBe(30 * 60 + 15 * 60);
  });

  it('counts overlapping spans once', () => {
    // Two app sessions racing at a window switch must not bill 60 minutes
    // for 40 minutes of wall clock.
    const result = mergedDurationSec([
      span('2026-08-19T09:00:00Z', '2026-08-19T09:30:00Z'),
      span('2026-08-19T09:20:00Z', '2026-08-19T09:40:00Z'),
    ]);
    expect(result).toBe(40 * 60);
  });

  it('collapses a span fully contained in another', () => {
    const result = mergedDurationSec([
      span('2026-08-19T09:00:00Z', '2026-08-19T10:00:00Z'),
      span('2026-08-19T09:10:00Z', '2026-08-19T09:20:00Z'),
    ]);
    expect(result).toBe(60 * 60);
  });

  it('is order independent', () => {
    const ordered = mergedDurationSec([
      span('2026-08-19T09:00:00Z', '2026-08-19T09:30:00Z'),
      span('2026-08-19T09:20:00Z', '2026-08-19T09:40:00Z'),
    ]);
    const reversed = mergedDurationSec([
      span('2026-08-19T09:20:00Z', '2026-08-19T09:40:00Z'),
      span('2026-08-19T09:00:00Z', '2026-08-19T09:30:00Z'),
    ]);
    expect(ordered).toBe(reversed);
  });

  it('treats adjacent spans as continuous', () => {
    const result = mergedDurationSec([
      span('2026-08-19T09:00:00Z', '2026-08-19T09:30:00Z'),
      span('2026-08-19T09:30:00Z', '2026-08-19T10:00:00Z'),
    ]);
    expect(result).toBe(60 * 60);
  });
});

describe('overlapDurationSec', () => {
  it('returns zero when either side is empty', () => {
    expect(overlapDurationSec([], [span('2026-08-19T09:00:00Z', '2026-08-19T10:00:00Z')])).toBe(0);
    expect(overlapDurationSec([span('2026-08-19T09:00:00Z', '2026-08-19T10:00:00Z')], [])).toBe(0);
  });

  it('returns zero for disjoint sets', () => {
    const result = overlapDurationSec(
      [span('2026-08-19T09:00:00Z', '2026-08-19T09:30:00Z')],
      [span('2026-08-19T10:00:00Z', '2026-08-19T10:30:00Z')],
    );
    expect(result).toBe(0);
  });

  it('measures the intersection of an app session and an idle span', () => {
    // VS Code stayed focused 09:00-10:00 but the person was idle 09:40-10:10.
    // Only the 20 shared minutes are non-active.
    const result = overlapDurationSec(
      [span('2026-08-19T09:00:00Z', '2026-08-19T10:00:00Z')],
      [span('2026-08-19T09:40:00Z', '2026-08-19T10:10:00Z')],
    );
    expect(result).toBe(20 * 60);
  });

  it('handles one idle span intersecting several app sessions', () => {
    const result = overlapDurationSec(
      [
        span('2026-08-19T09:00:00Z', '2026-08-19T09:20:00Z'),
        span('2026-08-19T09:30:00Z', '2026-08-19T09:50:00Z'),
      ],
      [span('2026-08-19T09:10:00Z', '2026-08-19T09:40:00Z')],
    );
    // 09:10-09:20 = 10m, plus 09:30-09:40 = 10m.
    expect(result).toBe(20 * 60);
  });

  it('does not double count overlapping spans within the same side', () => {
    const result = overlapDurationSec(
      [
        span('2026-08-19T09:00:00Z', '2026-08-19T10:00:00Z'),
        span('2026-08-19T09:30:00Z', '2026-08-19T10:30:00Z'),
      ],
      [span('2026-08-19T09:00:00Z', '2026-08-19T10:30:00Z')],
    );
    expect(result).toBe(90 * 60);
  });

  it('never reports more overlap than the smaller side covers', () => {
    const apps = [span('2026-08-19T09:00:00Z', '2026-08-19T17:00:00Z')];
    const idle = [
      span('2026-08-19T10:00:00Z', '2026-08-19T10:15:00Z'),
      span('2026-08-19T12:00:00Z', '2026-08-19T12:45:00Z'),
    ];
    expect(overlapDurationSec(apps, idle)).toBe(mergedDurationSec(idle));
  });
});

describe('active time derivation', () => {
  it('subtracts idle overlap from foreground time', () => {
    // The realistic case: 8h at the keyboard, 1h of it idle-with-window-focused.
    const apps = [span('2026-08-19T09:00:00Z', '2026-08-19T17:00:00Z')];
    const idle = [span('2026-08-19T12:00:00Z', '2026-08-19T13:00:00Z')];

    const active = mergedDurationSec(apps) - overlapDurationSec(apps, idle);
    expect(active).toBe(7 * 60 * 60);
  });

  it('cannot go negative when idle exceeds foreground time', () => {
    const apps = [span('2026-08-19T09:00:00Z', '2026-08-19T09:10:00Z')];
    const idle = [span('2026-08-19T08:00:00Z', '2026-08-19T18:00:00Z')];

    const active = Math.max(0, mergedDurationSec(apps) - overlapDurationSec(apps, idle));
    expect(active).toBe(0);
  });
});
