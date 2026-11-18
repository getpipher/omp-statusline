# OpenCode Go quota rows in omp-statusline

## Context

RECTOR has an OpenCode Go subscription and omp's default provider is already `opencode-go` (`~/.omp/agent/config.yml`: default/smol/slow/advisor = `opencode-go/deepseek-v4.1-flash:max`; the 2026-11-14 session JSONL records `"provider":"opencode-go"`). The widget's existing zai rows are provider-gated, so they are invisible while on Go. Goal: add zai-style quota rows for the OpenCode Go plan — one row per window (5-hour rolling, weekly, monthly) — shown only while the active provider is `opencode-go`.

Live endpoint probe on 2026-11-14 with the omp-stored Go key:

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <key>
→ {"usage":{"rolling":{"status":"ok","percent":40,"resetsAt":"2026-11-14T14:24:44.000Z"},
            "weekly":{"status":"ok","percent":16,"resetsAt":"2026-11-16T00:00:00.000Z"},
            "monthly":{"status":"ok","percent":8,"resetsAt":"2026-12-14T09:17:59.000Z"}}}
```

## Approach

### 1. New quota client — `src/quota/opencode.ts`

Mirror the fail-soft shape of `src/quota/zai.ts` (no throws, 10 s timeout, parse boundary). Do not use `createQuotaPoller` — `src/index.ts` polls directly (same as `pollZai`), and the vendored adapter layer is unwired.

Exports (exact):

```ts
export const OPENCODE_QUOTA_API = "https://opencode.ai/zen/go/v1/usage";

export interface OpencodeWindow {
  percentage: number;      // API `percent`, raw (display caps >100 at `100%+`)
  nextResetTime: number;   // API `resetsAt` ISO string → ms epoch
  status: string;          // API `status` ("ok" | "rate-limited"); "unknown" when absent
}

