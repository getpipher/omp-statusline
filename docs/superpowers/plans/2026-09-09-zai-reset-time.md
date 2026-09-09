# zai Reset-Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each zai quota window's parenthetical gains the absolute wall-clock reset time after the existing countdown: `(9m under · 4h 47m · 23:30)`.

**Architecture:** Presentation-only. `formatResetAbs` (new pure formatter in `src/format.ts`) turns the already-polled `nextResetTime` epoch into `HH:MM` (same local day) or `Mon DD HH:MM` (other day); `windowSeg` in `src/index.ts` renders it as one extra dim fragment. Data layer, poller, adapters, config: untouched.

**Tech Stack:** TypeScript (raw `.ts`, no build), `node --test` via tsx-capable Node, pnpm. Spec: `docs/superpowers/specs/2026-09-09-zai-reset-time-design.md`.

## Global Constraints

- Branch: `feat/zai-reset-time` (exists; spec committed at 592e532).
- Parenthetical order per window: `pace · countdown · absolute` (spec UI section).
- Absolute rule: reset today (machine-local calendar) → `HH:MM`; otherwise → `Mon DD HH:MM` (EN month table, no weekday, no `Intl`).
- Past/now reset renders `now` (mirrors `formatReset`'s `remaining <= 0` guard).
- All three parenthetical fragments render `theme.fg("dim", …)`; only pace keeps its over/under token. `formatReset` itself is NOT modified.
- Machine-local timezone everywhere (same as `infoLine`'s clock) — never Asia/Shanghai.
- Tests must be timezone-safe: fixed `now` built with local `new Date(y, m, d, hh, mm)` at Sep 9–13 instants (DST-edge-free globally).
- Commits: one per task, conventional style (`feat:`/`chore:`), no AI attribution.
- Run commands: `pnpm test:run` (full suite), `node --test test/lines.test.ts` (single file), `pnpm typecheck`.

---

### Task 1: `formatResetAbs` formatter (TDD)

**Files:**
- Modify: `src/format.ts` (append after `formatReset`, which ends at line 44)
- Test: `test/lines.test.ts` (add import at line 5 area; add test after the `zaiLine` test ending line 66)

**Interfaces:**
- Consumes: `formatClock(ts: number): string` (exists in `src/format.ts:20-23`, returns local `HH:MM`).
- Produces: `formatResetAbs(targetMs: number, now: number): string` exported from `src/format.ts` — Task 2 imports this exact name.

- [ ] **Step 1: Write the failing test**

In `test/lines.test.ts`, add to the imports (new line after line 9's `QuotaResult` import):

```ts
import { formatResetAbs } from "../src/format.ts";
```

Insert after line 66 (end of the `zaiLine` test):

```ts
test("formatResetAbs: same-day clock, cross-day month-day, past → now", () => {
  const now = new Date(2026, 8, 9, 10, 0).getTime(); // Wed 09 Sep 2026 10:00 local — DST-edge-free
  assert.equal(formatResetAbs(now + HOUR, now), "11:00");
  assert.equal(formatResetAbs(now + 20 * HOUR, now), "Sep 10 06:00");
  assert.equal(formatResetAbs(now - 60_000, now), "now");
});
```

(`HOUR` is declared at `test/lines.test.ts:103`; test callbacks run after module evaluation, so the forward reference is safe.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "formatResetAbs" test/lines.test.ts`
Expected: FAIL — `SyntaxError: The requested module '../src/format.ts' does not provide an export named 'formatResetAbs'`.

- [ ] **Step 3: Implement**

Append at end of `src/format.ts` (after `formatReset`'s closing brace, line 44):

```ts
// v0.3.x absolute reset wall-clock (reset-time feature): same-day resets read as
// clock time (`23:30`); anything further out carries an EN month-day (`Sep 12
// 04:09`) — no weekday abbreviation (ambiguous when the reset lands on the
// viewer's own weekday). Machine-local like infoLine's clock; hardcoded EN months
// keep rendering deterministic (no Intl comma/platform variance).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatResetAbs(targetMs: number, now: number): string {
  if (targetMs <= now) return "now";
  const t = new Date(targetMs);
  const n = new Date(now);
  const sameDay =
    t.getFullYear() === n.getFullYear() &&
    t.getMonth() === n.getMonth() &&
    t.getDate() === n.getDate();
  return sameDay ? formatClock(targetMs) : `${MONTHS[t.getMonth()]} ${t.getDate()} ${formatClock(targetMs)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern "formatResetAbs" test/lines.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/lines.test.ts
git commit -m "feat: formatResetAbs — absolute local reset wall-clock (HH:MM / Mon DD HH:MM)"
```

---

### Task 2: `windowSeg` renders the absolute fragment (TDD)

**Files:**
- Modify: `src/index.ts:17` (import), `src/index.ts:180-181` (fragment insert)
- Test: `test/lines.test.ts:50-66` (rewrite `zaiLine` test with a pinned `now`)

**Interfaces:**
- Consumes: `formatResetAbs(targetMs: number, now: number): string` (Task 1).
- Produces: no signature changes. `zaiLine`'s output shape gains one dim fragment per window — Task 3's docs sweep pins the same shape.

- [ ] **Step 1: Rewrite the failing `zaiLine` test**

Replace the whole test block at `test/lines.test.ts:50-66` with (pinned `now` — the old `Date.now()` would make same-day vs cross-day flaky near midnight):

```ts
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
  assert.ok(zaiLine(theme, both, now, sep).includes("<dim> · Sep 13 04:00</>")); // cross-day → month-day form
  const none: QuotaResult = { tier: "pro", fiveHour: null, weekly: null, fetchedAt: now };
  assert.equal(zaiLine(theme, none, now, sep), "<dim> 󰚯 zai — no quota windows</>");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "zaiLine" test/lines.test.ts`
Expected: FAIL — actual parenthetical lacks ` · 11:00`.

- [ ] **Step 3: Implement**

`src/index.ts:17` — extend the import:

```ts
import { formatReset, formatResetAbs } from "./format.ts";
```

`src/index.ts` — in `windowSeg`, insert one array element between the countdown element (line 180) and the closing-paren element (line 181), so the tail of the array reads:

```ts
    theme.fg("dim", " · "),
    theme.fg("dim", formatReset(lim.nextResetTime, now)),
    theme.fg("dim", ` · ${formatResetAbs(lim.nextResetTime, now)}`),
    theme.fg("dim", ")"),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/lines.test.ts`
Expected: PASS — all tests in the file, including the rewritten `zaiLine` and Task 1's `formatResetAbs`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/lines.test.ts
git commit -m "feat: zai windows render absolute reset time after the countdown"
```

---

### Task 3: Stale-doc sweep — header comment, README row, hero SVG

**Files:**
- Modify: `src/index.ts:2` (header example)
- Modify: `README.md:24` (zai row example)
- Modify: `assets/hero.svg` (canvas widen 866→980 + append two dim tspans on the zai row)

**Interfaces:**
- Consumes: the rendered shape from Task 2 (`pace · countdown · absolute`).
- Produces: docs/hero that match the renderer exactly.

**Width math (why the canvas widens):** the zai row grows to 101 chars ≈ 101 × 9px = 909px at 15px mono, ending at x≈959 — past the current 866 viewBox. New canvas 980 leaves a 21px right margin. Mock stays internally consistent: clock 08:15 + 3h 43m = 11:58; mock day (Sep 7, the approval date per `src/index.ts:1`) + 4d 19h = Sep 12 03:15.

- [ ] **Step 1: Update the header example**

Replace `src/index.ts:2` with:

```ts
//   󰚯 zai 5hrs 16%/80% (1h 36m over · 3h 43m · 11:58) · 7DAY 24%/31% (1d 5h under · 4d 19h · Sep 12 03:15)   ← provider-gated (zai only)
```

- [ ] **Step 2: Update the README zai row**

Replace `README.md:24` with:

```markdown
| **zai** | Quota pace per window: `LABEL usage%/elapsed% (pace · reset · absolute)` — e.g. `5hrs 16%/80% (1h 36m over · 3h 43m · 11:58)`. **Provider-gated**: renders only while the active model's provider is `zai` (or the provider is unreadable); vanishes entirely on other providers. |
```

- [ ] **Step 3: Widen the hero canvas**

Six coordinated edits in `assets/hero.svg`:

1. Line 1: `width="866" height="329" viewBox="0 0 866 329"` → `width="980" height="329" viewBox="0 0 980 329"`
2. Line 17: `<rect x="0.5" y="0.5" width="865" height="328"` → `width="979"`
3. Line 18 titlebar: `H856 A9.5 9.5 0 0 1 865.5 10 V33.5` → `H969 A9.5 9.5 0 0 1 978.5 10 V33.5`
4. Line 37 hairline: `M26.0 285.0 H 840.0` → `M26.0 285.0 H 954.0`
5. Line 22 (titlebar text): `x="433.0"` → `x="490.0"`
6. Line 38 (annotation text): `x="433.0"` → `x="490.0"`

- [ ] **Step 4: Append the absolute tspans on the hero zai row**

On line 36, replace `<tspan fill="#8b949e">3h 43m</tspan><tspan fill="#8b949e">)</tspan>` with:

```svg
<tspan fill="#8b949e">3h 43m</tspan><tspan fill="#8b949e"> · 11:58</tspan><tspan fill="#8b949e">)</tspan>
```

and replace `<tspan fill="#8b949e">4d 19h</tspan><tspan fill="#8b949e">)</tspan></text>` with:

```svg
<tspan fill="#8b949e">4d 19h</tspan><tspan fill="#8b949e"> · Sep 12 03:15</tspan><tspan fill="#8b949e">)</tspan></text>
```

- [ ] **Step 5: Visual check of the hero**

Run: rasterize `assets/hero.svg` (e.g. `read assets/hero.svg:img` in-session) and confirm: no clipping at the right edge, zai row shows both absolutes, titlebar/annotation centered, hairline spans the new width.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts README.md assets/hero.svg
git commit -m "docs: sync header/README/hero with absolute reset times; widen hero canvas to 980"
```

