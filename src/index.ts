// omp-statusline — 4-line belowEditor widget, RECTOR-approved 2026-09-07:
//   󰚯 zai 5HRS 16%/25% (3h 43m) · 7DAY 24%/31% (4d 19h)   ← provider-gated (zai only)
//   󰣎 Fajr 04:33 ✓ · Dhuhr 11:51 (3h 36m) · Asr 15:07 · Maghrib 17:52 · Isha 19:01
//   󰥔 08:15 · 25 Rabīʿ al-awwal 1448 · Jakarta
//   󰄬 REPO $68.36 · DAY $26.50 · 7DAY $315.27 · 30DAY $492.88
// Data layer vendored from @getpipher/pi-statusline (quota/zai, format, deen, adapters);
// money comes from the omp sessions disk-scan (money.ts — subagent-inclusive). State
// lives under ~/.omp/agent/omp-statusline/; the only ~/.pi read is the zai key
// (configurable authJsonPath — omp has no auth.json of its own).
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";

import { fetchQuota, readZaiKey, type QuotaLimit, type QuotaResult } from "./quota/zai.ts";
import { FIVE_HOUR_MS, WEEK_MS, windowElapsedPercent } from "./quota/project.ts";
import { formatReset } from "./format.ts";
import { createDeenSource, type DeenSnapshot, type DeenSourceConfig } from "./deen/source.ts";
import { zaiStatusDetail } from "./adapters/zai.ts";
import { scanMoney, type MoneySnapshot } from "./money.ts";

// --- omp extension API (structural; no host import needed) -------------------
export interface SlTheme {
  // omp theme instance handed to widget factories (probe-verified): fg(token, text)
  // returns theme-colored ANSI — success/warning/error/accent/dim/text…
  fg(token: string, text: string): string;
}
interface SlWidgetComponent {
  render(options?: unknown): string[];
}
interface SlUi {
  setStatus(key: string, text: string): void;
  setWidget(
    name: string,
    factory: (tui: unknown, theme: SlTheme) => SlWidgetComponent,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}
interface SlModel {
  provider?: string;
}
interface SlCtx {
  ui: SlUi;
  // omp-native model facade; absent in contexts that don't expose it → provider reads
  // as undefined and the zai gate falls back to "show" (inert-adapter philosophy:
  // plan data stays visible rather than vanishing when we can't read the provider).
  models?: { current(): SlModel | null };
}
interface SlApi {
  on(event: "session_start" | "model_select", handler: (event: unknown, ctx: SlCtx) => void): void;
  registerCommand(
    name: string,
    options: { description: string; handler: (args: string | undefined, ctx: SlCtx) => void | Promise<void> },
  ): void;
}

// --- state + config -----------------------------------------------------------
const STATE_DIR = join(homedir(), ".omp", "agent", "omp-statusline");
const CONFIG_PATH = join(STATE_DIR, "config.json");
const DEEN_CACHE = join(STATE_DIR, "deen-cache.json");

export interface LiveConfig {
  zaiPollMs: number;
  authJsonPath: string;
  deen: DeenSourceConfig;
}

// One boundary parse, then per-field typeof checks (pi-statusline config contract);
// unreadable/absent file → defaults below.
export function loadLiveConfig(configPath = CONFIG_PATH): LiveConfig {
  const defaults: LiveConfig = {
    zaiPollMs: 180_000,
    authJsonPath: join(homedir(), ".pi", "agent", "auth.json"),
    deen: { city: "Jakarta", country: "Indonesia", method: "auto", escalateMinutes: 30 },
  };
  let parsed: { zai?: { pollIntervalMs?: unknown; authJsonPath?: unknown }; deen?: Record<string, unknown> };
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as typeof parsed;
  } catch {
    return defaults;
  }
  const pollMs = parsed.zai?.pollIntervalMs;
  const authPath = parsed.zai?.authJsonPath;
  const esc = parsed.deen?.escalateMinutes;
  return {
    zaiPollMs: typeof pollMs === "number" && Number.isFinite(pollMs) && pollMs >= 30_000 ? pollMs : defaults.zaiPollMs,
    authJsonPath: typeof authPath === "string" && authPath !== "" ? authPath : defaults.authJsonPath,
    deen: {
      city: typeof parsed.deen?.city === "string" ? parsed.deen.city : defaults.deen.city,
      country: typeof parsed.deen?.country === "string" ? parsed.deen.country : defaults.deen.country,
      method: typeof parsed.deen?.method === "string" ? parsed.deen.method : defaults.deen.method,
      escalateMinutes: typeof esc === "number" && Number.isFinite(esc) ? esc : defaults.deen.escalateMinutes,
    },
  };
}

