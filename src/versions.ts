// src/versions.ts — clock-line version stamp sources. Both resolved once per
// process and cached: the stamp describes the RUNNING omp + the INSTALLED sl,
// neither of which changes while the session lives.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const SEMVER_RE = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?/;

// Pure extraction: "18.3.4\n" → "18.3.4"; "omp version 18.3.4 (bun)" → "18.3.4";
// anything without a bare x.y.z token → null.
export function extractSemver(text: string): string | null {
  return SEMVER_RE.exec(text.trim())?.[0] ?? null;
}

// Guard over `--version` output: omp prints "omp/18.4.8" (legacy: "omp version …").
// A bare "22.11.0" — what `node --version`/`bun --version` print when execPath
// points at a plain runtime instead of omp (source/dev runs) — must NOT become
// the omp stamp, so anything without the omp prefix is rejected.
export function parseOmpVersionOutput(text: string): string | null {
  const t = text.trim();
  return /^omp[/ ]/.test(t) ? extractSemver(t) : null;
}

// Primary (and only) source: spawn THE RUNNING BINARY. Inside the plugin,
// process.execPath is whatever binary actually launched omp — brew Cellar path,
// npm-global bin, curl-installed ~/.omp/bin, asdf shim target, source build — so
// the answer is install-agnostic and stays correct for sessions resumed across
// an upgrade, where spawning PATH `omp` would report the NEW binary. Spawn
// failure (e.g. brew cleanup deleted the old Cellar mid-session) → null: the
// stamp segment is omitted upstream, never rendered as a placeholder lie.
// (v0.6.2 read ~/.omp/agent/last-changelog-version first instead — proven wrong
// in the field: omp only writes that marker when its config-gated startup
// changelog actually displays, so it goes stale across silent upgrades and is
// global state shared by every session, old and new.)
export async function spawnOmpVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP(bin, ["--version"], { timeout: 5_000 });
    return parseOmpVersionOutput(stdout);
  } catch {
    return null;
  }
}

let ompCache: Promise<string | null> | undefined;

// Running-binary spawn, cached process-long so it fires at most once per
// process even across sessions in the same process.
export function ompVersion(): Promise<string | null> {
  ompCache ??= spawnOmpVersion(process.execPath);
  return ompCache;
}

let slCache: string | null | undefined;

// This plugin's own package.json, resolved relative to this module — works both in
// the repo and under ~/.omp/plugins/node_modules/@getpipher/omp-statusline/.
export function slVersion(): string | null {
  if (slCache !== undefined) return slCache;
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    slCache = typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : null;
  } catch {
    slCache = null;
  }
  return slCache;
}
