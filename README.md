# omp-statusline

Four-line statusline widget for [omp](https://github.com/can1357/oh-my-pi) (Oh My Pi) — the omp-native successor to [pi-statusline](https://github.com/getpipher/pi-statusline). Renders below the editor, styled to match omp's native statusline (` · ` separators, nerd glyphs, theme tokens).

```
 󰥔 08:15 · 25 Rabīʿ al-awwal 1448 · Jakarta
 󰣎 Fajr 04:33 ✓ · Dhuhr 11:51 (3h 36m) · Asr 15:07 · Maghrib 17:52 · Isha 19:01
 󰄬 REPO $68.36 (1.3B) · DAY $26.50 (138.2M) · 7DAY $315.27 (2.7B) · 30DAY $492.88 (5.9B)
 󰚯 zai 5hrs 16%/80% (1h 36m over · 3h 43m) · 7DAY 24%/31% (1d 5h under · 4d 19h)
```

## Lines

Render order (top → bottom): info · prayers · money · zai — then omp's native statusline closes the block (extension widgets cannot render beneath it; tracked upstream as [can1357/oh-my-pi#11100](https://github.com/can1357/oh-my-pi/issues/11100)).

| Line | Contents |
|---|---|
| **info** | Local clock · Hijri date · city, all dim. |
| **prayers** | All five prayers with wall times. Past prayers get a dim `✓`; the next prayer is green with a countdown `(3h 36m)` on its segment only. Times from [aladhan](https://api.aladhan.com) (cached per local day, stale-marker on degradation). |
| **money** | API spend + token volume per window: `REPO $68.36 (1.3B)` (all-time for the current project) · `DAY` (since 00:00 local) · `7DAY`/`30DAY` (rolling, hour-aligned). Tokens are dim, from the same sessions scan. |
| **zai** | Quota windows `LABEL usage%/window-elapsed% (pace · reset)` — **pace** = `window × (usage% − elapsed%)/100`, rendered `Xd Yh over` (orange, burning faster than the clock — quota exhausts early by that much) or `under` (green, behind the clock). **Provider-gated**: renders only while the active model's provider is `zai` (or the provider is unreadable); vanishes entirely on other providers. Percent heat: accent < 70%, warning ≥ 70%, error ≥ 90% (raw — over-quota stays error-red, display caps at `100%+`). |

### Money source

Costs are disk-scanned from omp's own session tree (`~/.omp/agent/sessions/`), not tracked live:

- every session file embeds its `cwd` and per-assistant-message `usage.cost.total` — the tree is a complete ledger;
- **subagent spend is included**: subagent transcripts persist as session-format JSONL artifacts (`<repo-slug>/<session-id>/<Agent>.jsonl`) and are scanned too;
- entry ids are deduped globally, so branched/resumed session copies never double-count;
- the sessions tree (including history migrated from pi) supersedes the retired pi-statusline ledger.

Full rescan runs off the render path (~0.9 s over ~52 k entries) on the poll cycle; renders between polls use the cached snapshot.

## Install

```
omp plugin install @getpipher/omp-statusline
```

Or from a checkout: `omp plugin link /path/to/omp-statusline`.

## Config

`~/.omp/agent/omp-statusline/config.json` (all keys optional):

```json
{
  "zai": {
    "pollIntervalMs": 180000,
    "authJsonPath": "~/.pi/agent/auth.json"
  },
  "deen": {
    "city": "Jakarta",
    "country": "Indonesia",
    "method": "auto",
    "escalateMinutes": 30
  }
}
```

`authJsonPath` points at a pi-style auth JSON containing `{"zai": {"key": "…"}}` — omp has no auth store of its own, so the pi auth file is read (read-only) by default.

State (deen cache) lives beside the config in `~/.omp/agent/omp-statusline/`.

## Command

`/sl` — force a zai + deen + money refresh and notify full source state: quota freshness, today's plan credits, 7-day per-model split, usage streaks, cache-hit rate, prayer-city/hijri, and spend breakdown incl. subagent share and entry count. The z.ai dashboard endpoints (`credit-usage/usage-detail`, `credit-usage/activity`) accept the same API key as the quota API — no browser or cookie session needed.

## Provenance

Data layer (`src/quota/`, `src/deen/`, `src/adapters/`, `src/format.ts`, `src/types.ts`) vendored verbatim from `@getpipher/pi-statusline` (same author, MIT) — see `NOTICE`. MIT licensed.
