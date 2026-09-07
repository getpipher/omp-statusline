// test/lines.test.ts — the four approved widget lines as observable strings.
// Theme stub annotates tokens so assertions check BOTH text and color placement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zaiLine, prayerLine, infoLine, moneyLine, heat } from "../src/index.ts";
import type { SlTheme } from "../src/index.ts";
import type { DeenSnapshot } from "../src/deen/source.ts";
import type { PrayerScheduleEntry } from "../src/deen/time.ts";
import type { QuotaResult } from "../src/quota/zai.ts";

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

test("zaiLine: heat bands — accent <70, warning ≥70, error ≥90, cap at 100%+", () => {
  const now = Date.now();

  // nextReset 1h out of a 5h window → 80% elapsed; reset countdown "1h 0m";
  // v0.2.0: absolute credits ride each window (currentValue/usage), TODAY first.
  const fiveHour = (percentage: number) => ({ unit: 1, number: 1, usage: 28000, currentValue: 7664, remaining: 20335, percentage, nextResetTime: now + HOUR });
  const data = (p5: number, p7: number): QuotaResult => ({ tier: "pro", fiveHour: fiveHour(p5), weekly: null, fetchedAt: now });
  assert.ok(zaiLine(theme, data(16, 0), now, sep).includes("<accent>5HRS 16%/80% 7.7K/28K (1h 0m)</>"));
  assert.ok(zaiLine(theme, data(76, 0), now, sep).includes("<warning>5HRS 76%/80% 7.7K/28K"));
  assert.ok(zaiLine(theme, data(93, 0), now, sep).includes("<error>5HRS 93%/80% 7.7K/28K"));
  assert.ok(zaiLine(theme, data(105, 0), now, sep).includes("<error>5HRS 100%+/80% 7.7K/28K"));
  // TODAY segment: present with credits, absent on null
  assert.ok(zaiLine(theme, data(16, 0), now, sep, 11614.3).startsWith(" <dim>󰚯</> <dim>zai</> <dim>TODAY</> <text>11.6K</>"));
  assert.ok(!zaiLine(theme, data(16, 0), now, sep, null).includes("TODAY"));
  const both: QuotaResult = { tier: "pro", fiveHour: fiveHour(16), weekly: { ...fiveHour(24), nextResetTime: now + 3 * DAY + 18 * HOUR }, fetchedAt: now };
  assert.ok(zaiLine(theme, both, now, sep).includes("</><dim> · </>"));
  // no windows → dim inert note
  const none: QuotaResult = { tier: "pro", fiveHour: null, weekly: null, fetchedAt: now };
  assert.equal(zaiLine(theme, none, now, sep), "<dim> 󰚯 zai — no quota windows</>");
});

test("heat: band boundaries are >= on both thresholds", () => {
  assert.equal(heat(69), "accent");
  assert.equal(heat(70), "warning");
  assert.equal(heat(89), "warning");
  assert.equal(heat(90), "error");
});

test("infoLine: clock · hijri · city, all dim", () => {
  const now = new Date(2026, 8, 7, 8, 15, 3).getTime(); // local-time construction → 08:15 in any tz
  assert.equal(
    infoLine(theme, deen(SCHEDULE), now, sep),
    " <dim>󰥔</> <dim>08:15</><dim> · </><dim>25 Rabīʿ al-awwal 1448</><dim> · </><dim>Jakarta</>",
  );
});

test("moneyLine: labels dim, values success, two decimals", () => {
  const line = moneyLine(theme, { repo: 68.358, day: 0, week: 315.266, month: 494.877, sub: 0, entries: 0 }, sep);
  assert.equal(
    line,
    " <dim>󰄬</> <dim>REPO</> <success>$68.36</><dim> · </><dim>DAY</> <success>$0.00</><dim> · </><dim>7DAY</> <success>$315.27</><dim> · </><dim>30DAY</> <success>$494.88</>",
  );
});

const HOUR = 3_600_000;
const DAY = 86_400_000;
