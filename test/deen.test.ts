// test/deen.test.ts — Maghrib-rollover data layer (v0.6.0)
// All instants built via Date.UTC against Asia/Jakarta (fixed UTC+7, no DST) so
// assertions hold in any CI timezone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { maghribRolloverActive, gToHDateParam } from "../src/deen/time.ts";
import { fetchHijriForDate, parseTimingsResponse } from "../src/deen/api.ts";

const JKT = "Asia/Jakarta"; // fixed UTC+7, no DST — machine-tz-independent instants
// Date.UTC(2026, 8, 9, 11, 0) = Wed 18:00 Jakarta. +7h to the UTC hour = JKT wall time.
const jkt = (utcHour: number, minute: number) => Date.UTC(2026, 8, 9, utcHour, minute);

const PRAYERS = { Fajr: "04:33", Dhuhr: "11:51", Asr: "15:07", Maghrib: "18:00", Isha: "19:01" };

test("maghribRolloverActive: flips at the Maghrib minute, city-tz based", () => {
  assert.equal(maghribRolloverActive(PRAYERS, jkt(10, 59), JKT), false); // 17:59 — before Maghrib
  assert.equal(maghribRolloverActive(PRAYERS, jkt(11, 0), JKT), true); // 18:00 — exact minute
  assert.equal(maghribRolloverActive(PRAYERS, jkt(16, 30), JKT), true); // 23:30 JKT — deep night, same Islamic day
});

test("gToHDateParam: DD-MM-YYYY of now+24h in the city tz (gToH query format)", () => {
  assert.equal(gToHDateParam(jkt(11, 1), JKT), "10-09-2026"); // 18:01 JKT Sep 9 → next civil day
  assert.equal(gToHDateParam(jkt(16, 30), JKT), "10-09-2026"); // 23:30 JKT Sep 9 → still Sep 10
  assert.equal(gToHDateParam(Date.UTC(2026, 8, 9, 12, 0), "UTC"), "10-09-2026"); // tz-generic
});

function stubFetch(body: string, ok = true): { impl: typeof fetch; url: () => string } {
  const state: { lastUrl: string } = { lastUrl: "" };
  const impl = (async (input: RequestInfo | URL) => {
    state.lastUrl = String(input);
    return { ok, status: ok ? 200 : 500, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, url: () => state.lastUrl };
}

const G_TO_H_BODY = JSON.stringify({
  code: 200,
  status: "OK",
  data: { hijri: { date: "10-09-1448", day: "10", month: { number: 3, en: "Rabīʿ al-awwal" }, year: "1448" } },
});

test("fetchHijriForDate: gToH envelope → hijri string; hits the documented URL", async () => {
  const { impl, url } = stubFetch(G_TO_H_BODY);
  assert.equal(await fetchHijriForDate("10-09-2026", impl), "10 Rabīʿ al-awwal 1448");
  assert.equal(url(), "https://api.aladhan.com/v1/gToH?date=10-09-2026");
});

test("fetchHijriForDate: non-200, bad envelope, malformed json, HTTP failure → null", async () => {
  const notOk = stubFetch(G_TO_H_BODY, false);
  assert.equal(await fetchHijriForDate("10-09-2026", notOk.impl), null);
  const badCode = stubFetch(JSON.stringify({ code: 400, status: "BAD", data: {} }));
  assert.equal(await fetchHijriForDate("10-09-2026", badCode.impl), null);
  const noHijri = stubFetch(JSON.stringify({ code: 200, status: "OK", data: {} }));
  assert.equal(await fetchHijriForDate("10-09-2026", noHijri.impl), null);
  const garbage = stubFetch("<html>");
  assert.equal(await fetchHijriForDate("10-09-2026", garbage.impl), null);
});

// Refactor guard: parseTimingsResponse keeps its contract once hijri extraction
// moves into the shared parseHijri helper (reused by fetchHijriForDate).
test("parseTimingsResponse: hijri extraction intact — day, month.en, year", () => {
  const body = JSON.stringify({
    code: 200,
    status: "OK",
    data: {
      timings: PRAYERS,
      meta: { timezone: JKT },
      date: { hijri: { day: "25", month: { en: "Rabīʿ al-awwal" }, year: "1448" } },
    },
  });
  const data = parseTimingsResponse(body);
  assert.ok(data);
  assert.equal(data.hijri, "25 Rabīʿ al-awwal 1448");
  assert.equal(data.timezone, JKT);
  assert.equal(data.prayers.Maghrib, "18:00");
});

// --- source integration: rollover wiring (cache + fetch seams injected) -------
import { createDeenSource } from "../src/deen/source.ts";
import { saveDeenCache, type DeenCacheFile } from "../src/deen/cache.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA = { prayers: PRAYERS, timezone: JKT, hijri: "25 Rabīʿ al-awwal 1448" };
const TOMORROW = "26 Rabīʿ al-awwal 1448";
const CFG = { city: "Jakarta", country: "Indonesia", method: "auto", escalateMinutes: 15 };
const KEY = "Jakarta|Indonesia|auto|2026-09-09"; // city|country|method|localDateKey (18:01 JKT)

function withCacheDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "deen-test-"));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("source: past Maghrib the snapshot hijri advances to tomorrow; value persists", () =>
  withCacheDir(async (dir) => {
    let hijriCalls = 0;
    const src = createDeenSource({
      cachePath: join(dir, "cache.json"),
      config: () => CFG,
      now: () => jkt(11, 1), // 18:01 JKT — 1 minute past Maghrib
      fetchPrayer: async () => DATA,
      fetchHijri: async () => { hijriCalls++; return TOMORROW; },
    });
    await src.refresh();
    assert.equal(src.current()?.hijri, TOMORROW);
    assert.equal(hijriCalls, 1);
    const cached = JSON.parse(readFileSync(join(dir, "cache.json"), "utf8")) as DeenCacheFile;
    assert.equal(cached.tomorrowHijri, TOMORROW);
  }));

