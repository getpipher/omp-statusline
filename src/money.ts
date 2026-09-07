// money.ts — omp sessions disk-scan ledger. Sole money source (decision 2026-09-07):
// the sessions tree is a superset of the retired pi ledger (migrated history inside),
// covers subagent spend (<session-dir>/<Agent>.jsonl artifacts carry usage), and every
// file embeds its cwd in the {"type":"session"} line → repo attribution without guesses.
// Windows: DAY = since local midnight; 7DAY/30DAY = rolling, aligned to the current hour
// (hourFloor(now) − N×24h — RECTOR semantics, NOT pi-statusline's calendar-day buckets).
// Entry ids are uuid7; branched/resumed session copies share ids → dedupe on the bare id
// so a re-persisted message is never counted twice. Full rescan (~0.9s over ~560 files)
// per poll cycle; renders between polls use the cached snapshot.
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

export interface MoneySnapshot {
  repo: number; // all-time for the CURRENT repo (basename of extension cwd)
  day: number; // since 00:00 local
  week: number; // hourFloor(now) − 7×24h
  month: number; // hourFloor(now) − 30×24h
  sub: number; // subagent-artifact share of those windows' union (reporting only)
  entries: number;
}

interface CostEntry { ts: number; cost: number; repo: string; sub: boolean }

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Boundary parse follows the pi-statusline ledger convention: JSON.parse → Record,
// then per-field typeof checks; malformed lines skip (torn tail of a live writer).
function parseSessionFile(path: string, sub: boolean, out: CostEntry[], seen: Set<string>): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  let repo = "unknown";
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (e.type === "session" && typeof e.cwd === "string") {
      repo = e.cwd.split("/").filter(Boolean).pop() ?? "unknown";
      continue;
    }
    if (e.type !== "message" || typeof e.id !== "string") continue;
    const m = e.message;
    if (typeof m !== "object" || m === null) continue;
    const msg = m as Record<string, unknown>;
    if (msg.role !== "assistant") continue;
    const usage = msg.usage;
    if (typeof usage !== "object" || usage === null) continue;
    const cost = (usage as Record<string, unknown>).cost;
    if (typeof cost !== "object" || cost === null) continue;
    const total = (cost as Record<string, unknown>).total;
    if (typeof total !== "number" || !Number.isFinite(total)) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const ts = typeof e.timestamp === "string" && Number.isFinite(Date.parse(e.timestamp)) ? Date.parse(e.timestamp) : 0;
    out.push({ ts, cost: total, repo, sub });
  }
}

export function scanMoney(
  currentRepo: string,
  now = Date.now(),
  root = join(homedir(), ".omp", "agent", "sessions"),
): MoneySnapshot {
  const entries: CostEntry[] = [];
  const seen = new Set<string>();
  let repoDirs: string[];
  try {
    repoDirs = readdirSync(root);
  } catch {
    return { repo: 0, day: 0, week: 0, month: 0, sub: 0, entries: 0 };
  }
  for (const slug of repoDirs) {
    const repoDir = join(root, slug);
    let dirents;
    try {
      dirents = readdirSync(repoDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of dirents) {
      if (f.isFile() && f.name.endsWith(".jsonl")) {
        // main session file: <repoSlug>/<ts-id>.jsonl
        parseSessionFile(join(repoDir, f.name), false, entries, seen);
      } else if (f.isDirectory()) {
        // subagent artifacts: <repoSlug>/<session-dir>/*.jsonl
        let nested;
        try {
          nested = readdirSync(join(repoDir, f.name), { withFileTypes: true });
        } catch {
          continue;
        }
        for (const g of nested) {
          if (g.isFile() && g.name.endsWith(".jsonl")) parseSessionFile(join(repoDir, f.name, g.name), true, entries, seen);
        }
      }
    }
  }
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const hourFloor = now - (now % HOUR_MS);
  let repo = 0, day = 0, week = 0, month = 0, sub = 0;
  const windowStart = hourFloor - 30 * DAY_MS; // widest window — sub share reported over it
  for (const e of entries) {
    if (currentRepo !== "unknown" && e.repo === currentRepo) repo += e.cost;
    if (e.ts >= midnight.getTime()) day += e.cost;
    if (e.ts >= hourFloor - 7 * DAY_MS) week += e.cost;
    if (e.ts >= windowStart) {
      month += e.cost;
      if (e.sub) sub += e.cost;
    }
  }
  return { repo, day, week, month, sub, entries: entries.length };
}
