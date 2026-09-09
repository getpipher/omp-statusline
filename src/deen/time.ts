// src/deen/time.ts
import type { PrayerName, PrayerTimes } from "./api.ts";

// Minutes since local midnight in `timezone` (IANA name via Intl; Node full-ICU).
export function wallMinutes(now: number, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const [h, m] = fmt.format(new Date(now)).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// Seconds since local midnight — computeSchedule's sub-minute precision source:
// minutesUntil = floor(wallMin − nowFractional), so a 12:00:30 now yields −1 for a
// 12:00 prayer (started 30s ago) and a 09:59:30 now yields 120 for 12:00.
function wallSeconds(now: number, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const [h, m, s] = fmt.format(new Date(now)).split(":").map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
}

// Ordinal within the day: Fajr → Isha.
const ORDER: PrayerName[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

export interface PrayerScheduleEntry {
  name: PrayerName;
  wallMin: number;
  minutesUntil: number; // floor; negative = started (within adhan window when > -10)
  state: "past" | "adhan" | "next" | "upcoming";
}

export function parseWallMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function computeSchedule(prayers: PrayerTimes, now: number, timezone: string): PrayerScheduleEntry[] {
  const nowMin = wallSeconds(now, timezone) / 60;
  const entries = ORDER.map((name) => ({ name, wallMin: parseWallMin(prayers[name]) }));

  const withUntil = entries.map((e) => ({ ...e, minutesUntil: Math.floor(e.wallMin - nowMin) }));
  // First prayer strictly in the future; after Isha (all past), Fajr "tomorrow" wins —
  // the Fajr entry itself is rewritten with minutesUntil + 1440 so it carries the
  // next-prayer countdown (wallMin stays today's, per the entry contract).
  const nextIdx = withUntil.findIndex((e) => e.minutesUntil > 0);
  const allPast = nextIdx === -1;

  return withUntil.map((e, i) => {
    const minutesUntil = allPast && i === 0 ? e.minutesUntil + 1440 : e.minutesUntil;
    let state: PrayerScheduleEntry["state"];
    if (minutesUntil <= 0 && minutesUntil > -10) state = "adhan";
    else if (minutesUntil <= 0) state = "past";
    else if (i === (allPast ? 0 : nextIdx)) state = "next";
    else state = "upcoming";
    return { name: e.name, wallMin: e.wallMin, minutesUntil, state };
  });
}

export type EscalationState = "calm" | "soon" | "near" | "imminent" | "adhan";

// Pure function of minutesUntilNext (spec §8 bands, escalateMinutes configurable).
export function escalationState(minutesUntilNext: number, escalateMinutes: number): EscalationState {
  if (minutesUntilNext <= 0 && minutesUntilNext > -10) return "adhan";
  if (minutesUntilNext <= -10) return "calm"; // prayer done; next countdown governs
  if (minutesUntilNext <= 2) return "imminent";
  if (minutesUntilNext <= 10) return "near";
  if (minutesUntilNext <= escalateMinutes) return "soon";
  return "calm";
}

// v0.6.0 Maghrib rollover: the Islamic day traditionally begins at Maghrib, so the
// displayed hijri date advances once the city's wall clock reaches the Maghrib
// minute (not civil midnight). Pure decision — source.ts picks the rendered value.
export function maghribRolloverActive(prayers: PrayerTimes, now: number, timezone: string): boolean {
  return wallMinutes(now, timezone) >= parseWallMin(prayers.Maghrib);
}

// Gregorian DD-MM-YYYY of now+24h in the city tz — the gToH query for the hijri
// day that begins at this evening's Maghrib. Only called while the rollover is
// active: past Maghrib means past midday, so +24h lands on the next civil date
// in every timezone (DST shifts of ±1h cannot cross back).
export function gToHDateParam(now: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric" });
  const [d, m, y] = fmt.format(new Date(now + 86_400_000)).split("/");
  return `${d}-${m}-${y}`;
}