test("source: failed gToH keeps today's hijri; retries throttle to 5 min", () =>
  withCacheDir(async (dir) => {
    let nowMs = jkt(11, 1);
    let hijriCalls = 0;
    const src = createDeenSource({
      cachePath: join(dir, "cache.json"),
      config: () => CFG,
      now: () => nowMs,
      fetchPrayer: async () => DATA,
      fetchHijri: async () => { hijriCalls++; return null; },
    });
    await src.refresh();
    assert.equal(src.current()?.hijri, "25 Rabīʿ al-awwal 1448");
    await src.refresh(); // seconds later — throttled, no retry
    assert.equal(hijriCalls, 1);
    nowMs = jkt(11, 1) + 6 * 60_000; // 6 min later — retry allowed
    await src.refresh();
    assert.equal(hijriCalls, 2);
  }));

test("source: before Maghrib today's hijri stands and gToH is never called", () =>
  withCacheDir(async (dir) => {
    let hijriCalls = 0;
    const src = createDeenSource({
      cachePath: join(dir, "cache.json"),
      config: () => CFG,
      now: () => jkt(10, 59), // 17:59 JKT — one minute before Maghrib
      fetchPrayer: async () => DATA,
      fetchHijri: async () => { hijriCalls++; return TOMORROW; },
    });
    await src.refresh();
    assert.equal(src.current()?.hijri, "25 Rabīʿ al-awwal 1448");
    assert.equal(hijriCalls, 0);
  }));

test("source: cached tomorrowHijri on the fresh path skips the gToH network", () =>
  withCacheDir(async (dir) => {
    const file: DeenCacheFile = { key: KEY, fetchedAt: jkt(11, 0), data: DATA, tomorrowHijri: TOMORROW };
    saveDeenCache(join(dir, "cache.json"), file);
    let hijriCalls = 0;
    const src = createDeenSource({
      cachePath: join(dir, "cache.json"),
      config: () => CFG,
      now: () => jkt(11, 1),
      fetchPrayer: async () => DATA,
      fetchHijri: async () => { hijriCalls++; return TOMORROW; },
    });
    await src.refresh();
    assert.equal(src.current()?.hijri, TOMORROW);
    assert.equal(hijriCalls, 0);
  }));

test("source: degraded refresh keeps the rolled-over hijri without new gToH calls", () =>
  withCacheDir(async (dir) => {
    let hijriCalls = 0;
    let prayersFail = false;
    const src = createDeenSource({
      cachePath: join(dir, "cache.json"),
      config: () => CFG,
      now: () => jkt(11, 1),
      fetchPrayer: async () => (prayersFail ? null : DATA),
      fetchHijri: async () => { hijriCalls++; return TOMORROW; },
    });
    await src.refresh(); // healthy — rolls over, seeds cache
    assert.equal(src.current()?.hijri, TOMORROW);
    prayersFail = true;
    await src.refresh(true); // forced refetch fails → last-good with stale marker
    assert.equal(src.current()?.hijri, TOMORROW);
    assert.ok(src.current()?.staleMinutes !== null);
    assert.equal(hijriCalls, 1);
  }));
