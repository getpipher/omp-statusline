// src/deen/source.ts
import { fetchPrayerTimes, fetchHijriForDate, type DeenData, type FetchOpts } from "./api.ts";
import { computeSchedule, escalationState, gToHDateParam, maghribRolloverActive, type EscalationState, type PrayerScheduleEntry } from "./time.ts";
import { isDataFresh, isGeoFresh, loadDeenCache, saveDeenCache, type DeenCacheFile, type GeoInfo } from "./cache.ts";

export interface DeenSourceConfig {
  city: string;           // "auto" → IP-geo resolution
  country: string;
  method: string;         // "auto" → aladhan default
  escalateMinutes: number;
}

export interface DeenSnapshot {
  schedule: PrayerScheduleEntry[];
  escalation: EscalationState;
  hijri: string;
  city: string;
  timezone: string;
  staleMinutes: number | null; // null = fresh
}

export interface DeenSource {
  current(): DeenSnapshot | null;
  refresh(force?: boolean): Promise<void>;
  geo(): GeoInfo | null;
}

const GEO_URL = "https://ipwho.is/";

async function defaultFetchGeo(fetchImpl?: typeof fetch): Promise<GeoInfo | null> {
  try {
    const res = await (fetchImpl ?? fetch)(GEO_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { success?: boolean; city?: unknown; country?: unknown; timezone?: { id?: unknown } };
    if (j?.success !== true || typeof j.city !== "string" || typeof j.country !== "string") return null;
    const tz = j.timezone?.id;
    if (typeof tz !== "string") return null;
    return { city: j.city, country: j.country, timezone: tz, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

// Local YYYY-MM-DD for the cache key (city-date ambiguity is acceptable: the key's
// purpose is daily refetch, and wall-clock math happens in the city tz at render).
function localDateKey(now: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export interface DeenSourceOpts {
  cachePath: string;
  config: () => DeenSourceConfig;
  now?: () => number;
  fetchFn?: FetchOpts["fetchImpl"];
  geoFetchFn?: typeof fetch;
  fetchPrayer?: typeof fetchPrayerTimes;
  fetchGeo?: (fetchImpl?: typeof fetch) => Promise<GeoInfo | null>;
  fetchHijri?: typeof fetchHijriForDate;
}

export function createDeenSource(opts: DeenSourceOpts): DeenSource {
  const now = opts.now ?? Date.now;
  const fetchPrayer = opts.fetchPrayer ?? fetchPrayerTimes;
  const fetchGeo = opts.fetchGeo ?? defaultFetchGeo;
  let snapshot: DeenSnapshot | null = null;
  let lastKey = "";
  let lastFetchedAt = 0;
  let geo: GeoInfo | null = null;
  let lastHijriAttempt = 0;

  // v0.6.0 Maghrib rollover: after the city's Maghrib minute the Islamic day has
  // already turned, so the snapshot renders tomorrow's hijri — gToH(now+24h) in
  // the city tz, cached per city-day via DeenCacheFile.tomorrowHijri, retried at
  // most every HIJRI_RETRY_MS. A cached/degraded value short-circuits the network;
  // a failed fetch keeps today's hijri (exactly the pre-rollover display).
  const HIJRI_RETRY_MS = 5 * 60_000;
  async function resolveHijri(data: DeenData, cachedTomorrow: string | undefined, allowFetch: boolean): Promise<{ hijri: string; tomorrow?: string }> {
    if (!maghribRolloverActive(data.prayers, now(), data.timezone)) return { hijri: data.hijri };
    if (cachedTomorrow) return { hijri: cachedTomorrow, tomorrow: cachedTomorrow };
    if (!allowFetch) return { hijri: data.hijri };
    const nowMs = now();
    if (nowMs - lastHijriAttempt < HIJRI_RETRY_MS) return { hijri: data.hijri };
    lastHijriAttempt = nowMs;
    const tomorrow = await (opts.fetchHijri ?? fetchHijriForDate)(gToHDateParam(nowMs, data.timezone), opts.fetchFn);
    if (!tomorrow) return { hijri: data.hijri };
    return { hijri: tomorrow, tomorrow };
  }

  // P2-8: a defensive failure (e.g. an invalid IANA timezone reaching Intl inside
  // computeSchedule) yields a null snapshot rather than crashing the render path.
  function toSnapshot(data: DeenData, city: string, staleMinutes: number | null, cfg: DeenSourceConfig, hijri: string): DeenSnapshot | null {
    try {
      const schedule = computeSchedule(data.prayers, now(), data.timezone);
      const minutesUntilNext = schedule.find((e) => e.state === "next" || e.state === "adhan")?.minutesUntil ?? 0;
      return {
        schedule,
        escalation: escalationState(minutesUntilNext, cfg.escalateMinutes),
        hijri,
        city,
        timezone: data.timezone,
        staleMinutes,
      };
    } catch {
      return null;
    }
  }

  return {
    current: () => snapshot,
    geo: () => geo,

    async refresh(force = false): Promise<void> {
      const cfg = opts.config();
      const nowMs = now();
      const cached = loadDeenCache(opts.cachePath);

      // Geo: config city wins; "auto" resolves via IP (7d cache, then refetch).
      let city = cfg.city;
      let country = cfg.country;
      let timezone: string | null = null;
      if (city === "auto") {
        if (cached && isGeoFresh(cached, nowMs)) {
          geo = cached.geo!;
        } else {
          geo = await fetchGeo(opts.geoFetchFn);
        }
        if (!geo) { snapshot = null; return; }
        city = geo.city;
        country = geo.country;
        timezone = geo.timezone;
      }

      // Fetch timezones once for the date key when the city is explicit.
      const keyTz = timezone ?? cached?.data.timezone ?? "UTC";
      const key = `${city}|${country}|${cfg.method}|${localDateKey(nowMs, keyTz)}`;

      if (!force && cached && isDataFresh(cached, key, nowMs)) {
        const rolled = await resolveHijri(cached.data, cached.tomorrowHijri, true);
        if (rolled.tomorrow && rolled.tomorrow !== cached.tomorrowHijri) {
          // Persist the evening's gToH answer without resetting data freshness.
          try {
            saveDeenCache(opts.cachePath, { ...cached, tomorrowHijri: rolled.tomorrow });
          } catch {
            /* non-fatal; snapshot still serves */
          }
        }
        snapshot = toSnapshot(cached.data, city, null, cfg, rolled.hijri);
        lastKey = key;
        lastFetchedAt = cached.fetchedAt;
        return;
      }

      const data = await fetchPrayer({ city, country, method: cfg.method, fetchImpl: opts.fetchFn });
      if (data) {
        const rolled = await resolveHijri(data, cached?.key === key ? cached.tomorrowHijri : undefined, true);
        const file: DeenCacheFile = {
          key,
          fetchedAt: nowMs,
          data,
          ...(geo ? { geo } : cached?.geo ? { geo: cached.geo } : {}),
          ...(rolled.tomorrow ? { tomorrowHijri: rolled.tomorrow } : {}),
        };
        // Non-fatal write: a locked-down cache dir (EACCES) or full disk degrades to
        // serving the fresh snapshot from memory — refresh() must never reject here.
        try {
          saveDeenCache(opts.cachePath, file);
        } catch {
          /* non-fatal; snapshot still serves from memory */
        }
        lastKey = key;
        lastFetchedAt = nowMs;
        snapshot = toSnapshot(data, city, null, cfg, rolled.hijri);
        return;
      }

      // Fetch failed: serve last-good (memory first, then stale file) with a stale marker.
      if (lastKey === key && snapshot) {
        snapshot = { ...snapshot, staleMinutes: Math.floor((nowMs - lastFetchedAt) / 60_000) };
        return;
      }
      if (cached && cached.data.timezone === keyTz) {
        // Degraded: serve stale cache; the rollover only reuses a persisted value —
        // no network attempts while the API is already failing.
        const rolled = await resolveHijri(cached.data, cached.tomorrowHijri, false);
        snapshot = toSnapshot(cached.data, city, Math.floor((nowMs - cached.fetchedAt) / 60_000), cfg, rolled.hijri);
        return;
      }
      snapshot = null;
    },
  };
}
