// test/lines.test.ts — the four approved widget lines as observable strings.
// Theme stub annotates tokens so assertions check BOTH text and color placement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zaiLine, prayerLine, infoLine, moneyLine, heat, paceText } from "../src/index.ts";
import type { SlTheme } from "../src/index.ts";
import type { DeenSnapshot } from "../src/deen/source.ts";
import type { PrayerScheduleEntry } from "../src/deen/time.ts";
import type { QuotaResult } from "../src/quota/zai.ts";
import { formatResetAbs, formatGregorian, formatWeekday } from "../src/format.ts";

const theme: SlTheme = { fg: (token, text) => `<${token}>${text}</>` };
const sep = theme.fg("dim", " · ");

function deen(schedule: PrayerScheduleEntry[], staleMinutes: number | null = null): DeenSnapshot {
  return { schedule, escalation: "calm", hijri: "25 Rabīʿ al-awwal 1448", city: "Jakarta", timezone: "Asia/Jakarta", staleMinutes };
}

const SCHEDULE: PrayerScheduleEntry[] = [
  { name: "Fajr", wallMin: 4 * 60 + 33, minutesUntil: -300, state: "past" },
  { name: "Dhuhr", wallMin: 11 * 60 + 51, minutesUntil: 216, state: "next" },
  { name: "Asr", wallMin: 15 * 60 + 7, minutesUntil: 580, state: "upcoming" },
  { name: "Maghrib", wallMin: 17 * 60 + 52, minutesUntil: 685, state: "upcoming" },
  { name: "Isha", wallMin: 19 * 60 + 1, minutesUntil: 774, state: "upcoming" },
];

test("prayerLine: exact approved format — all five, ✓ past, countdown on next only", () => {
  const line = prayerLine(theme, deen(SCHEDULE), sep);
  assert.equal(
    line,
    " <dim>󰣎</> <dim>Fajr 04:33 ✓</><dim> · </><success>Dhuhr 11:51 (3h 36m)</><dim> · </><text>Asr 15:07</><dim> · </><text>Maghrib 17:52</><dim> · </><text>Isha 19:01</>",
  );
});

test("prayerLine: sub-hour countdown renders bare minutes; stale marker warns", () => {
  const schedule: PrayerScheduleEntry[] = SCHEDULE.map((e) =>
    e.state === "next" ? { ...e, minutesUntil: 45 } : e,
  );
  assert.ok(prayerLine(theme, deen(schedule), sep).includes("<success>Dhuhr 11:51 (45m)</>"));
  const stale = prayerLine(theme, deen(SCHEDULE, 5), sep);
  assert.ok(stale.endsWith("<dim> · </><warning>stale 5m</>"));
});

test("prayerLine: adhan-window prayer renders like past (dim ✓)", () => {
  const schedule: PrayerScheduleEntry[] = SCHEDULE.map((e) =>
    e.state === "next" ? { ...e, minutesUntil: -3, state: "adhan" } : e,
  );
  assert.ok(prayerLine(theme, deen(schedule), sep).includes("<dim>Dhuhr 11:51 ✓</>"));
});

test("zaiLine: percents keep heat; paren = pace · countdown · absolute; lowercase 5hrs label", () => {
  const now = new Date(2026, 8, 9, 10, 0).getTime(); // Wed 09 Sep 2026 10:00 local — DST-edge-free
  // 5h window, nextReset 1h out → 80% elapsed. Usage 16% vs 80% → pace 5h×(16−80)/100 = 3h 12m under.
  const fiveHour = (percentage: number) => ({ unit: 1, number: 1, usage: 28000, currentValue: 7664, remaining: 20335, percentage, nextResetTime: now + HOUR });
  const data = (p5: number): QuotaResult => ({ tier: "pro", fiveHour: fiveHour(p5), weekly: null, fetchedAt: now });
  assert.ok(zaiLine(theme, data(16), now, sep).includes("<accent>5hrs 16%/80%"));
  assert.ok(zaiLine(theme, data(16), now, sep).includes("<dim> (</><success>3h 12m under</><dim> · </><dim>1h 0m</><dim> · 11:00</><dim>)</>"));
  // over pace (usage > elapsed): 85% vs 80% → 5h×5/100 = 15m over, warning token
  assert.ok(zaiLine(theme, data(85), now, sep).includes("<warning>15m over</>"));
  assert.ok(zaiLine(theme, data(76), now, sep).includes("<warning>5hrs 76%/80%"));
  assert.ok(zaiLine(theme, data(93), now, sep).includes("<error>5hrs 93%/80%"));
  assert.ok(zaiLine(theme, data(105), now, sep).includes("<error>5hrs 100%+/80%"));
  const both: QuotaResult = { tier: "pro", fiveHour: fiveHour(16), weekly: { ...fiveHour(24), nextResetTime: now + 3 * DAY + 18 * HOUR }, fetchedAt: now };
  assert.ok(zaiLine(theme, both, now, sep).includes("</><dim> · </>"));
  assert.ok(zaiLine(theme, both, now, sep).includes("<dim> · Sun Sep 13 04:00</>")); // cross-day → weekday month-day form
  const none: QuotaResult = { tier: "pro", fiveHour: null, weekly: null, fetchedAt: now };
  assert.equal(zaiLine(theme, none, now, sep), "<dim> 󰚯 zai — no quota windows</>");
});

