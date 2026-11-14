// test/opencode.test.ts — OpenCode Go quota: parse boundary, calendar-month window
// math, per-window rows, provider gate, key resolution, config, /sl detail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseOpencodeQuota, fetchOpencodeQuota, type FetchLike, type OpencodeQuotaResult } from "../src/quota/opencode.ts";
import { previousMonthStartUtc, monthlyWindowMs } from "../src/quota/project.ts";
import {
  loadLiveConfig,
  opencodeLines,
  opencodeRelevant,
  opencodeStatusDetail,
  resolveOpencodeKey,
  type SlCtx,
} from "../src/index.ts";
import type { SlTheme } from "../src/index.ts";

const theme: SlTheme = { fg: (token, text) => `<${token}>${text}</>` };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const LIVE_ENVELOPE = JSON.stringify({
  usage: {
    rolling: { status: "ok", percent: 40, resetsAt: "2026-11-14T14:24:44.000Z" },
    weekly: { status: "ok", percent: 16, resetsAt: "2026-11-16T00:00:00.000Z" },
    monthly: { status: "ok", percent: 8, resetsAt: "2026-12-14T09:17:59.000Z" },
  },
});

function ctxWithKey(key: string | null | undefined, calls: string[] = []): SlCtx {
  return {
    ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} },
    modelRegistry: {
      getApiKeyForProvider: (provider: string) => {
        calls.push(provider);
        if (key === null) return Promise.reject(new Error("registry unavailable"));
        return Promise.resolve(key);
      },
    },
  };
}

test("parseOpencodeQuota: live envelope — all three windows, ISO resets, status", () => {
  const parsed = parseOpencodeQuota(LIVE_ENVELOPE);
  assert.ok(parsed);
  assert.equal(parsed.rolling?.percentage, 40);
  assert.equal(parsed.rolling?.nextResetTime, Date.parse("2026-11-14T14:24:44.000Z"));
  assert.equal(parsed.weekly?.percentage, 16);
  assert.equal(parsed.weekly?.nextResetTime, Date.parse("2026-11-16T00:00:00.000Z"));
  assert.equal(parsed.monthly?.percentage, 8);
  assert.equal(parsed.monthly?.nextResetTime, Date.parse("2026-12-14T09:17:59.000Z"));
  assert.equal(parsed.rolling?.status, "ok");
  assert.ok(parsed.fetchedAt > 0);
});

test("parseOpencodeQuota: invalid windows drop individually; all-invalid → null", () => {
  const weeklyOnly = parseOpencodeQuota(
    JSON.stringify({ usage: { rolling: null, weekly: { status: "ok", percent: 16, resetsAt: "2026-11-16T00:00:00.000Z" }, monthly: {} } }),
  );
  assert.ok(weeklyOnly);
  assert.equal(weeklyOnly.rolling, null);
  assert.equal(weeklyOnly.monthly, null);
  assert.equal(weeklyOnly.weekly?.percentage, 16);

  // invalid resetsAt / missing percent / non-string status → window null, status defaults
  const badResets = parseOpencodeQuota(JSON.stringify({ usage: { rolling: { percent: 40, resetsAt: "not-a-date" } } }));
  assert.equal(badResets, null);
  const badPercent = parseOpencodeQuota(JSON.stringify({ usage: { rolling: { percent: "40", resetsAt: "2026-11-14T14:24:44.000Z" } } }));
  assert.equal(badPercent, null);
  const noStatus = parseOpencodeQuota(JSON.stringify({ usage: { rolling: { percent: 40, resetsAt: "2026-11-14T14:24:44.000Z" } } }));
  assert.equal(noStatus?.rolling?.status, "unknown");

  // boundary rejects
  assert.equal(parseOpencodeQuota("not json"), null);
  assert.equal(parseOpencodeQuota("null"), null);
  assert.equal(parseOpencodeQuota("{}"), null);
  assert.equal(parseOpencodeQuota(JSON.stringify({ usage: [] })), null);
  assert.equal(parseOpencodeQuota(JSON.stringify({ usage: { rolling: null, weekly: null, monthly: null } })), null);
});

test("fetchOpencodeQuota: fail-soft — non-ok and throwing stubs both return null", async () => {
  const unauthorized = (async () => new Response("", { status: 401 })) as unknown as FetchLike;
  assert.equal(await fetchOpencodeQuota("k", unauthorized), null);
  const boom = (async () => {
    throw new Error("network down");
  }) as unknown as FetchLike;
  assert.equal(await fetchOpencodeQuota("k", boom), null);
});

test("previousMonthStartUtc / monthlyWindowMs: anniversary window is a calendar month", () => {
  const cases: Array<[string, string, number]> = [
    ["2026-12-14T09:17:59.000Z", "2026-11-14T09:17:59.000Z", 30 * DAY], // 30-day anniversary
    ["2026-03-31T12:00:00.000Z", "2026-02-28T12:00:00.000Z", 31 * DAY], // Mar 31 → Feb 28 clamp
    ["2028-03-31T12:00:00.000Z", "2028-02-29T12:00:00.000Z", 31 * DAY], // leap-year Feb 29
    ["2026-03-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", 28 * DAY],
    ["2026-01-15T00:00:00.000Z", "2025-12-15T00:00:00.000Z", 31 * DAY], // January → previous year
  ];
  for (const [reset, start, windowMs] of cases) {
    const ts = Date.parse(reset);
    assert.equal(previousMonthStartUtc(ts), Date.parse(start), reset);
    assert.equal(monthlyWindowMs(ts), windowMs, reset);
  }
});

