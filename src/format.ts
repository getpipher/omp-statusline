// src/format.ts
export function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  const thousands = count / 1000;
  return thousands < 10 ? `${thousands.toFixed(1)}k` : `${Math.round(thousands)}k`;
}

// CCS-exact human token counts (claude-code-statusline _format_tokens_human): one decimal
// always for K/M, uppercase unit, plain integer below 1000 (e.g. 68.0K, 200.0K, 1.0M).
export function formatTokensHuman(count: number): string {
  if (!Number.isFinite(count) || count < 1000) return `${Math.floor(Math.max(0, count))}`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${(count / 1000).toFixed(1)}K`;
}

export function formatMoney(n: number): string {
  return n.toFixed(2);
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatSpan(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  if (hours <= 0) return `${totalMinutes}m`;
  return `${hours}h${totalMinutes % 60}m`;
}

// Countdown to a ms-epoch reset. v0.4.7: unit spaces (`3h 57m`, `6d 6h`) — RECTOR's
// pomodoro style for the quota-row parenthetical.
export function formatReset(targetMs: number, now: number): string {
  const remaining = targetMs - now;
  if (remaining <= 0) return "now";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

// v0.5.0 absolute reset wall-clock (reset-time feature): same-day resets read as
// clock time (`23:30`); anything further out carries an EN month-day (`Sep 12
// 04:09`) — no weekday abbreviation (ambiguous when the reset lands on the
// viewer's own weekday). Machine-local like infoLine's clock; hardcoded EN months
// keep rendering deterministic (no Intl comma/platform variance).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatResetAbs(targetMs: number, now: number): string {
  if (targetMs <= now) return "now";
  const t = new Date(targetMs);
  const n = new Date(now);
  const sameDay =
    t.getFullYear() === n.getFullYear() &&
    t.getMonth() === n.getMonth() &&
    t.getDate() === n.getDate();
  return sameDay ? formatClock(targetMs) : `${MONTHS[t.getMonth()]} ${String(t.getDate()).padStart(2, "0")} ${formatClock(targetMs)}`;
}

// v0.5.1: Gregorian gloss beside the Hijri date in infoLine — `09 Sep 2026`.
// Machine-local like the clock; reuses MONTHS for deterministic EN rendering
// (no Intl/platform variance).
export function formatGregorian(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
