# README revamp — design (approved 2026-09-08)

Goal: world-class, stunning README for `@getpipher/omp-statusline` v0.3.0. Presentation
revamp only — content stays pinned to verified source behavior (`src/index.ts`,
`test/lines.test.ts` as golden strings).

## Structure (top → bottom)

1. **Header** — `# omp-statusline`, tightened one-liner, badge row (npm version · CI ·
   MIT · Node ≥20 · `omp extension` static). Max 5 badges.
2. **Hero** — `assets/hero.svg` replaces the ASCII block (repo rule: SVG over ASCII).
3. **What it renders** — tightened per-line table + heat/pace legend.
4. **Ledger section** — leads with the differentiator (disk-scan ledger, not live
   tracking) + `assets/dataflow.svg` (sources → widget lines).
5. **Install / Config / `/sl` / Provenance** — config gains a key→default→notes table.

## Hero SVG spec

- Dark terminal frame, GitHub-dark palette (canvas `#0d1117`, panel `#161b22`, border
  `#30363d`), rounded, macOS-style dimmed titlebar.
- Ghosted faux-editor above the widget (snippet of the extension's own source, very
  dim, with block cursor) — communicates "renders below the editor".
- The four v0.3.0 lines rendered exactly (order: info · prayers · money · zai) with
  the approved mock's numbers: `08:15 · 25 Rabīʿ al-awwal 1448 · Jakarta` etc.
  Token colors: text `#e6edf3`, dim `#8b949e`, success `#3fb950`, warning `#d29922`,
  error `#f85149`, accent `#58a6ff`.
- Below: hairline separator + dim annotation "omp native statusline closes the block"
  (honest — no fabricated native chrome; upstream #11100).
- Nerd glyphs (󰥔 󰣎 󰄬 󰚯) embedded as SVG `<path>` outlines extracted from
  JetBrainsMonoNerdFontMono-Regular via fontTools — `<img>` SVGs cannot load fonts,
  and PUA codepoints would tofu as `<text>`. ASCII text via system mono stack.

## Data-flow SVG spec

- Same dark palette/language. Left: three source nodes — omp sessions tree
  (disk scan, subagent transcripts included), z.ai quota API (key from pi auth.json,
  read-only), aladhan API (cached per local day). Right: widget panel with the four
  lines. Arrows source → line(s). Monochrome + single accent, minimal.

## Cross-cutting

- No emoji headings; no AI attribution; SVGs baked dark (read fine on light GitHub).
- Claims verified against source: render order (`widgetLines`), heat ≥70/≥90, pace
  over/under semantics, money segment colors, `/sl` report contents, config defaults
  (pollIntervalMs 180000 min 30000, authJsonPath, deen defaults).
- Throwaway generator scripts live in `/tmp` — only `assets/*.svg` + README are committed.

## Non-goals

- No code changes, no behavior changes, no TOC (short README, GitHub auto-TOC).
- ASCII block not kept alongside hero (SVG replaces it).
