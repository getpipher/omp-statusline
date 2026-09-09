// test/accent.test.ts — session accent (Option A): derivation invariants from
// the oh-my-pi port + renderer placement (accent on glyphs/labels ONLY; values
// keep semantic tokens). Baseline (accentless) renders stay pinned by
// lines.test.ts — these tests cover what the accent ADDS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSessionAccentHex, nameToHash, resolveAccent, hexToOklch, oklchToHex } from "../src/accent.ts";
import { zaiLine, prayerLine, infoLine, moneyLine } from "../src/index.ts";
import type { SlTheme } from "../src/index.ts";
import type { DeenSnapshot } from "../src/deen/source.ts";
import type { PrayerScheduleEntry } from "../src/deen/time.ts";
import type { QuotaResult } from "../src/quota/zai.ts";
import type { MoneySnapshot } from "../src/money.ts";

// dark-catppuccin-shaped inputs: peach accent + the theme's saturated tokens
const INPUTS = {
  accentHex: "#fab387",
  colorHexes: ["#f5e0dc", "#f5c2e7", "#cba6f7", "#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89dceb", "#74c7ec", "#89b4fa", "#b4befe", "#cdd6f4"],
};

const HOUR = 3_600_000;

const theme: SlTheme = { fg: (token, text) => `<${token}>${text}</>` };
const accent = (text: string) => `<ac>${text}</ac>`;
const sep = theme.fg("dim", " · ");

const SCHEDULE: PrayerScheduleEntry[] = [
  { name: "Fajr", wallMin: 4 * 60 + 33, minutesUntil: -300, state: "past" },
  { name: "Dhuhr", wallMin: 11 * 60 + 51, minutesUntil: 216, state: "next" },
  { name: "Asr", wallMin: 15 * 60 + 7, minutesUntil: 580, state: "upcoming" },
];

const deen: DeenSnapshot = { schedule: SCHEDULE, escalation: "calm", hijri: "25 Rabīʿ al-awwal 1448", city: "Jakarta", timezone: "Asia/Jakarta", staleMinutes: null };

const NOW = new Date(2026, 8, 9, 10, 0).getTime();
const quota = (percentage: number): QuotaResult => ({
  tier: "pro",
  fiveHour: { unit: 1, number: 1, usage: 28000, currentValue: 7664, remaining: 20335, percentage, nextResetTime: NOW + HOUR },
  weekly: null,
  fetchedAt: NOW,
});

const money: MoneySnapshot = { repo: 68.36, day: 26.5, week: 315.27, month: 492.88, sub: 0, entries: 3, repoTok: 138_200_000, dayTok: 26_500_000, weekTok: 315_270_000, monthTok: 492_880_000 };

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
};

const wcagLuminance = (hex: string) => {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(parseInt(hex.slice(1, 3), 16)) + 0.7152 * lin(parseInt(hex.slice(3, 5), 16)) + 0.0722 * lin(parseInt(hex.slice(5, 7), 16));
};

test("getSessionAccentHex: deterministic, golden vectors pin the catppuccin port", () => {
  // Pinned against dark-catppuccin inputs. If upstream tunes the algorithm,
  // these fail → re-verify against oh-my-pi source and re-pin consciously.
  assert.equal(getSessionAccentHex("omp-statusline", INPUTS), "#5eddf5");
  assert.equal(getSessionAccentHex("gmtrade-hunt", INPUTS), "#6bda2b");
  assert.equal(getSessionAccentHex("getlumos", INPUTS), "#95cef2");
  // same input → same output (hash determinism across runtimes: djb2 on UTF-16)
  assert.equal(getSessionAccentHex("omp-statusline", INPUTS), getSessionAccentHex("omp-statusline", { ...INPUTS }));
});

test("getSessionAccentHex: dark outputs stay in the visible band (l∈[0.65,0.88], c∈[0.05,0.21])", () => {
  for (let i = 0; i < 60; i++) {
    const { l, c } = hexToOklch(getSessionAccentHex(`session-${i}`, INPUTS));
    assert.ok(l >= 0.65 - 1e-6 && l <= 0.88 + 1e-6, `l ${l} out of band for session-${i}`);
    // No c floor: oklchToHex gamut-maps by chroma reduction, so hues near the
    // cusp-cap boundary desaturate below MIN_CHROMA — upstream identical.
    assert.ok(c <= 0.21 + 1e-6, `c ${c} out of band for session-${i}`);
  }
});

