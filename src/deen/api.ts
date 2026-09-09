// src/deen/api.ts
const ALADHAN_URL = "https://api.aladhan.com/v1/timingsByCity";
const G_TO_H_URL = "https://api.aladhan.com/v1/gToH";

export type PrayerName = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";

export type PrayerTimes = Record<PrayerName, string>; // "HH:MM" wall clock in the city tz

export interface DeenData {
  prayers: PrayerTimes;
  timezone: string; // IANA name from aladhan meta (e.g. "Asia/Jakarta")
  hijri: string;    // "17 Rabīʿ al-awwal 1448"
}

const PRAYER_NAMES: PrayerName[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Shared hijri-object extraction: timingsByCity (today's date) and gToH (arbitrary
// date) answer with the same `data.hijri` shape → `${day} ${month.en} ${year}`.
function parseHijri(hijri: unknown): string | null {
  const h = hijri as { day?: unknown; year?: unknown; month?: { en?: unknown } } | null | undefined;
  if (!h || typeof h.day !== "string" || typeof h.year !== "string" || typeof h.month?.en !== "string") return null;
  return `${h.day} ${h.month.en} ${h.year}`;
}

export function parseTimingsResponse(body: string): DeenData | null {
  let parsed: {
    code?: unknown;
    status?: unknown;
    data?: { timings?: unknown; meta?: { timezone?: unknown } | null; date?: { hijri?: unknown } | null };
  } | null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed?.code !== 200 || parsed?.status !== "OK" || !parsed.data) return null;

  const timings = parsed.data.timings;
  if (!timings || typeof timings !== "object") return null;
  const byName = timings as Record<string, unknown>; // guarded above; per-name checks below
  const timezone = parsed.data.meta?.timezone;
  const hijri = parseHijri(parsed.data.date?.hijri);
  if (typeof timezone !== "string" || !hijri) return null;

  const prayers = {} as PrayerTimes;
  for (const name of PRAYER_NAMES) {
    const value = byName[name];
    if (typeof value !== "string" || !WALL_TIME.test(value)) return null;
    prayers[name] = value;
  }

  return { prayers, timezone, hijri };
}

export interface FetchOpts {
  city: string;
  country: string;
  method: string; // "auto" → param omitted (aladhan default)
  fetchImpl?: typeof fetch;
}

export async function fetchPrayerTimes(opts: FetchOpts): Promise<DeenData | null> {
  const params = new URLSearchParams({ city: opts.city, country: opts.country });
  if (opts.method !== "auto") params.set("method", opts.method);
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${ALADHAN_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return parseTimingsResponse(await res.text());
  } catch {
    return null;
  }
}

// v0.6.0 Maghrib rollover: tomorrow's hijri date for the evening display. gToH
// keeps Aladhan the single calendar authority (same hijri shape as timingsByCity);
// fails soft (null) — callers fall back to today's hijri and retry later.
export async function fetchHijriForDate(dateParam: string, fetchImpl?: typeof fetch): Promise<string | null> {
  try {
    const res = await (fetchImpl ?? fetch)(`${G_TO_H_URL}?date=${encodeURIComponent(dateParam)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const parsed = JSON.parse(await res.text()) as { code?: unknown; data?: { hijri?: unknown } | null };
    if (parsed?.code !== 200 || !parsed?.data) return null;
    return parseHijri(parsed.data.hijri);
  } catch {
    return null;
  }
}
