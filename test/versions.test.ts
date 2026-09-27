// test/versions.test.ts — clock-line stamp sources: pure semver extraction, the
// omp launch-marker reader (fixture files, no live ~/.omp state), and the plugin's
// own package.json resolver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSemver, readOmpVersionFile, slVersion } from "../src/versions.ts";

test("extractSemver: bare marker, prefixed banner, prerelease+build, garbage", () => {
  assert.equal(extractSemver("18.3.4\n"), "18.3.4");
  assert.equal(extractSemver("omp version 18.3.4 (bun)"), "18.3.4");
  assert.equal(extractSemver("18.3.4-beta.1+abc"), "18.3.4-beta.1+abc");
  assert.equal(extractSemver("no version here"), null);
  assert.equal(extractSemver(""), null);
});

test("readOmpVersionFile: valid marker parses; garbage and missing → null", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-versions-"));
  try {
    const good = join(dir, "good");
    writeFileSync(good, "18.3.4\n");
    assert.equal(readOmpVersionFile(good), "18.3.4");
    const bad = join(dir, "bad");
    writeFileSync(bad, "not-a-version");
    assert.equal(readOmpVersionFile(bad), null);
    assert.equal(readOmpVersionFile(join(dir, "absent")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("slVersion: resolves this package's package.json, matching the manifest version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(slVersion(), pkg.version);
  assert.match(slVersion() ?? "", /^\d+\.\d+\.\d+$/);
});