export interface OpencodeQuotaResult {
  rolling: OpencodeWindow | null;
  weekly: OpencodeWindow | null;
  monthly: OpencodeWindow | null;
  fetchedAt: number;       // Date.now() at parse
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function parseOpencodeQuota(body: string): OpencodeQuotaResult | null;
export async function fetchOpencodeQuota(apiKey: string, fetchImpl: FetchLike = fetch): Promise<OpencodeQuotaResult | null>;
```

`parseOpencodeQuota`:
- `JSON.parse` failure, non-object, or missing/non-object `usage` → `null`.
- Per window: require finite `number` `percent`; require `string` `resetsAt` parsing to a finite ms epoch; otherwise that window is `null`. Keep valid siblings.
- `status`: `typeof === "string"` else `"unknown"`.
- All three windows `null` → return `null`.
- Return `{ rolling, weekly, monthly, fetchedAt: Date.now() }`.

`fetchOpencodeQuota`:
- `GET OPENCODE_QUOTA_API` with `Authorization: Bearer ${apiKey}`, `Accept: application/json`, `signal: AbortSignal.timeout(10_000)`.
- `!res.ok` → `null`; any throw → `null`; otherwise `parseOpencodeQuota(await res.text())`.

### 2. Calendar-month window math — `src/quota/project.ts`

The Go monthly meter resets on the subscription anniversary, so its window is a calendar month (28–31 days), not a fixed constant. Append:

```ts
// OpenCode Go monthly meter: the window starts on the same UTC day-of-month in the
// previous month as `nextResetTime`. Clamp to the previous month's last day
// (Mar 31 → Feb 28/29). UTC arithmetic matches the API's UTC reset stamps.
export function previousMonthStartUtc(ts: number): number {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
  return Date.UTC(
    prevYear,
    prevMonth,
    Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

export function monthlyWindowMs(nextResetTime: number): number {
  return nextResetTime - previousMonthStartUtc(nextResetTime);
}
```

Verified values (execute these as test fixtures): `2026-12-14T09:17:59Z → 2026-11-14T09:17:59Z` (30 days); `2026-03-31T12:00Z → 2026-02-28T12:00Z` (31-day window); `2028-03-31T12:00Z → 2028-02-29T12:00Z` (31-day window); `2026-03-01T00:00Z → 2026-02-01T00:00Z` (28-day window).

### 3. Row rendering — `src/index.ts`

Introduce a minimal structural shape so zai and opencode windows share one segment builder:

```ts
// Minimal quota-window shape shared by zai's QuotaLimit and OpenCode windows.
interface WindowMeter {
  percentage: number;
  nextResetTime: number;
}
```

Widen only the parameter types (no behavior change): `usagePercent(w: WindowMeter)` and `windowSeg(theme: SlTheme, label: string, lim: WindowMeter, lengthMs: number, now: number)`. `QuotaLimit` remains assignable at the existing call sites.

Add after `zaiLines`:

```ts
// One row per OpenCode Go window; same segment grammar as zai. MONTH (not 30DAY)
// because the meter is anniversary-based and the window is 28–31 days.
export function opencodeLines(
  theme: SlTheme,
  data: OpencodeQuotaResult,
  now: number,
  accent?: AccentFn | null,
): string[] {
  const glyph = accent ?? ((t: string) => theme.fg("dim", t));
  const rows: string[] = [];
  if (data.rolling) rows.push(` ${glyph("󰚯")} ${glyph("opencode")} ${windowSeg(theme, "5hrs", data.rolling, FIVE_HOUR_MS, now)}`);
  if (data.weekly) rows.push(` ${glyph("󰚯")} ${glyph("opencode")} ${windowSeg(theme, "7DAY", data.weekly, WEEK_MS, now)}`);
  if (data.monthly) rows.push(` ${glyph("󰚯")} ${glyph("opencode")} ${windowSeg(theme, "MONTH", data.monthly, monthlyWindowMs(data.monthly.nextResetTime), now)}`);
  if (rows.length === 0) rows.push(theme.fg("dim", " 󰚯 opencode — no quota windows"));
  return rows;
}

// /sl report detail — same shape as zaiStatusDetail.
export function opencodeStatusDetail(data: OpencodeQuotaResult, now: number): string {
  const parts: string[] = [];
  if (data.rolling) parts.push(`5h ${data.rolling.percentage}%`);
  if (data.weekly) parts.push(`weekly ${data.weekly.percentage}%`);
  if (data.monthly) parts.push(`monthly ${data.monthly.percentage}%`);
  parts.push(`fetched ${Math.max(0, Math.floor((now - data.fetchedAt) / 60_000))}m ago`);
  return parts.join(" · ");
}
```

Use the same `󰚯` glyph as zai; the provider label distinguishes the blocks. Reuse `heat`, `paceText`, `windowElapsedPercent`, `formatReset`, `formatResetAbs`, `usagePercent` unchanged. Add `monthlyWindowMs` to the existing `./quota/project.ts` import, and add `import { fetchOpencodeQuota, type OpencodeQuotaResult } from "./quota/opencode.ts";`.

Unit-fixture row (theme stub `fg: (t, x) => \`<${t}>${x}</>\``, `now = new Date(2026, 10, 14, 10, 0)`, rolling 40% with reset `now + 1h`; the full three-row fixture is in §6):

```
 <dim>󰚯</> <dim>opencode</> <accent>5hrs 40%/80%</><dim> (</><success>2h 0m under</><dim> · </><dim>1h 0m</><dim> · </><dim>11:00</><dim>)</>
```

#### Expected widget render (target surface)

At `Sat 14 Nov 2026 20:51 WIB`, active provider `opencode-go`, using the live probe readings (40% / 16% / 8%) and the real resets; info/prayers use the live `deen-cache.json` values, money/version are representative. ANSI stripped — this is the seven-row block the user must see under the editor:

```
 󰥔 Sat 20:51 · 4 Jumādá al-ākhirah 1448 (14 Nov 2026) · Jakarta
 󰣎 Fajr 04:03 ✓ · Dhuhr 11:37 ✓ · Asr 14:59 ✓ · Maghrib 17:49 ✓ · Isha 19:02 ✓
 󰄬 REPO $68.36 (1.3B) · DAY $3.42 (12.1M) · 7DAY $21.10 (88.4M) · 30DAY $96.72 (402.1M)
 󰚯 opencode 5hrs 40%/89% (2h 27m under · 0h 33m · 21:24)
 󰚯 opencode 7DAY 16%/80% (4d 11h under · 1d 10h · Mon Nov 16 07:00)
 󰚯 opencode MONTH 8%/1% (2d 2h over · 29d 19h · Mon Dec 14 16:17)
 󰚦 omp 18.20.0 · sl 0.8.10 · tern 0.7.2
```

Token-marked quota rows that `opencodeLines` must produce at that clock (what the live tmux capture is checked against after SGR stripping):

```
 <dim>󰚯</> <dim>opencode</> <accent>5hrs 40%/89%</><dim> (</><success>2h 27m under</><dim> · </><dim>0h 33m</><dim> · </><dim>21:24</><dim>)</>
 <dim>󰚯</> <dim>opencode</> <accent>7DAY 16%/80%</><dim> (</><success>4d 11h under</><dim> · </><dim>1d 10h</><dim> · </><dim>Mon Nov 16 07:00</><dim>)</>
 <dim>󰚯</> <dim>opencode</> <accent>MONTH 8%/1%</><dim> (</><warning>2d 2h over</><dim> · </><dim>29d 19h</><dim> · </><dim>Mon Dec 14 16:17</><dim>)</>
```

These values were generated by executing the real `infoLine`/`prayerLine`/`moneyLine`/`versionLine` and an exact replica of the planned quota functions at the depicted clock — do not hand-edit the percentages; values drift with the live probe, only the format is fixed.

On a `zai` provider the same session renders the existing six-row block (info · prayers · money · two zai rows · versions); the three `opencode` rows are absent. That is the gating contract the live check verifies.

### 4. Key resolution, config, gate — `src/index.ts`

Rename the key shape (clean cutover, no alias):

```ts
export interface ResolvedKey { key: string; source: string }
```

Update `resolveZaiKey(...): Promise<ResolvedKey | null>` (the only two references are its declaration and return sites; no test imports `ZaiKey`).

Add:

```ts
// omp's credential store is the supported source for the Go provider: omp already
// holds the key it uses for inference (same key the usage endpoint accepts).
// No opencode-db/auth.json fallback — OpenCode v2 stores credentials in SQLite,
// and omp-only users need no OpenCode install.
export async function resolveOpencodeKey(ctx: SlCtx | null): Promise<ResolvedKey | null> {
  if (!ctx?.modelRegistry) return null;
  try {
    const key = await ctx.modelRegistry.getApiKeyForProvider("opencode-go");
    if (typeof key === "string" && key !== "") return { key, source: "omp credentials" };
  } catch {
    /* registry unavailable → inert rows */
  }
  return null;
}
```

Provider gate (pure + closure):

```ts
export function opencodeRelevant(provider: string | undefined): boolean {
  return provider === undefined || provider === "opencode-go";
}
```

Mirror `zaiRelevantNow`: re-read `ctx?.models?.current()?.provider` per render so `/model` switches take effect immediately. `opencode-zen` is deliberately excluded (the endpoint reports the Go plan; Zen usage is pay-as-you-go).

`LiveConfig`:
- Add required `opencodePollMs: number` after `zaiPollMs`.
- Defaults: `opencodePollMs: 180_000`.
- Parse `opencode.pollIntervalMs` with the zai guard: finite number and `>= 30_000`, else the default. Extend the `parsed` annotation with `opencode?: { pollIntervalMs?: unknown }`.

### 5. Extension wiring — `src/index.ts`

- State: `let opencodeData: OpencodeQuotaResult | null = null;` and `let warnedNoOpencodeKey = false;` beside `zaiData`/`warnedNoKey`.
- `pollOpencode()` mirrors `pollZai`:
  - `resolveOpencodeKey(ctx)`; on `null`: if `opencodeRelevantNow()` and `!warnedNoOpencodeKey`, set the flag and `ctx?.ui.notify("omp-statusline: no opencode-go key (omp credential store) — quota rows inert", "warning")`; then return without rendering.
  - `fetchOpencodeQuota(resolved.key)`; `if (result) opencodeData = result;` then `renderWidget()`. Catch swallows (keep last-good).
- `session_start`: call `void pollOpencode();` beside `pollZai` and add a third managed timer:
  `startTimer(slCtx, () => { void pollOpencode(); }, cfg.opencodePollMs);`
- `widgetLines`: after the zai block and before `versionLine`:
  `if (opencodeData && opencodeRelevantNow()) lines.push(...opencodeLines(theme, opencodeData, now, accent));`
  When the provider is unreadable and both datasets exist, both quota blocks render — the existing zai inert-fallback behavior, mirrored; no precedence rule.
- `renderWidget` fallback: after the zai status part, add
  `if (opencodeData && opencodeRelevantNow()) parts.push(opencodeStatusDetail(opencodeData, Date.now()));`
- `/sl` handler: `await pollOpencode();` after `pollZai`; resolve `const opencodeResolved = await resolveOpencodeKey(cmdCtx);`; build
  `const opencodePart = opencodeData ? \`key ${opencodeResolved?.source ?? "?"} · ${opencodeStatusDetail(opencodeData, Date.now())}\` : opencodeResolved ? "no quota data" : "no key";`
  and insert `opencode ${opencodePart}` between the zai and deen parts in the notify string. Update the command description to `"omp-statusline: force zai + opencode + deen + money refresh, report source state"`.

### 6. Tests — `test/opencode.test.ts` (new) + one fixture update

Keep the existing `test/lines.test.ts` theme stub pattern (`{ fg: (token, text) => \`<${token}>${text}</>\` }`). New tests:

1. **parse — live envelope**: body `{"usage":{"rolling":{"status":"ok","percent":40,"resetsAt":"2026-11-14T14:24:44.000Z"},"weekly":{"status":"ok","percent":16,"resetsAt":"2026-11-16T00:00:00.000Z"},"monthly":{"status":"ok","percent":8,"resetsAt":"2026-12-14T09:17:59.000Z"}}}`; assert each `percentage`, `nextResetTime === Date.parse(iso)`, `status === "ok"`, `fetchedAt > 0`.
2. **parse — partial/garbage**: only weekly valid → rolling/monthly `null`; invalid `resetsAt`/`percent`/missing `usage`/non-JSON → the invalid window is `null`; all-invalid → whole result `null`.
3. **fetch — fail-soft**: `fetchOpencodeQuota("k", async () => new Response("", { status: 401 }))` → `null`; a throwing stub → `null`. Use a cast for the stub (`as unknown as FetchLike`).
4. **calendar month**: assert the four verified `previousMonthStartUtc`/`monthlyWindowMs` pairs in §2 (30-day anniversary case, Mar 31 → Feb 28, leap-year Feb 29, Mar 1 → Feb 1 = 28 days).
5. **three rows — exact strings**: `now = new Date(2026, 10, 14, 10, 0).getTime()`; data `{ rolling: { percentage: 40, nextResetTime: now + 1h, status: "ok" }, weekly: { percentage: 16, nextResetTime: now + 3d + 18h, status: "ok" }, monthly: { percentage: 8, nextResetTime: new Date(2026, 11, 14, 9, 17, 59).getTime(), status: "ok" }, fetchedAt: now }`; assert `rows.length === 3` and exact equality:
   - ` <dim>󰚯</> <dim>opencode</> <accent>5hrs 40%/80%</><dim> (</><success>2h 0m under</><dim> · </><dim>1h 0m</><dim> · </><dim>11:00</><dim>)</>`
   - ` <dim>󰚯</> <dim>opencode</> <accent>7DAY 16%/46%</><dim> (</><success>2d 2h under</><dim> · </><dim>3d 18h</><dim> · </><dim>Wed Nov 18 04:00</><dim>)</>`
   - ` <dim>󰚯</> <dim>opencode</> <accent>MONTH 8%/0%</><dim> (</><warning>2d 9h over</><dim> · </><dim>29d 23h</><dim> · </><dim>Mon Dec 14 09:17</><dim>)</>` 
6. **heat + cap**: rolling 75 → `<warning>5hrs 75%/80%`; 95 → `<error>5hrs 95%/80%`; 105 → `<error>5hrs 100%+/80%`.
7. **monthly elapsed**: same monthly reset, `now = new Date(2026, 10, 29, 10, 0)` → `MONTH 8%/50%` and `<success>12d 14h under`.
8. **empty**: all windows `null` → `["<dim> 󰚯 opencode — no quota windows</>"]`.
9. **gate**: `opencodeRelevant(undefined) === true`, `"opencode-go" === true`, `"zai" === false`, `"opencode-zen" === false`, `"" === false`.
10. **key**: fake `SlCtx` with `ui` stub + registry returning `"go-key"` → `{ key: "go-key", source: "omp credentials" }` and the registry was called with exactly `"opencode-go"`; reject/`null`/`""`/no registry → `null`.
11. **config**: absent file → `opencodePollMs === 180_000`; `{"opencode":{"pollIntervalMs":45000}}` → `45000`; `1000`, `"x"`, `null` → default. (Use `mkdtempSync` like `test/zai-key.test.ts`.)
12. **status detail**: `opencodeStatusDetail(data, now)` → `"5h 40% · weekly 16% · monthly 8% · fetched 0m ago"`.

Update `test/zai-key.test.ts` line 37's `unconfigured: LiveConfig` literal to include `opencodePollMs: 180_000` (required field).

### 7. Documented contract — `README.md`

- Line 3: replace the tagline with `> Seven lines under your editor — Hijri clock, prayer times, API-spend ledger, per-window z.ai or OpenCode Go quota rows, and a version line — styled to match omp's native chrome.` (zai mode stays six rows; OpenCode Go mode is seven because the Go block has three windows).
- Line 17 render order: `info · prayers · money · zai (one row per window) · opencode (one row per Go window) · versions`.
- After the zai row (line 24), add an **opencode** row: one row per window (`5hrs`/`7DAY`/`MONTH`), same `LABEL usage%/elapsed% (pace · reset · absolute)` grammar, provider-gated to `opencode-go` (or unreadable), sourced from `GET https://opencode.ai/zen/go/v1/usage` with the omp-stored Go key.
- Config example + table: add `opencode.pollIntervalMs` default `180000`, clamp `≥ 30000`, "Poll cycle for the OpenCode Go usage endpoint; runs alongside the zai poller."

## Critical files & anchors

| File | Anchor | Why |
|---|---|---|
| `src/index.ts` | `LiveConfig` 101–137; `resolveZaiKey` 146–166; `usagePercent`/`windowSeg` 177–206; `zaiLines` 216–228; state/poll 299–411; timers 431–439; `/sl` 438–462 | All wiring, gating, and row rendering |
| `src/quota/project.ts` | after `windowElapsedPercent` (7–13) | Calendar-month window math |
| `src/quota/opencode.ts` | new | Fetch/parse boundary; no host imports |
| `test/lines.test.ts` | theme stub 12–13; zai row test 51–72 | Copy the exact-string/test-stub pattern |
| `test/zai-key.test.ts` | `LiveConfig` literal 37–42; config tests 44–60 | Required-field update; config-guard pattern |
| `README.md` | 3, 17, 24, 71 | User-facing row/config contract |

## Verification

Prerequisite: `node_modules` present (this checkout has it); otherwise `pnpm install --frozen-lockfile`.

1. **Gates**: `pnpm typecheck` → clean. `pnpm test` → existing 62 tests + the new `test/opencode.test.ts` all pass.
2. **Live parse** (real endpoint, key never printed):
   ```bash
   KEY=$(sqlite3 ~/.omp/agent/agent.db "select data from auth_credentials where provider='opencode-go' limit 1;" | jq -r .key)
   KEY="$KEY" node --input-type=module -e '
     import("./src/quota/opencode.ts").then(async (m) => {
       const r = await m.fetchOpencodeQuota(process.env.KEY);
       console.log(r ? `rolling=${r.rolling?.percentage} weekly=${r.weekly?.percentage} monthly=${r.monthly?.percentage}` : "null");
     });'
   ```
   Expected: one line with three non-null percentages (values drift; observed 2026-11-14: 40/16/8). `null` means the endpoint/parser/key path is wrong — inspect with a raw `curl` before changing code.
3. **Live render** (real omp TUI, isolated tmux socket):
   ```bash
   cd ~/local-dev/getpipher/omp-statusline
   WAS_LINK=$(readlink ~/.omp/plugins/node_modules/@getpipher/omp-statusline || true)
   omp plugin link "$PWD"
   readlink ~/.omp/plugins/node_modules/@getpipher/omp-statusline   # expect $PWD
   tmux -f /dev/null -L slocg new-session -d -s oc -c "$PWD" "omp"
   for i in $(seq 1 20); do
     tmux -f /dev/null -L slocg capture-pane -p -e -t oc:0.0 \
       | sed $'s/\x1b\\[[0-9;]*m//g' | grep -q 'opencode 5hrs' && break
     sleep 3
   done
   tmux -f /dev/null -L slocg capture-pane -p -e -t oc:0.0 \
     | sed $'s/\x1b\\[[0-9;]*m//g' | grep -E 'opencode (5hrs|7DAY|MONTH)'
   ```
   Expected: the three `opencode` rows in the **Expected widget render** block (values drift with the live probe; the 2026-11-14 probe read 40/16/8). Confirm no `zai 5hrs` row in the same capture — the provider gate must hide it on `opencode-go`; on a `zai` session the same capture must show the zai rows and no `opencode` rows.
4. **`/sl`** in the same tmux session: `tmux -f /dev/null -L slocg send-keys -t oc:0.0 '/sl' Enter`, wait 3 s, capture, and confirm the notification contains `opencode key omp credentials · 5h …` (proves registry key resolution + status detail). 
5. **Cleanup**: `tmux -f /dev/null -L slocg kill-server` (isolated socket only — never the default tmux server). If `WAS_LINK` was empty or not equal to `$PWD`, restore the published install: `omp plugin install @getpipher/omp-statusline --force`; if it was already this checkout, leave the link.

## Assumptions & contingencies

- **Endpoint contract** (verified live 2026-11-14): `usage.{rolling,weekly,monthly}.{status,percent,resetsAt}` with ISO UTC `resetsAt`. If the response shape changes, `parseOpencodeQuota` returns `null`, the widget keeps last-good data, and the fix is to update the parser from a fresh `curl` body — do not guess fields.
- **Provider id** is `opencode-go` (confirmed in `~/.omp/agent/config.yml` and the 2026-11-14 session JSONL). If the live render shows no rows while `/sl` says `key omp credentials`, inspect `ctx.models.current()?.provider` and the id passed to `getApiKeyForProvider`; do not add a file/SQLite fallback.
- **Key source is omp's credential store only**. OpenCode v2 stores credentials in its own SQLite DB; parsing that is out of scope. A missing key produces inert rows plus one warning (only while the provider is relevant), never a crash.
- **Polling** uses `opencode.pollIntervalMs` independently of `zai.pollIntervalMs`; both pollers run concurrently so a `/model` switch immediately has data. Values below 30 s fall back to the 180 s default, matching zai.
