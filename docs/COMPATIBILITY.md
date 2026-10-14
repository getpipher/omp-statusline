# Compatibility Archive — @getpipher/omp-statusline

Per-run authoritative record, created on first use per `.omp/commands/compat-update.md` Step 6. One `## omp TARGET (DATE)` section per compat run: research, gates, render verification, verdict.

## omp 18.9.2 (2026-10-12)

- **Target**: omp v18.9.2 (published 2026-10-11); running binary already 18.9.2 at run time.
- **Research sources**: GitHub release notes (`gh api repos/can1357/oh-my-pi/releases/tags/v18.9.2`) + changelog embedded in the running binary (18.9.2 bundle spans 18.2.2→18.9.2). `~/.omp/agent/last-changelog-version` not used (dialog-gated, stale-prone).
- **Findings**: host-internal release — pi-ai judge renames (`TypeSafeJudge`→`NativeJudge`), coding-agent/tui responsiveness + `apply_patch`/`find`/`gc` fixes, native TSP rendering for Tern-in-tmux, Markdown-highlight and JSON-parse perf passes, Cloudflare Workers AI judge auth.
- **Surface**: **UNCHANGED** — no extension-context member, event, theme, session-JSONL schema, or plugin-loading change. The pi-ai breaking rename does not touch the extension `ctx` surface this plugin consumes. Tern-in-tmux TSP rendering is display-side; the widget's tern stamp env-gating (`TERM_PROGRAM`/`TERM_PROGRAM_VERSION`) is unaffected.
- **Gates**: `pnpm typecheck` ✓; `pnpm test:run` 62/62 ✓ (node v26.10.0).
- **Render sim (formatter-level)**: ✓ all six rows at a pinned instant (prayer, info, zai 5hrs+7DAY, money, versions `omp 18.9.2 · sl 0.8.0 · tern 0.7.2`) plus degradation probes (null omp/sl/tern segments, empty quota windows) — throwaway script mirroring the `test/lines.test.ts` stub-theme pattern.
- **Verdict**: **COMPATIBLE** → docs-only **patch** release 0.8.1 (README versions-row mock refreshed to `omp 18.9.2 · sl 0.8.1 · tern 0.7.2` via the real `versionLine` formatter; no layout change, no memory/schema updates warranted, `src/versions.ts` comment unchanged).
- **Ship**: branch `chore/omp-18.9.2-compat` → PR to main → tag `v0.8.1` (tag push triggers `release.yml`: typecheck → tests → npm publish → GitHub release). Live-level tmux verification runs against the installed 0.8.1 post-publish — omp sessions must restart to load a newly installed version.

## omp 18.9.1 (covered retroactively 2026-10-12)

- **Why**: the plugin's last verified baseline before the 18.9.2 run was 18.9.0-era (v0.8.0 live tests + docs refresh @ dccb2a1), so both 18.9.1 and 18.9.2 were unresearched and the 18.9.2 run initially covered only the target tag. Gap closed by researching the full v18.9.1 release body.
- **Findings**: Bedrock `supportsThinkingBindingControls` plumbing across pi-ai / pi-catalog / pi-coding-agent (`models.yml` compat axis), pi-natives fix for shebang-less executables in the embedded shell, pi-tui fix for inline chart/image overlap artifacts.
- **Surface**: **UNCHANGED** — no extension-context, theme, session-JSONL, or plugin-loading change.
- **Disposition**: no separate release; covered by the 0.8.1 docs-only patch alongside 18.9.2. Hero.svg version row synced to `omp 18.9.2 · sl 0.8.1 · tern 0.7.2` in the same pass.

## omp 18.10.1 (2026-10-12)

