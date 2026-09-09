# zai reset-time — design (approved 2026-09-09)

Goal: each zai quota window's parenthetical gains the absolute wall-clock reset time
alongside the existing countdown. Presentation-only — the data layer is untouched:
`nextResetTime` (ms-epoch UTC) is already parsed, validated finite, and polled
(`parseQuotaLimit`, `src/quota/zai.ts:44-68`; segment render, `windowSeg`,
`src/index.ts:172-183`).

## Verified API facts (live probe, 2026-09-09)

- Endpoint `GET https://api.z.ai/api/monitor/usage/quota/limit` (same key) returns
  `data.limits[]` — unit 3 = 5-hour window, unit 6 = weekly — each with `nextResetTime`.
- **5HRS is rolling**: each cycle anchors at the first request after the previous
  reset, so the wall-clock reset time shifts every cycle. Probe: reset 23:30 Jakarta
  (window started 18:30); the "11:30" seen earlier was the previous cycle's reset.
- **7DAY**: epoch 1789160956993 → Sat 12 Sep 04:09 Jakarta. The console's "05:09"
  is the same instant in UTC+8 (Asia/Shanghai frame). Epoch is authoritative; we
  render machine-local (RECTOR = Jakarta, UTC+7).

## UI (approved — option B, both signals kept)

```
󰚯 zai 5hrs 1%/4% (9m under · 4h 47m · 23:30) · 7DAY 75%/66% (15h 7m over · 2d 9h · Sep 12 04:09)
```

- Parenthetical per window: `pace · countdown · absolute`.
- Absolute rule: reset falling **today** (machine-local calendar) → `HH:MM`
  (`23:30`); **any other day** → `Mon DD HH:MM` (`Sep 12 04:09`). No weekday
  abbreviation — ambiguous when the weekly reset lands on the viewer's weekday.
- Timezone: machine-local, consistent with `infoLine`'s clock. Never the API's
  Shanghai frame.
- All three parenthetical fragments render `dim`; only pace keeps its over/under
  token (reset info is periphery, v0.4.7 convention).
- Accepted cost: line grows ~23 columns vs the current shape.

## Code

- `src/format.ts` — new pure `formatResetAbs(targetMs: number, now: number): string`:
  - `targetMs <= now` → `"now"` (mirrors `formatReset`'s guard);
  - same local calendar day as `now` → `HH:MM` via existing `formatClock`;
  - otherwise → `Sep 12 04:09` via a hardcoded EN month table (deterministic, no
    `Intl` comma/platform variance).
  - `formatReset` (countdown) stays as-is.
- `src/index.ts` `windowSeg` — insert one fragment before the closing paren:
  `` theme.fg("dim", ` · ${formatResetAbs(lim.nextResetTime, now)}`) ``.
- Stale-doc sweep: header example `src/index.ts:2`, the README widget example
  (README.md:24), and `assets/hero.svg`'s embedded zai row (tspans at line 36 —
  plain monospace `<text>`, glyphs stay symbol refs) all gain the absolute times.
  `dataflow.svg` labels only ("zai · provider-gated") — no line content, no change.
- Zero changes: API/poller (`quota/zai.ts`), adapters, `/sl` report, config schema.

## Tests (`test/lines.test.ts`)

- `formatResetAbs`: same-day → `23:30`; crosses midnight → `Sep 10 01:30`; past →
  `now`. Timestamps built from local `new Date(y, m, d, hh, mm)` constructors at
  DST-edge-free instants, so assertions hold in any CI timezone.
- `zaiLine` approved-format test: parenthetical now three fragments — pace (own
  token), countdown `dim`, absolute `dim`.

## Verification

- `pnpm typecheck && pnpm test:run` green.
- Live tmux render of the real widget: 5HRS shows today's actual reset clock-time,
  7DAY shows `Sep 12 04:09` from live API data.

## Non-goals

- No countdown removal, no compact/adaptive variants, no config knob, no tz
  override, no `/sl` change, no adapter or API change.
