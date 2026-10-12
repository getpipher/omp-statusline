---
description: Full omp version compatibility pipeline for the omp-statusline repo — research the target omp release notes, run typecheck + tests, simulate the widget render, update docs, version bump, branch + PR to main, tag to publish via CI, verify npm propagation, omp plugin install + live render proof. Use when bringing omp-statusline up to date with a new omp (oh-my-pi) release.
argument-hint: "v18.9.2"
---

# omp Version Compatibility Update — $ARGUMENTS

Bismillah! Running the full compatibility pipeline for omp $ARGUMENTS.

If no version argument is provided, ask for the target version and stop.

**Scope**: This command operates on `~/local-dev/getpipher/omp-statusline/` (the plugin repo; this file lives in-repo at `.omp/commands/compat-update.md`). Its subject is the omp host, so it references omp paths (`~/.omp/...`) and the `omp` CLI by design. It is not portable to other projects.

**Compat surface** (what a new omp release can break — verified against `src/`): the extension-context members (`ctx.ui.setWidget/setStatus/notify`, `ctx.models.current().provider`, `ctx.modelRegistry.getApiKeyForProvider`, `ctx.sessionManager.getSessionName`, `ctx.setInterval`), the events (`session_start`, `model_select`) plus the registered `sl` command, the per-render theme object (`fg`, `sessionAccentInputs`), and the omp session-JSONL schema read by `src/money.ts` (`type`, `cwd`, `id`, `message.role`, `message.usage.*`, `timestamp`). External APIs (z.ai quota/usage, Aladhan) are not omp-fed — re-check their parsers only if the release touches them.

---

## Phase 1: Research & Check

### Step 1: Validate Version

Parse `$ARGUMENTS` and extract the semver (e.g. `18.9.2`). If the format is invalid, stop and ask.

### Step 2: Research the omp Release

Enumerate EVERY omp release between the plugin's last-verified baseline and the target (`gh api repos/can1357/oh-my-pi/releases --jq '.[].tag_name'`) — a compat run must clear the whole span, not just the target tag; a breaking change in an intermediate release is still breaking (first-run lesson: 18.9.1 sat unresearched between the 18.9.0 baseline and the 18.9.2 target). Research each release's notes with both sources below. If your environment provides sub-agents, fan out per release (and per source); otherwise run them inline:

1. **GitHub release notes (works for any target version)** — run via shell:
   ```bash
   gh api repos/can1357/oh-my-pi/releases/tags/vTARGET --jq .body
   ```