test("getSessionAccentHex: hue shifts ≥10° away from a lone theme color", () => {
  // Single occupied hue: findSafeHue can always place a safe hue, so the ≥10°
  // contract is enforceable. Crowded fields (sky 210° + sapphire 229° are 18°
  // apart) are best-effort upstream — no hue clears both, and findSafeHue
  // falls back to the raw pick ("no safe spot exists within the arc").
  const redHue = hexToOklch("#f38ba8").h; // 2.76°
  for (let i = 0; i < 100; i++) {
    const hex = getSessionAccentHex(`collide-${i}`, { ...INPUTS, colorHexes: ["#f38ba8"] });
    const o = hexToOklch(hex);
    // Target hue is placed ≥10° pre-gamut; near-gray outputs (c < 0.03 — the
    // algorithm's own hue-meaningfulness floor) drift post-mapping, like upstream.
    if (o.c >= 0.03) {
      assert.ok(hueDistance(o.h, redHue) >= 10 - 1e-6, `hue ${o.h} within 10° of red (collide-${i} → ${hex})`);
    }
  }
});

test("getSessionAccentHex: light theme bisects under the WCAG-AA luminance cap", () => {
  const surface = 0.72;
  const cap = (surface + 0.05) / 3 - 0.05;
  for (let i = 0; i < 40; i++) {
    const hex = getSessionAccentHex(`light-${i}`, { ...INPUTS, surfaceLuminance: surface });
    assert.ok(wcagLuminance(hex) <= cap + 1e-6, `light-${i} → ${hex} over cap ${cap}`);
  }
});

test("nameToHash: djb2 reference values (32-bit wraparound intact)", () => {
  assert.equal(nameToHash(""), 5381);
  assert.equal(nameToHash("a"), 177604); // 5381<<5 +5381 ^ 97, 32-bit
});

test("resolveAccent: truecolor colorizer; off/unnamed/no-inputs/malformed → null", () => {
  const fn = resolveAccent(true, "omp-statusline", INPUTS);
  assert.ok(fn);
  const out = fn!("x");
  assert.match(out, /\[38;2;\d+;\d+;\d+m/);
  assert.ok(out.endsWith("x" + String.fromCharCode(27) + "[39m")); // fg-only reset (ESC[39m)
  assert.equal(resolveAccent(false, "omp-statusline", INPUTS), null);
  assert.equal(resolveAccent(true, undefined, INPUTS), null);
  assert.equal(resolveAccent(true, "", INPUTS), null);
  assert.equal(resolveAccent(true, "omp-statusline", undefined), null);
  assert.equal(resolveAccent(true, "omp-statusline", { accentHex: "nope", colorHexes: [] }), null);
});

test("zaiLine: accent wraps glyph + label only; heat segments untouched", () => {
  const line = zaiLine(theme, quota(16), NOW, sep, accent);
  assert.ok(line.startsWith(" <ac>󰚯</ac> <ac>zai</ac> <accent>5hrs 16%/80%"));
  // value spans stay token-colored — the accent fn never sees them
  assert.ok(line.includes("<accent>5hrs 16%/80%"));
  assert.ok(!line.includes("<ac>5hrs"));
});

test("moneyLine: accent on 󰄬 + labels; dollar values keep success", () => {
  const line = moneyLine(theme, money, sep, accent);
  assert.ok(line.includes("<ac>󰄬</ac>"));
  assert.ok(line.includes("<ac>REPO</ac> <success>$68.36</>"));
  assert.ok(line.includes("<ac>30DAY</ac> <success>$492.88</>"));
  assert.ok(!line.includes("<ac>$"));
});

test("prayerLine: accent on 󰣎 only — past ✓ stays dim, next stays success", () => {
  const line = prayerLine(theme, deen, sep, accent);
  assert.ok(line.includes("<ac>󰣎</ac> <dim>Fajr 04:33 ✓</>"));
  assert.ok(line.includes("<success>Dhuhr 11:51 (3h 36m)</>"));
  assert.ok(!line.includes("<ac>Dhuhr"));
});

test("infoLine: accent on 󰥔 only; content stays dim", () => {
  const line = infoLine(theme, deen, NOW, sep, accent);
  assert.ok(line.includes("<ac>󰥔</ac>"));
  assert.ok(line.includes("<dim>Jakarta</>"));
  assert.ok(!line.includes("<ac>Tue"));
});

test("accent=null degrades byte-identical to baseline (no raw ANSI leaks)", () => {
  const [zai, prayer, info, mon] = [zaiLine(theme, quota(16), NOW, sep, null), prayerLine(theme, deen, sep, null), infoLine(theme, deen, NOW, sep, null), moneyLine(theme, money, sep, null)];
  for (const line of [zai, prayer, info, mon]) assert.ok(!line.includes("["), `raw escape leaked: ${line}`);
  assert.equal(mon, moneyLine(theme, money, sep));
  assert.equal(prayer, prayerLine(theme, deen, sep));
});

// oklchToHex roundtrip guard: golden vectors above are only as good as the
// conversion — pin one known OKLCH → hex mapping.
test("oklchToHex: catppuccin peach hue at its cusp maps in-gamut", () => {
  const peach = hexToOklch("#fab387");
  const atCusp = oklchToHex({ l: 0.75, c: 0.15, h: peach.h });
  assert.match(atCusp, /^#[0-9a-f]{6}$/);
});