test("formatResetAbs: same-day clock, cross-day month-day, past → now", () => {
  const now = new Date(2026, 8, 9, 10, 0).getTime(); // Wed 09 Sep 2026 10:00 local — DST-edge-free
  assert.equal(formatResetAbs(now + HOUR, now), "11:00");
  assert.equal(formatResetAbs(now + 20 * HOUR, now), "Thu Sep 10 06:00");
  assert.equal(formatResetAbs(now - 60_000, now), "now");
  const lateNight = new Date(2026, 8, 4, 23, 0).getTime(); // Fri 04 Sep 23:00 local
  assert.equal(formatResetAbs(lateNight + 59 * 60_000, lateNight), "23:59"); // same-day branch near midnight
  assert.equal(formatResetAbs(lateNight + 2 * HOUR, lateNight), "Sat Sep 05 01:00"); // crosses midnight → weekday + padded single-digit day
});

test("formatGregorian: zero-padded day, EN month from local date, year", () => {
  assert.equal(formatGregorian(new Date(2026, 8, 7).getTime()), "07 Sep 2026"); // single-digit day padded
  assert.equal(formatGregorian(new Date(2026, 8, 20).getTime()), "20 Sep 2026"); // double-digit day verbatim
  assert.equal(formatGregorian(new Date(2026, 11, 31).getTime()), "31 Dec 2026"); // last month of year
  assert.equal(formatGregorian(new Date(2027, 0, 1).getTime()), "01 Jan 2027"); // year boundary
});

test("formatWeekday: 3-letter EN abbrev from the local date", () => {
  assert.equal(formatWeekday(new Date(2026, 8, 7).getTime()), "Mon"); // 07 Sep 2026
  assert.equal(formatWeekday(new Date(2026, 8, 12).getTime()), "Sat"); // 12 Sep 2026
  assert.equal(formatWeekday(new Date(2026, 8, 13).getTime()), "Sun"); // 13 Sep 2026
  assert.equal(formatWeekday(new Date(2026, 8, 6).getTime()), "Sun"); // week wraps on Sunday
});

test("paceText: gap = window × Δ%/100; formats and over/under tokens", () => {
  const H = 3_600_000;
  assert.deepEqual(paceText(5 * H, 34, 74), { text: "2h 0m under", token: "success" }); // RECTOR's worked example
  assert.deepEqual(paceText(5 * H, 85, 60), { text: "1h 15m over", token: "warning" });

  assert.deepEqual(paceText(7 * 86_400_000, 60, 32), { text: "1d 23h over", token: "warning" }); // 7d×28% = 1.96d
  assert.deepEqual(paceText(5 * H, 50, 50), { text: "0m under", token: "success" }); // dead-even floor
});

test("heat: band boundaries are >= on both thresholds", () => {
  assert.equal(heat(69), "accent");
  assert.equal(heat(70), "warning");
  assert.equal(heat(89), "warning");
  assert.equal(heat(90), "error");
});

test("infoLine: clock · hijri (gregorian in parens) · city, all dim", () => {
  const now = new Date(2026, 8, 7, 8, 15, 3).getTime(); // local-time construction → 08:15 in any tz
  assert.equal(
    infoLine(theme, deen(SCHEDULE), now, sep),
    " <dim>󰥔</> <dim>Mon 08:15</><dim> · </><dim>25 Rabīʿ al-awwal 1448 (07 Sep 2026)</><dim> · </><dim>Jakarta</>",
  );
});

test("moneyLine v0.3.0: every window carries dim token parens; REPO included", () => {
  const line = moneyLine(
    theme,
    { repo: 68.358, day: 0, week: 315.266, month: 494.877, sub: 0, entries: 0, repoTok: 1_334_323_492, dayTok: 812_300, weekTok: 2_668_631_232, monthTok: 5_944_136_904 },
    sep,
  );
  assert.equal(
    line,
    " <dim>󰄬</> <dim>REPO</> <success>$68.36</> <dim>(1.3B)</><dim> · </><dim>DAY</> <success>$0.00</> <dim>(812.3K)</><dim> · </><dim>7DAY</> <success>$315.27</> <dim>(2.7B)</><dim> · </><dim>30DAY</> <success>$494.88</> <dim>(5.9B)</>",
  );
});
const HOUR = 3_600_000;
const DAY = 86_400_000;
