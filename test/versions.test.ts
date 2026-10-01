// test/versions.test.ts — clock-line stamp sources: pure semver extraction, the
// omp `--version` output guard, the running-binary spawn (fixture scripts plus
// the test runner's own runtime as the bare-version false positive), and the
// plugin's own package.json resolver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSemver, parseOmpVersionOutput, spawnOmpVersion, slVersion } from "../src/versions.ts";

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