- **Target**: omp v18.10.1; running binary (Tern-hosted) already 18.10.1 at run time. Baseline: 18.9.2 (v0.8.1) + v0.8.2 shipped after it (PR #13, advisor-scan fix — no compat research owed, host untouched).
- **Research span**: v18.10.0 + v18.10.1, both sources (GitHub release bodies via `gh api`, changelog embedded in the running 18.10.1 binary — windows agree).
- **Findings**: 18.10.0 — pi-tui **breaking removals** (`RuntimeChildrenOptions.transient`, `Component.retireDisplacedTranscript`, `Composer.pinInputToBottom()`), native IPC transport for local endpoints, ask-dialog hide (`Alt+H`), `omp session pack/unpack/moved` + `omp auth export/import`, codex context-window bump. 18.10.1 — Tern-native UI polish (turn-footer Copy button, compact running counters, picker sheets, extension text editor rendered as a composer sheet), `CountdownTimer.elapsed` native fix.
- **Surface**: **UNCHANGED** — no extension-context member (`ctx.ui.*`, `ctx.models.current().provider`, `ctx.modelRegistry.getApiKeyForProvider`, `ctx.sessionManager.getSessionName`, `ctx.setInterval`), event (`session_start`/`model_select`), theme field (`fg`, `sessionAccentInputs`), or session-JSONL schema change (`src/money.ts` fields untouched). The pi-tui removals are compile-time-unreachable: the plugin has **zero** `@oh-my-pi/*` imports (vendored context types; only a comment names pi-utils). The extension-editor-as-sheet change doesn't apply — the plugin opens no editor, it uses `setWidget`/`setStatus`/`notify` only.
- **Gates**: `pnpm typecheck` ✓; `pnpm test:run` 62/62 ✓, 0 fail.
- **Render sim (formatter-level)**: ✓ all six line families exact-equality-asserted against suite-approved strings (prayer, zai 5hrs/7DAY/over/heat-bands/empty, info, versions ×4 contract shapes, money, paceText, heat edges) + target-shape probe `versionLine({omp:"18.10.1", sl:"0.8.3", tern:…})` — throwaway `/tmp` script mirroring the `test/lines.test.ts` stub-theme pattern.
- **Verdict**: **COMPATIBLE** → docs-only **patch** release 0.8.3 (0.8.2 was the PR #13 fix). Version depictions synced in one pass: README feature-table row + `assets/hero.svg` versions tspan → `omp 18.10.1 · sl 0.8.3 · tern 0.7.2` (README `/sl` sample and `assets/dataflow.svg` carry no numeric version depiction). No layout change; `src/versions.ts` comment unchanged (stamp mechanism untouched in 18.10.x).
- **Ship**: branch `chore/omp-18.10.1-compat` → PR to main → tag `v0.8.3` → CI publish → npm propagation probes → `omp plugin install --force` → live tmux render check (isolated socket).

## omp 18.11.0 (2026-10-15)

- **Target**: omp v18.11.0; running binary (brew) already 18.11.0 at run time. Baseline: 18.10.1 (v0.8.3).
- **Research span**: v18.10.2 + v18.10.3 + v18.10.4 + v18.11.0, both sources (GitHub release bodies via `gh api`, changelog embedded in the running 18.11.0 binary — 18.11.0 body identical, span headers present).
- **Findings**: 18.10.2 — additive only (`onDetachedToolUpdate`, `/tree` branch nav, provider-logo picker marks, new shell builtins). 18.10.3 — breaking removals confined to packages we never import (`estimateImageContentTokens`, `isOfficialCodexApiUrl` moved pi-ai→pi-catalog, snapcompact budget-signature changes, `PROVIDER_IMAGE_BUDGETS`/`FRAME_DATA_BYTES_BUDGET` removed) + usage *value* recounting (#15446/#15447: Claude thinking at billed output size, GPT-5+ o200k — schema unchanged). 18.10.4 — plan-review extension APIs (`openPlanReview`/`resolvePlanReview`), `ApprovalDialogComponent`, `omp gc --compress` (APFS transparent; reads unaffected), dated catalog price cards. 18.11.0 — session entries gain build-stamp fields (#15680), `ApprovalDetailsOptions` removed (added 18.10.4, re-removed), composer-during-approval steering, plugin-install fixes (embedded bun #15480, `/plugins` toggle refresh #15383, marketplace `plugin.json` version precedence #15585), host-served pi-tui subpaths for compiled extensions #15659.
- **Surface**: **UNCHANGED** — no `ctx.ui.setWidget/setStatus/notify`, `ctx.models.current().provider`, `ctx.modelRegistry.getApiKeyForProvider`, `ctx.sessionManager.getSessionName`, `ctx.setInterval`, `session_start`/`model_select`, theme `{fg, sessionAccentInputs}`, or `src/money.ts` JSONL-field change. The #15680 build-stamp fields are additive and `money.ts` typeof-guards skip unknown fields; the 18.10.3 recounting changes recorded usage values, not the schema.
- **Gates**: `pnpm typecheck` ✓; `pnpm test:run` 62/62 ✓, 0 fail.
- **Render sim (formatter-level)**: ✓ all line families exact-equality-asserted against suite-approved strings (zai 5hrs under-pace, prayer, info, versions ×3 contract shapes incl. target probe `versionLine({omp:"18.11.0", sl:"0.8.4"})` + tern variant, money, paceText, heat edges) — throwaway `/tmp` script mirroring the `test/lines.test.ts` stub-theme pattern, run under node v26.10.0.
- **Verdict**: **COMPATIBLE** → docs-only **patch** release 0.8.4. Version depictions synced in one pass: README feature-table row + `assets/hero.svg` versions tspan → `omp 18.11.0 · sl 0.8.4 · tern 0.7.2` (README `/sl` sample and `assets/dataflow.svg` carry no numeric version depiction). No layout change; `src/versions.ts` comment unchanged (#15680 stamps session entries, not the `--version`-spawn mechanism).
- **Ship**: branch `chore/omp-18.11.0-compat` → PR to main → tag `v0.8.4` → CI publish → npm propagation probes → `omp plugin install --force` → live tmux render check (isolated socket).
