// src/quota/opencode.ts
// OpenCode Go plan meter (https://opencode.ai/zen/go/v1/usage). Same fail-soft
// contract as quota/zai.ts: no throws, one 10 s timeout, parse at the boundary.
// Three windows: rolling 5-hour, weekly, and an anniversary-based monthly meter.
export const OPENCODE_QUOTA_API = "https://opencode.ai/zen/go/v1/usage";

export interface OpencodeWindow {
  percentage: number; // API `percent`, raw (display caps >100 at `100%+`)
  nextResetTime: number; // API `resetsAt` ISO string → ms epoch
  status: string; // API `status` ("ok" | "rate-limited"); "unknown" when absent
}

export interface OpencodeQuotaResult {
  rolling: OpencodeWindow | null;
  weekly: OpencodeWindow | null;
  monthly: OpencodeWindow | null;
  fetchedAt: number; // Date.now() at parse
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function parseWindow(value: unknown): OpencodeWindow | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const percentage = entry.percent;
  const resetsAt = entry.resetsAt;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return null;
  if (typeof resetsAt !== "string") return null;
  const nextResetTime = Date.parse(resetsAt);
  if (!Number.isFinite(nextResetTime)) return null;
  return {
    percentage,
    nextResetTime,
    status: typeof entry.status === "string" ? entry.status : "unknown",
  };
}

export function parseOpencodeQuota(body: string): OpencodeQuotaResult | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null; // literal JSON null / primitives

  const usage = parsed.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;

  const rolling = parseWindow(usage.rolling);
  const weekly = parseWindow(usage.weekly);
  const monthly = parseWindow(usage.monthly);
  if (!rolling && !weekly && !monthly) return null;
  return { rolling, weekly, monthly, fetchedAt: Date.now() };
}

export async function fetchOpencodeQuota(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<OpencodeQuotaResult | null> {
  try {
    const res = await fetchImpl(OPENCODE_QUOTA_API, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return parseOpencodeQuota(await res.text());
  } catch {
    return null;
  }
}