---

### Task 4: Verification + release prep

**Files:**
- Modify: `package.json:3` (version bump)
- Create then delete: `smoke-reset.ts` (throwaway live smoke, never committed)

**Interfaces:**
- Consumes: everything above; `fetchQuota`, `zaiLine`, `loadLiveConfig`, `resolveZaiKey` from the existing modules.

- [ ] **Step 1: Full suite + typecheck**

Run: `pnpm typecheck && pnpm test:run`
Expected: exit 0; all tests pass (lines, zai-key, zai-extra, money).

- [ ] **Step 2: Live smoke against the real API**

Create `smoke-reset.ts` at repo root:

```ts
import { fetchQuota } from "./src/quota/zai.ts";
import { zaiLine, loadLiveConfig, resolveZaiKey, type SlTheme } from "./src/index.ts";
const cfg = loadLiveConfig();
const zk = await resolveZaiKey(null, cfg);
if (!zk) throw new Error("no zai key resolved");
const data = await fetchQuota(zk.key);
if (!data) throw new Error("quota fetch failed");
console.log(zaiLine({ fg: (_t: string, s: string) => s } as SlTheme, data, Date.now(), " · "));
```

Run: `node smoke-reset.ts`
Expected: one line shaped ` 󰚯 zai 5hrs … (… · 23:30) · 7DAY … (… · Sep 12 04:09)` on 2026-09-09 (absolute times come from the live `nextResetTime` epochs verified in the spec; values drift as windows roll — the shape is the contract). Then `rm smoke-reset.ts`.

- [ ] **Step 3: Version bump**

`package.json:3`: `"version": "0.4.0"` → `"version": "0.5.0"` (minor: new rendered component, no breaking change).

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feat/zai-reset-time
gh pr create --fill --base main
```

PR body: link the spec `docs/superpowers/specs/2026-09-09-zai-reset-time-design.md`, note the hero canvas widen and the live-smoke output. Tag `v0.5.0` after merge is RECTOR's call (tag push triggers the release workflow).
