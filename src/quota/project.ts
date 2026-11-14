// src/quota/project.ts

export const FIVE_HOUR_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 24 * 3_600_000; // z.ai weekly window (console "Weekly limit")

// Window-clock percent for the quota row's `usage%/elapsed%` segment (v0.4.1, RECTOR):
// how much of the window's TIME has been consumed. Clamped 0–100 — a stale nextResetTime
// (window already reset) reads 100%, a not-yet-started one reads 0%.
export function windowElapsedPercent(nextResetTime: number, lengthMs: number, now: number): number {
  const elapsed = (now - (nextResetTime - lengthMs)) / lengthMs;
  if (!Number.isFinite(elapsed)) return 0;
  return Math.round(Math.min(1, Math.max(0, elapsed)) * 100);
}

// OpenCode Go monthly meter: the window starts on the same UTC day-of-month in the
// previous month as `nextResetTime`. Clamp to the previous month's last day
// (Mar 31 → Feb 28/29). UTC arithmetic matches the API's UTC reset stamps.
export function previousMonthStartUtc(ts: number): number {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
  return Date.UTC(
    prevYear,
    prevMonth,
    Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

export function monthlyWindowMs(nextResetTime: number): number {
  return nextResetTime - previousMonthStartUtc(nextResetTime);
}
