// test/money.test.ts — scanMoney contract: window math, dedupe, repo attribution,
// subagent artifacts, malformed-input tolerance. Fixture tree in a tmpdir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanMoney } from "../src/money.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;

function fixture(root: string, dir: string, file: string, cwd: string | null, entries: Array<{ id: string; ts: number; cost: number }>): void {
  const path = join(root, dir);
  mkdirSync(path, { recursive: true });
  const lines: string[] = [];
  if (cwd) lines.push(JSON.stringify({ type: "session", version: 3, id: "s", cwd }));
  lines.push("{ this line is malformed json on purpose");
  lines.push(JSON.stringify({ type: "message", id: "noise", message: { role: "user", usage: { cost: { total: 99 } } } }));
  lines.push(JSON.stringify({ type: "message", id: "no-usage", message: { role: "assistant", content: [] } }));
  for (const e of entries) {
    lines.push(JSON.stringify({
      type: "message",
      id: e.id,
      timestamp: new Date(e.ts).toISOString(),
      message: { role: "assistant", usage: { input: 1, output: 1, cost: { total: e.cost } } },
    }));
  }
  writeFileSync(join(path, file), lines.join("\n") + "\n");
}

test("scanMoney: windows, dedupe, repo attribution, subagent share", () => {
  const now = Date.now();
  const hourFloor = now - (now % HOUR);
  const root = mkdtempSync(join(tmpdir(), "osl-money-"));
  try {
    // Noon today: inside the calendar-DAY window at any run time (the old
    // `now - 60_000` broke when the suite ran just after midnight).
    const todayA = new Date(now).setHours(12, 0, 0, 0);
    const yesterday = now - 25 * HOUR;    // always outside DAY
    const weekEdgeIn = hourFloor - 7 * DAY;      // inclusive boundary
    const weekEdgeOut = hourFloor - 7 * DAY - 1; // 1ms older → week no, month yes
    const monthOut = hourFloor - 30 * DAY - 1;   // outside every window

    // repoA main session (and a branch copy sharing the same entry ids)
    const repoA: Array<{ id: string; ts: number; cost: number }> = [
      { id: "e1", ts: todayA, cost: 1 },
      { id: "e2", ts: yesterday, cost: 2 },
      { id: "e5", ts: weekEdgeIn, cost: 5 },
      { id: "e6", ts: weekEdgeOut, cost: 0.25 },
      { id: "e7", ts: monthOut, cost: 5 }, // REPO-only: all-time per repo
    ];
    fixture(root, "slugA", "sess1.jsonl", "/home/u/repoA", repoA);
    fixture(root, "slugA", "sess1-branch.jsonl", "/home/u/repoA", repoA); // duplicate ids
    fixture(root, "slugA/sessdir", "Scout.jsonl", "/home/u/repoA", [{ id: "e3", ts: todayA + HOUR, cost: 0.5 }]); // subagent artifact, one level deeper

    // repoB session: windows yes, repoA attribution no
    fixture(root, "slugB", "sess2.jsonl", "/home/u/repoB", [{ id: "e4", ts: todayA, cost: 10 }]);

    // no session header → repo "unknown", never counted toward a named repo
    fixture(root, "slugC", "sess3.jsonl", null, [{ id: "e8", ts: todayA, cost: 100 }]);
    // DAY: today's entries from every repo incl. subagent (e1, e3, e4, e8) — yesterday excluded
    const snap = scanMoney("repoA", now, root);
    // REPO: e1+e2+e5+e6+e7 (+subagent e3) — duplicates counted once, other repos excluded
    assert.equal(snap.repo, 1 + 2 + 5 + 0.25 + 5 + 0.5);
    // DAY: today's entries from every repo (e1, e4, e8) — yesterday excluded
    assert.equal(snap.day, 1 + 0.5 + 10 + 100);
    // WEEK (hourFloor − 7d, inclusive): e1,e3,e4,e8 + e2(yesterday) + e5(edge)
    // e6 is 1ms past the edge; e7 far out
    assert.equal(snap.week, 1 + 0.5 + 10 + 100 + 2 + 5);
    // MONTH (hourFloor − 30d): week + e6
    assert.equal(snap.month, 1 + 0.5 + 10 + 100 + 2 + 5 + 0.25);
    // subagent share over the 30d window
    assert.equal(snap.sub, 0.5);
    // unique entries: 8 ids (branch copy deduped, noise/no-usage/malformed skipped)
    assert.equal(snap.entries, 8);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanMoney: missing sessions root → zero snapshot, no throw", () => {
  const snap = scanMoney("repoA", Date.now(), join(tmpdir(), "osl-does-not-exist"));
  assert.deepEqual(snap, { repo: 0, day: 0, week: 0, month: 0, sub: 0, entries: 0, repoTok: 0, dayTok: 0, weekTok: 0, monthTok: 0 });
});

test("scanMoney: unknown current repo never aggregates others", () => {
  const now = Date.now();
  const root = mkdtempSync(join(tmpdir(), "osl-money-"));
  try {
    fixture(root, "slugA", "sess1.jsonl", "/home/u/repoA", [{ id: "x", ts: now - 60_000, cost: 3 }]);
    const snap = scanMoney("unknown", now, root);
    assert.equal(snap.repo, 0); // "unknown" current repo → repoCost stays 0
    assert.equal(snap.day, 3); // windows are repo-agnostic
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