// Fixture clock: Sat 14 Nov 2026 10:00 local. Elapsed percentages are timezone-free
// (both stamps are local-relative), so these strings hold on any machine TZ.
const NOW = new Date(2026, 10, 14, 10, 0).getTime();

function window(percentage: number, nextResetTime: number) {
  return { percentage, nextResetTime, status: "ok" };
}

const THREE_WINDOWS: OpencodeQuotaResult = {
  rolling: window(40, NOW + HOUR),
  weekly: window(16, NOW + 3 * DAY + 18 * HOUR),
  monthly: window(8, new Date(2026, 11, 14, 9, 17, 59).getTime()),
  fetchedAt: NOW,
};

test("opencodeLines: one row per window — exact strings, MONTH uses the calendar window", () => {
  const rows = opencodeLines(theme, THREE_WINDOWS, NOW);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows, [
    " <dim>󰚯</> <dim>opencode</> <accent>5hrs 40%/80%</><dim> (</><success>2h 0m under</><dim> · </><dim>1h 0m</><dim> · 11:00</><dim>)</>",
    " <dim>󰚯</> <dim>opencode</> <accent>7DAY 16%/46%</><dim> (</><success>2d 2h under</><dim> · </><dim>3d 18h</><dim> · Wed Nov 18 04:00</><dim>)</>",
    " <dim>󰚯</> <dim>opencode</> <accent>MONTH 8%/0%</><dim> (</><warning>2d 9h over</><dim> · </><dim>29d 23h</><dim> · Mon Dec 14 09:17</><dim>)</>",
  ]);
});

test("opencodeLines: heat bands and the >100 display cap", () => {
  const row = (percentage: number) =>
    opencodeLines(theme, { ...THREE_WINDOWS, weekly: null, monthly: null, rolling: window(percentage, NOW + HOUR) }, NOW)[0];
  assert.ok(row(75).includes("<warning>5hrs 75%/80%"));
  assert.ok(row(95).includes("<error>5hrs 95%/80%"));
  assert.ok(row(105).includes("<error>5hrs 100%+/80%"));
});

test("opencodeLines: monthly elapsed moves with the calendar window", () => {
  const later = new Date(2026, 10, 29, 10, 0).getTime(); // 15 days into the 30-day window
  const rows = opencodeLines(theme, { ...THREE_WINDOWS, rolling: null, weekly: null }, later);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].includes("<accent>MONTH 8%/50%"));
  assert.ok(rows[0].includes("<success>12d 14h under"));
});

test("opencodeLines: no windows → single dim inert row", () => {
  assert.deepEqual(opencodeLines(theme, { rolling: null, weekly: null, monthly: null, fetchedAt: NOW }, NOW), [
    "<dim> 󰚯 opencode — no quota windows</>",
  ]);
});

test("opencodeRelevant: gated to opencode-go (or unreadable provider)", () => {
  assert.equal(opencodeRelevant(undefined), true);
  assert.equal(opencodeRelevant("opencode-go"), true);
  assert.equal(opencodeRelevant("zai"), false);
  assert.equal(opencodeRelevant("opencode-zen"), false);
  assert.equal(opencodeRelevant(""), false);
});

test("resolveOpencodeKey: omp credential store only — no file fallback", async () => {
  const calls: string[] = [];
  assert.deepEqual(await resolveOpencodeKey(ctxWithKey("go-key", calls)), { key: "go-key", source: "omp credentials" });
  assert.deepEqual(calls, ["opencode-go"]);
  for (const ctx of [ctxWithKey(null), ctxWithKey(undefined), ctxWithKey(""), { ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} } }]) {
    assert.equal(await resolveOpencodeKey(ctx), null);
  }
});

test("loadLiveConfig: opencode.pollIntervalMs clamps to the 30s floor", () => {
  const dir = mkdtempSync(join(tmpdir(), "osl-oc-cfg-"));
  assert.equal(loadLiveConfig(join(dir, "absent.json")).opencodePollMs, 180_000); // no file → default

  const write = (name: string, body: unknown) => {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(body));
    return loadLiveConfig(file).opencodePollMs;
  };
  assert.equal(write("ok.json", { opencode: { pollIntervalMs: 45_000 } }), 45_000);
  assert.equal(write("low.json", { opencode: { pollIntervalMs: 1_000 } }), 180_000);
  assert.equal(write("str.json", { opencode: { pollIntervalMs: "x" } }), 180_000);
  assert.equal(write("null.json", { opencode: { pollIntervalMs: null } }), 180_000);
});

test("opencodeStatusDetail: /sl detail stays flat", () => {
  assert.equal(opencodeStatusDetail(THREE_WINDOWS, NOW), "5h 40% · weekly 16% · monthly 8% · fetched 0m ago");
  assert.equal(opencodeStatusDetail(THREE_WINDOWS, NOW + 3 * 60_000), "5h 40% · weekly 16% · monthly 8% · fetched 3m ago");
});
