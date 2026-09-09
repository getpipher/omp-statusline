// test/zai-key.test.ts — zai key resolution order (v0.4.0): omp credential store
// first, pi-style auth file fallback, explicit authJsonPath pins the file. This is
// the omp-only-user contract — no ~/.pi required for the quota row to live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadLiveConfig, resolveZaiKey, type LiveConfig, type SlCtx } from "../src/index.ts";

const ui = {
  setStatus: () => {},
  setWidget: () => {},
  notify: () => {},
};
function ctxWithRegistry(key: string | null | undefined, calls: string[] = []): SlCtx {
  return {
    ui,
    modelRegistry: {
      getApiKeyForProvider: (provider: string) => {
        calls.push(provider);
        if (key === null) return Promise.reject(new Error("registry unavailable"));
        return Promise.resolve(key);
      },
    },
  };
}

function tmpAuthFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "osl-key-"));
  const file = join(dir, "auth.json");
  writeFileSync(file, body);
  return file;
}

const unconfigured: LiveConfig = {
  zaiPollMs: 180_000,
  authJsonPath: null,
  accent: true,
  deen: { city: "Jakarta", country: "Indonesia", method: "auto", escalateMinutes: 30 },
};

test("loadLiveConfig: authJsonPath null unless explicitly a non-empty string", () => {
  const dir = mkdtempSync(join(tmpdir(), "osl-cfg-"));
  const absent = join(dir, "absent.json");
  assert.equal(loadLiveConfig(absent).authJsonPath, null); // unreadable → default

  const configured = join(dir, "configured.json");
  writeFileSync(configured, JSON.stringify({ zai: { authJsonPath: "/custom/auth.json" } }));
  assert.equal(loadLiveConfig(configured).authJsonPath, "/custom/auth.json");

  const badType = join(dir, "bad.json");
  writeFileSync(badType, JSON.stringify({ zai: { authJsonPath: 42 } }));
  assert.equal(loadLiveConfig(badType).authJsonPath, null);

  const empty = join(dir, "empty.json");
  writeFileSync(empty, JSON.stringify({ zai: { authJsonPath: "" } }));
  assert.equal(loadLiveConfig(empty).authJsonPath, null);
});

test("resolveZaiKey: credential store wins when unconfigured (omp-only user)", async () => {
  const calls: string[] = [];
  const fallback = tmpAuthFile(JSON.stringify({ zai: { key: "file-key" } }));
  const resolved = await resolveZaiKey(ctxWithRegistry("store-key", calls), unconfigured, fallback);
  assert.deepEqual(resolved, { key: "store-key", source: "omp credentials" });
  assert.deepEqual(calls, ["zai"]); // asked the host, never touched the file
});

test("resolveZaiKey: file fallback when registry misses, rejects, or ctx lacks it", async () => {
  const fallback = tmpAuthFile(JSON.stringify({ zai: { key: "file-key" } }));
  for (const ctx of [ctxWithRegistry(null), ctxWithRegistry(undefined), ctxWithRegistry(""), { ui }]) {
    const resolved = await resolveZaiKey(ctx, unconfigured, fallback);
    assert.deepEqual(resolved, { key: "file-key", source: fallback });
  }
  // and no file either → inert, not an error
  assert.equal(await resolveZaiKey({ ui }, unconfigured, join(tmpdir(), "osl-no-such-auth.json")), null);
});

test("resolveZaiKey: explicit authJsonPath pins the file — registry never consulted", async () => {
  const calls: string[] = [];
  const pinned = tmpAuthFile(JSON.stringify({ zai: { key: "pinned-key" } }));
  const cfg: LiveConfig = { ...unconfigured, authJsonPath: pinned };
  const resolved = await resolveZaiKey(ctxWithRegistry("store-key", calls), cfg, "/never/read.json");
  assert.deepEqual(resolved, { key: "pinned-key", source: pinned });
  assert.deepEqual(calls, []); // explicit intent beats the credential store
  // pinned path with no key there → null (no silent fallback to the store)
  const deadPin = join(pinned, "..", "nope.json");
  assert.equal(await resolveZaiKey(ctxWithRegistry("store-key", calls), { ...unconfigured, authJsonPath: deadPin }), null);
  assert.deepEqual(calls, []);
});
