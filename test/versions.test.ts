// test/versions.test.ts — clock-line stamp sources: pure semver extraction, the
// omp `--version` output guard, the running-binary spawn (fixture scripts plus
// the test runner's own runtime as the bare-version false positive), the
// plugin's own package.json resolver, and the tern env gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSemver, parseOmpVersionOutput, spawnOmpVersion, slVersion, ternVersion, ternVersionSource } from "../src/versions.ts";

test("extractSemver: bare marker, prefixed banner, prerelease+build, garbage", () => {
  assert.equal(extractSemver("18.3.4\n"), "18.3.4");
  assert.equal(extractSemver("omp version 18.3.4 (bun)"), "18.3.4");
  assert.equal(extractSemver("18.3.4-beta.1+abc"), "18.3.4-beta.1+abc");
  assert.equal(extractSemver("no version here"), null);
  assert.equal(extractSemver(""), null);
});

test("parseOmpVersionOutput: omp banners parse; bare runtime versions rejected", () => {
  assert.equal(parseOmpVersionOutput("omp/18.4.8\n"), "18.4.8");
  assert.equal(parseOmpVersionOutput("omp version 18.3.4 (bun)"), "18.3.4");
  assert.equal(parseOmpVersionOutput("omp/1.2.3-beta.1+abc"), "1.2.3-beta.1+abc");
  assert.equal(parseOmpVersionOutput("v22.11.0\n"), null); // node --version shape
  assert.equal(parseOmpVersionOutput("1.2.23\n"), null); // bun --version shape
  assert.equal(parseOmpVersionOutput("no version here"), null);
  assert.equal(parseOmpVersionOutput(""), null);
});

function writeExec(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

test("spawnOmpVersion: omp fixture parses; bare-version fixture rejected; missing binary → null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-versions-"));
  try {
    assert.equal(await spawnOmpVersion(writeExec(dir, "ompish", "#!/bin/sh\necho 'omp/9.9.9'\n")), "9.9.9");
    assert.equal(await spawnOmpVersion(writeExec(dir, "runtime", "#!/bin/sh\necho '22.11.0'\n")), null);
    assert.equal(await spawnOmpVersion(join(dir, "absent")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("spawnOmpVersion(process.execPath) under the test runner → null: node/bun print bare versions, not omp stamps", async () => {
  assert.equal(await spawnOmpVersion(process.execPath), null);
});

test("slVersion: resolves this package's package.json, matching the manifest version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(slVersion(), pkg.version);
  assert.match(slVersion() ?? "", /^\d+\.\d+\.\d+$/);
});

test("ternVersionSource: tern + version parses; junk around the semver tolerated via extractSemver", () => {
  assert.equal(ternVersionSource({ TERM_PROGRAM: "tern", TERM_PROGRAM_VERSION: "0.7.2" }), "0.7.2");
  assert.equal(ternVersionSource({ TERM_PROGRAM: "tern", TERM_PROGRAM_VERSION: "tern 0.10.3" }), "0.10.3");
});

test("ternVersionSource: missing or garbage version under tern → null (segment omitted)", () => {
  assert.equal(ternVersionSource({ TERM_PROGRAM: "tern" }), null);
  assert.equal(ternVersionSource({ TERM_PROGRAM: "tern", TERM_PROGRAM_VERSION: "" }), null);
  assert.equal(ternVersionSource({ TERM_PROGRAM: "tern", TERM_PROGRAM_VERSION: "dev" }), null);
  assert.equal(ternVersionSource({ TERM_PROGRAM: "tern", TERM_PROGRAM_VERSION: "0.7" }), null); // two-component shape
});

test("ternVersionSource: gate is tern-exclusive — other terminals with a version set rejected", () => {
  assert.equal(ternVersionSource({ TERM_PROGRAM: "ghostty", TERM_PROGRAM_VERSION: "1.2.3" }), null);
  assert.equal(ternVersionSource({ TERM_PROGRAM: "tmux", TERM_PROGRAM_VERSION: "3.4.1" }), null);
});

test("ternVersionSource: strict case-sensitive match — 'Tern' is not tern; absent vars → null", () => {
  assert.equal(ternVersionSource({ TERM_PROGRAM: "Tern", TERM_PROGRAM_VERSION: "0.7.2" }), null);
  assert.equal(ternVersionSource({}), null);
});

test("ternVersion: caches the miss process-long — later env changes don't resurrect the segment", () => {
  // First ternVersion() call in this suite: the module cache is guaranteed empty,
  // so a non-Tern env must populate the null cache and hold it (slVersion pattern).
  const savedProgram = process.env.TERM_PROGRAM;
  const savedVersion = process.env.TERM_PROGRAM_VERSION;
  try {
    delete process.env.TERM_PROGRAM;
    delete process.env.TERM_PROGRAM_VERSION;
    assert.equal(ternVersion(), null);
    process.env.TERM_PROGRAM = "tern";
    process.env.TERM_PROGRAM_VERSION = "9.9.9";
    assert.equal(ternVersion(), null); // a ??= cache would recompute here and yield "9.9.9"
  } finally {
    if (savedProgram === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = savedProgram;
    if (savedVersion === undefined) delete process.env.TERM_PROGRAM_VERSION;
    else process.env.TERM_PROGRAM_VERSION = savedVersion;
  }
});

test("ternVersion: fresh module instance applies the gate to the live env and caches its value", async () => {
  const savedProgram = process.env.TERM_PROGRAM;
  const savedVersion = process.env.TERM_PROGRAM_VERSION;
  try {
    process.env.TERM_PROGRAM = "tern";
    process.env.TERM_PROGRAM_VERSION = "9.9.9";
    // Static import cannot work here: it would bind to the SAME module record the
    // suite already imported (ternCache already populated by the miss test above),
    // so only a runtime-selected query-param specifier yields a fresh instance.
    // This is a test intentionally exercising the module-loading boundary.
    const fresh = (await import(`../src/versions.ts?gate-live-${Date.now()}`)) as {
      ternVersion: () => string | null;
    };
    assert.equal(fresh.ternVersion(), "9.9.9");
    process.env.TERM_PROGRAM_VERSION = "8.8.8";
    assert.equal(fresh.ternVersion(), "9.9.9"); // cached process-long
  } finally {
    if (savedProgram === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = savedProgram;
    if (savedVersion === undefined) delete process.env.TERM_PROGRAM_VERSION;
    else process.env.TERM_PROGRAM_VERSION = savedVersion;
  }
});