// --- line renderers (approved mockup, tmux window slmock, 2026-09-07) ---------
// Heat bands: quota windows tint accent → warning (≥70) → error (≥90); next prayer
// success-green; past prayers dim ✓; upcoming text; labels/glyphs/separators dim.
export function heat(pct: number): string {
  if (pct >= 90) return "error";
  if (pct >= 70) return "warning";
  return "accent";
}

function usagePercent(w: QuotaLimit): string {
  return w.percentage > 100 ? "100%+" : `${w.percentage}%`;
}

function windowSeg(theme: SlTheme, label: string, lim: QuotaLimit, lengthMs: number, now: number): string {
  const elapsed = `${windowElapsedPercent(lim.nextResetTime, lengthMs, now)}%`;
  return theme.fg(heat(lim.percentage), `${label} ${usagePercent(lim)}/${elapsed} (${formatReset(lim.nextResetTime, now)})`);
}

export function wallTime(wallMin: number): string {
  return `${String(Math.floor(wallMin / 60)).padStart(2, "0")}:${String(wallMin % 60).padStart(2, "0")}`;
}

export function zaiLine(theme: SlTheme, data: QuotaResult, now: number, sep: string): string {
  const segs: string[] = [];
  if (data.fiveHour) segs.push(windowSeg(theme, "5HRS", data.fiveHour, FIVE_HOUR_MS, now));
  if (data.weekly) segs.push(windowSeg(theme, "7DAY", data.weekly, WEEK_MS, now));
  if (segs.length === 0) return theme.fg("dim", " 󰚯 zai — no quota windows");
  return ` ${theme.fg("dim", "󰚯")} ${theme.fg("dim", "zai")} ${segs.join(sep)}`;
}

export function prayerLine(theme: SlTheme, s: DeenSnapshot, sep: string): string {
  const cells = s.schedule.map((e) => {
    if (e.state === "past" || e.state === "adhan") return theme.fg("dim", `${e.name} ${wallTime(e.wallMin)} ✓`);
    if (e.state === "next") {
      const m = Math.max(0, e.minutesUntil);
      const cd = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
      return theme.fg("success", `${e.name} ${wallTime(e.wallMin)} (${cd})`);
    }
    return theme.fg("text", `${e.name} ${wallTime(e.wallMin)}`);
  });
  const stale = s.staleMinutes !== null ? `${sep}${theme.fg("warning", `stale ${s.staleMinutes}m`)}` : "";
  return ` ${theme.fg("dim", "󰣎")} ${cells.join(sep)}${stale}`;
}

export function infoLine(theme: SlTheme, s: DeenSnapshot, now: number, sep: string): string {
  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return ` ${theme.fg("dim", "󰥔")} ${[clock, s.hijri, s.city].map((part) => theme.fg("dim", part)).join(sep)}`;
}

export function moneyLine(theme: SlTheme, m: MoneySnapshot, sep: string): string {
  const f = (n: number) => `$${n.toFixed(2)}`;
  const seg = (label: string, value: number) => `${theme.fg("dim", label)} ${theme.fg("success", f(value))}`;
  return ` ${theme.fg("dim", "󰄬")} ${[seg("REPO", m.repo), seg("DAY", m.day), seg("7DAY", m.week), seg("30DAY", m.month)].join(sep)}`;
}