2. **Changelog embedded in the running binary** (covers only versions inside the running binary's own history window):
   ```bash
   strings -n 8 "$(readlink -f "$(which omp)")" | awk '/^## \[TARGET\]/{f=1;next} f&&/^## \[/{exit} f'
   ```

Do NOT use `~/.omp/agent/last-changelog-version` as a source — it is gated behind the startup changelog dialog and goes stale across silent upgrades (see the comment in `src/versions.ts`). omp writes no changelog cache to disk.

Focus on: extension API changes (context members, events, theme object, widget placement), session-JSONL schema changes, plugin loading changes, and anything flagged breaking for extensions/plugins.

Report findings as a table:

| Category | Changes |
|----------|---------|
| Context/event/theme API changes | (list or "none") |
| Session-JSONL schema changes | (list or "none") |
| Breaking changes for extensions | (list or "none") |
| Widget impact | (list or "none") |

### Step 3: Run Gates

From the repo root run `pnpm typecheck && pnpm test:run` and read the pass/fail counts from the spec-reporter summary. Do NOT pipe the suite through `grep`/`head` without `pipefail` — a filtering pipe reports the filter's exit status, not the suite's, and can mask a real failure (first-run lesson: a green typecheck plus a filtered pipe read as ambiguous gates).

### Step 4: Simulate the Render

omp feeds no stdin JSON to this plugin — the widget renders through the extension API. Two simulations:

1. **Formatter-level**: write a throwaway script (do not commit it) that imports the real formatters from `src/index.ts` and renders every line against synthetic inputs, mirroring the stub-theme pattern in `test/lines.test.ts` (`theme.fg` stub that token-annotates, pinned instant, fixture builders). Prefer exact `assert.equal` strings lifted from the suite's approved outputs over prefix/`includes` matches — exact equality is stronger sim evidence; if you use a regex, escape every `/`. Run it the same way the suite runs (node with type stripping, e.g. `node <script>.ts`). If Step 2 found new API members, add probes for them here.
2. **Live-level** (after Step 12's install): fresh omp in a throwaway tmux instance — isolated socket only:
   ```bash
   SOCK=omp-compat-$RANDOM
   tmux -L "$SOCK" new-session -d omp
   # poll (~4 s): tmux -L "$SOCK" capture-pane -p -e
   #   expect the version row to contain: omp TARGET and sl vNEW
   tmux -L "$SOCK" kill-server
   ```
   NEVER run kill-server on the default socket — it kills live sessions.

### Step 5: Compatibility Report

```
====================================================
COMPAT CHECK: omp TARGET
====================================================

Tests:     [PASS] / [TOTAL] ([FAIL] failures)
Render:    [OK / ERROR] (formatter sim; live after install)
Supported: omp [known-good range]
Target:    $ARGUMENTS
Surface:   [UNCHANGED / NEW API MEMBERS / BREAKING]

Verdict:   [COMPATIBLE / NEEDS WORK]
====================================================
```

**If NEEDS WORK**: write the failing test first, implement fixes (new API-member support, schema migration), re-run the gates until green, show what was fixed, then continue. **If COMPATIBLE**: continue to Phase 2.

---

## Phase 2: Update Docs

### Step 6: Update Version References

Per-version detail lives in the in-repo archive file; memory stays tight. **Do not append per-version paragraphs to memory files** — that is what bloated them historically.

1. **README.md**: bump any compatibility/version claims (currently none hardcoded; the Install section is version-agnostic).
2. **Render mocks**: if the layout changed, regenerate the README mock blocks AND `assets/hero.svg` + `assets/dataflow.svg` by **executing the real formatters** at one coherent depicted instant — never hand-compute a mock; every rendered row/tspan line must be reachable via the real code. Any doc-artifact audit must include SVG text, not just markdown. Version depictions live in MULTIPLE sites (README render-mock rows, the README `/sl` sample block, `assets/hero.svg` versions tspan, `assets/dataflow.svg`) — enumerate them all before editing (grep the repo for the old version strings) and sync in ONE pass; half-states recreate the documented README-vs-SVG drift.
3. **docs/COMPATIBILITY.md**: create on first use; append a `## omp TARGET (DATE)` section per run — gate counts, render verification, observed edge cases. In-repo authoritative archive.
4. **Project memory**: bump a one-liner ONLY if the release added schema/API surface or notable correctness fixes. Otherwise no change.
5. **src/versions.ts**: if a version-source mechanism changed (e.g. marker behavior, stamp parsing), update the explanatory comment block there.

---

## Phase 3: Version Bump

### Step 7: Determine Version Bump

Single source: `"version"` in `package.json` (this repo has no `version.txt`). Bump:

- **Patch** (0.8.Z+1): no code changes, docs only
- **Minor** (0.Y+1.0): new features or API/schema support added

Edit `package.json` directly. Do NOT use `pnpm version` — it creates a commit+tag prematurely.

---

## Phase 4: Ship It

### Step 8: Branch & PR to main

This repo is **main-only** — there is no nightly branch (CC-style nightly→main double flow dropped).

```bash
git checkout -b chore/omp-TARGET-compat origin/main
git add <changed files>
git commit -m "feat: omp TARGET compatibility (docs/version update)"
git push -u origin chore/omp-TARGET-compat
gh pr create --base main --title "..." --body "..."
```

Wait for CI (`gh pr checks <PR#> --watch --interval 15` in background). If CI fails, fix and push again.

### Step 9: Merge

```bash
gh pr merge <PR#> --merge --delete-branch   # merge commit, never squash
git checkout main && git pull --ff-only
```

### Step 10: Tag → CI Publish

Pushing the tag replaces both the CC "PR nightly→main" and the manual GitHub-release step — `.github/workflows/release.yml` triggers on `v*` tags: install → typecheck → tests → skip-if-published check → `npm publish --access public` → `gh release create --generate-notes`.

```bash
git tag vNEW && git push origin vNEW
gh run watch   # or gh run list to find the run
```

If the skip-if-published check trips, investigate before re-tagging (the publish step is idempotent by design).

### Step 11: Verify npm Propagation

CI publish success ≠ registry availability. Probe on a ~45 s cadence; NEVER use query-string cache-busters (Fastly ignores them):

```bash
npm view @getpipher/omp-statusline@NEW --prefer-online
# packument: ~3 min observed lag after publish

curl -sI https://registry.npmjs.org/@getpipher/omp-statusline/-/omp-statusline-NEW.tgz
# tarball can 404 minutes after the packument resolves; wait for 200 —
# omp plugin install hard-fails on that 404 while metadata probes look fine
```

### Step 12: Install & Live-Verify

```bash
omp plugin install @getpipher/omp-statusline@NEW --force
omp plugin doctor   # must show NEW; unrelated drift on other plugins is flagged separately
```

Then run the Step 4 **live-level** tmux simulation. Running sessions keep the previously loaded version until restart — verify in the fresh instance only. Optional isolation: `omp --profile <name>` uses a separate plugins dir (fresh profiles re-show omp's setup wizard; Esc-skip it).

---

## Final Report

```
====================================================
OMP COMPAT UPDATE: Complete
====================================================

Target:       omp $ARGUMENTS
Plugin:       sl vOLD → vNEW
Changes:      [docs only / new API members / fixes]
PR (main):    #NNN — merged ✓
Tag/Release:  vNEW (CI: npm publish + gh release ✓)
npm:          packument + tarball verified ✓
Plugin:       omp plugin install --force + doctor ✓
Live render:  fresh tmux instance shows omp TARGET · sl vNEW ✓
====================================================
```

Alhamdulillah!
