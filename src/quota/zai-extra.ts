// src/quota/zai-extra.ts — z.ai dashboard-backed data (endpoints discovered
// 2026-09-07 from the coding-plan usage pages; all accept the same API key as
// quota/limit, so the extension never needs the browser). Line-side: today's
// plan-credit burn — the flat-rate-vs-API-cost benchmark against money-line DAY $.
// /sl-side: 7-day per-model split, streaks, cache-hit rate.
const DETAIL_API = "https://api.z.ai/api/monitor/credit-usage/usage-detail";
const ACTIVITY_API = "https://api.z.ai/api/monitor/credit-usage/activity";

export interface ZaiModelSplit {
  name: string;
  credits: number;
}

export interface ZaiDetailSummary {
  todayCredits: number | null;
  cacheHitRate: number | null; // 0..1
  models: ZaiModelSplit[]; // range total per model, sorted desc
}

export interface ZaiActivity {
  streakDays: number | null;
  longestStreakDays: number | null;
}

// Local YYYY-MM-DD — the dashboard passes local-midnight boundaries; Jakarta vs the
// server's Asia/Shanghai frame differ by 1h, which only shifts the day edge slightly.
function localDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "short" }).format(d);
}

function dayRange(days: number, now: Date): { start: string; end: string } {
  const end = localDateKey(now);
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  return { start: `${localDateKey(start)} 00:00:00`, end: `${end} 23:59:59` };
}

// Boundary parse: code===200 envelope, then per-field typeof/finite checks
// (pi-statusline contract). Numbers arrive as strings ("11614.3040").
const num = (v: unknown): number | null => (typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseUsageDetail(body: string): Pick<ZaiDetailSummary, "todayCredits" | "cacheHitRate" | "models"> | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed.code !== 200 || typeof parsed.data !== "object" || parsed.data === null) return null;
  const data = parsed.data as Record<string, unknown>;
  const summary = typeof data.summary === "object" && data.summary !== null ? (data.summary as Record<string, unknown>) : null;
  const todayCredits = summary ? num((summary.totalCredits as Record<string, unknown> | undefined)?.value) : null;
  const cacheHitRate = summary ? num((summary.cacheHitRate as Record<string, unknown> | undefined)?.value) : null;

  const modelUsage = typeof data.modelUsage === "object" && data.modelUsage !== null ? (data.modelUsage as Record<string, unknown>) : null;
  const list = modelUsage && Array.isArray(modelUsage.modelDataList) ? (modelUsage.modelDataList as Record<string, unknown>[]) : [];
  const models: ZaiModelSplit[] = [];
  for (const m of list) {
    const name = typeof m.modelName === "string" ? m.modelName : typeof m.modelCode === "string" ? m.modelCode : null;
    const arr = Array.isArray(m.totalCreditsUsage) ? (m.totalCreditsUsage as unknown[]) : null;
    if (!name || !arr) continue;
    let credits = 0;
    let seenAny = false;
    for (const v of arr) {
      const n = num(v);
      if (n !== null) {
        credits += n;
        seenAny = true;
      }
    }
    if (seenAny) models.push({ name, credits });
  }
  models.sort((a, b) => b.credits - a.credits);
  return { todayCredits, cacheHitRate, models };
}

export function parseActivity(body: string): ZaiActivity | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed.code !== 200 || typeof parsed.data !== "object" || parsed.data === null) return null;
  const summary = (parsed.data as Record<string, unknown>).summary;
  if (typeof summary !== "object" || summary === null) return null;
  const s = summary as Record<string, unknown>;
  const streak = typeof s.currentStreakDays === "number" && Number.isFinite(s.currentStreakDays) ? s.currentStreakDays : null;
  const longest = typeof s.longestStreakDays === "number" && Number.isFinite(s.longestStreakDays) ? s.longestStreakDays : null;
  return { streakDays: streak, longestStreakDays: longest };
}

async function getJson(url: string, key: string, fetchImpl?: typeof fetch): Promise<string | null> {
  try {
    const res = await (fetchImpl ?? fetch)(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null; // fail-soft: last-good render state wins
  }
}

function detailUrl(range: { start: string; end: string }): string {
  return `${DETAIL_API}?startTime=${encodeURIComponent(range.start)}&endTime=${encodeURIComponent(range.end)}&usageType=MODEL&type=1`;
}

// Line-side poll: ONE call — today's plan-credit total.
export async function fetchTodayCredits(key: string, fetchImpl?: typeof fetch, now = new Date()): Promise<number | null> {
  const body = await getJson(detailUrl(dayRange(1, now)), key, fetchImpl);
  return body ? (parseUsageDetail(body)?.todayCredits ?? null) : null;
}

// /sl-side report: today + 7-day model split + activity streaks. Per-part fail-soft —
// a null part degrades its notify fragment, never the whole report.
export async function fetchZaiReport(
  key: string,
  fetchImpl?: typeof fetch,
  now = new Date(),
): Promise<ZaiDetailSummary & ZaiActivity> {
  const [todayBody, weekBody, activityBody] = await Promise.all([
    getJson(detailUrl(dayRange(1, now)), key, fetchImpl),
    getJson(detailUrl(dayRange(7, now)), key, fetchImpl),
    getJson(`${ACTIVITY_API}?startTime=${encodeURIComponent(dayRange(365, now).start)}&endTime=${encodeURIComponent(dayRange(1, now).end)}&type=1`, key, fetchImpl),
  ]);
  const today = todayBody ? parseUsageDetail(todayBody) : null;
  const week = weekBody ? parseUsageDetail(weekBody) : null;
  const activity = activityBody ? parseActivity(activityBody) : null;
  return {
    todayCredits: today?.todayCredits ?? null,
    cacheHitRate: today?.cacheHitRate ?? week?.cacheHitRate ?? null,
    models: week?.models ?? [],
    streakDays: activity?.streakDays ?? null,
    longestStreakDays: activity?.longestStreakDays ?? null,
  };
}