// --- extension ---------------------------------------------------------------
export default function ompStatusline(pi: SlApi): void {
  const cfg = loadLiveConfig();
  mkdirSync(STATE_DIR, { recursive: true }); // deen cache + config live here
  const deen = createDeenSource({ cachePath: DEEN_CACHE, config: () => cfg.deen });
  const currentRepo = process.cwd().split("/").filter(Boolean).pop() ?? "unknown";
  let zaiData: QuotaResult | null = null;
  let money: MoneySnapshot = { repo: 0, day: 0, week: 0, month: 0, sub: 0, entries: 0 };
  let ctx: SlCtx | null = null;
  let started = false;
  let warnedNoKey = false;

  // zai quota gates on the ACTIVE provider (adapter.matches semantics): plan data is
  // only relevant while zai models burn it. Re-read per render so /model switches take
  // effect on the next tick (instantly when model_select fires).
  function zaiRelevantNow(): boolean {
    const provider = ctx?.models?.current()?.provider;
    return provider === undefined || provider === "zai";
  }

  function widgetLines(theme: SlTheme): string[] {
    const now = Date.now();
    const sep = theme.fg("dim", " · ");
    const s = deen.current();
    const lines: string[] = [];
    if (zaiData && zaiRelevantNow()) lines.push(zaiLine(theme, zaiData, now, sep));
    if (s) lines.push(prayerLine(theme, s, sep));
    if (s) lines.push(infoLine(theme, s, now, sep));
    lines.push(moneyLine(theme, money, sep));
    return lines;
  }

  // Primary surface: themed widget rows below the editor (theme.fg tokens — the ONLY
  // extension surface that carries omp theme colors). Falls back to the plain one-line
  // status chunk when the widget surface is unavailable.
  function renderWidget(): void {
    if (!ctx) return;
    try {
      ctx.ui.setWidget(
        "osl",
        (_tui: unknown, theme: SlTheme) => ({ render: () => widgetLines(theme) }),
        { placement: "belowEditor" },
      );
    } catch {
      const s = deen.current();
      const parts: string[] = [];
      if (s) {
        const next = s.schedule.find((e) => e.state === "next" || e.state === "adhan");
        if (next) parts.push(`${next.name} ${wallTime(next.wallMin)} in ${Math.max(0, next.minutesUntil)}m`);
      }
      if (zaiData && zaiRelevantNow()) parts.push(zaiStatusDetail(zaiData, Date.now()));
      parts.push(`REPO $${money.repo.toFixed(2)} · DAY $${money.day.toFixed(2)}`);
      if (parts.length > 0) ctx.ui.setStatus("osl", parts.join(" · "));
    }
  }

  async function pollZai(): Promise<void> {
    try {
      const key = readZaiKey(cfg.authJsonPath);
      if (!key) {
        if (!warnedNoKey) {
          warnedNoKey = true;
          ctx?.ui.notify(`omp-statusline: no zai key at ${cfg.authJsonPath} — quota line inert`, "warning");
        }
        return;
      }
      const result = await fetchQuota(key);
      if (result) zaiData = result;
    } catch {
      /* keep last-good; next poll retries */
    }
    renderWidget();
  }

  async function pollDeen(): Promise<void> {
    try {
      await deen.refresh(); // cache-keyed: hits aladhan at most once per local day
    } catch {
      /* source serves stale/last-good by contract */
    }
    renderWidget();
  }

  function pollMoney(): void {
    money = scanMoney(currentRepo);
    renderWidget();
  }

  pi.on("session_start", (_event: unknown, slCtx: SlCtx) => {
    ctx = slCtx;
    if (started) return;
    started = true;
    void pollZai();
    void pollDeen();
    pollMoney();
    setInterval(() => {
      renderWidget(); // countdowns (prayer + quota resets) move without new data
    }, 30_000);
    setInterval(() => {
      void pollZai();
      void pollDeen();
      pollMoney(); // full rescan ~0.9s off the render path
    }, cfg.zaiPollMs);
  });

  pi.on("model_select", () => renderWidget());

  pi.registerCommand("sl", {
    description: "omp-statusline: force zai + deen + money refresh, report source state",
    handler: async (_args: string | undefined, cmdCtx: SlCtx) => {
      ctx = cmdCtx;
      await pollZai();
      await pollDeen();
      pollMoney();
      const s = deen.current();
      const zaiPart = zaiData ? zaiStatusDetail(zaiData, Date.now()) : "no data";
      const deenPart = s ? `${s.city} · ${s.hijri}${s.staleMinutes !== null ? ` · stale ${s.staleMinutes}m` : " · fresh"}` : "no data";
      const moneyPart = `REPO $${money.repo.toFixed(2)} · DAY $${money.day.toFixed(2)} · 7DAY $${money.week.toFixed(2)} · 30DAY $${money.month.toFixed(2)} · sub $${money.sub.toFixed(2)} · ${money.entries} entries`;
      cmdCtx.ui.notify(`zai ${zaiPart} | deen ${deenPart} | money ${moneyPart}`, "info");
    },
  });
}
