// src/versions.ts — clock-line version stamp sources (v0.6.2). Both resolved once
// per process and cached: the stamp describes the RUNNING omp + the INSTALLED sl,
// neither of which changes while the session lives.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// omp rewrites this marker on every launch — it tracks the running version without
// spawning anything. NOT createRequire("@oh-my-pi/..."): omp ships as a single
// bundled binary, so no host package.json is resolvable from inside the plugin.
const LAST_CHANGELOG = join(homedir(), ".omp", "agent", "last-changelog-version");

const SEMVER_RE = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?/;

// Pure extraction: "18.3.4\n" → "18.3.4"; "omp version 18.3.4 (bun)" → "18.3.4";
// anything without a bare x.y.z token → null.
export function extractSemver(text: string): string | null {
  return SEMVER_RE.exec(text.trim())?.[0] ?? null;
}

// Primary source: the launch marker file. Missing/garbled → null (caller falls
// back to spawning `omp --version`).
export function readOmpVersionFile(path: string = LAST_CHANGELOG): string | null {
  try {
    return extractSemver(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function spawnOmpVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileP("omp", ["--version"], { timeout: 5_000 });
    return extractSemver(stdout);
  } catch {
    return null;
  }
}

let ompCache: Promise<string | null> | undefined;

// File first (no process spawn); `omp --version` fallback, cached process-long so
// the fallback fires at most once even across sessions in the same process.
export function ompVersion(): Promise<string | null> {
  ompCache ??= (async () => readOmpVersionFile() ?? await spawnOmpVersion())();
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
