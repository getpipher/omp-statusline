// test/zai-extra.test.ts — dashboard-endpoint parsers: envelope checks, string
// numbers, per-model totals, fail-soft shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsageDetail, parseActivity } from "../src/quota/zai-extra.ts";

test("parseUsageDetail: summary + per-model totals sorted desc", () => {
  const body = JSON.stringify({
    code: 200,
    msg: "Operation successful",
    data: {
      granularity: "DAY",
      summary: {
        cacheHitRate: { value: "0.9624", trend: "0.0109" },
        totalCredits: { value: "265655.0232", trend: "0.4680" },
      },
      modelUsage: {
        totalUsage: { totalTokens: 2651384305, totalCredits: "165763.8707" },
        modelDataList: [
          { modelCode: "glm-5.3-flash", modelName: "GLM-5.3-Flash", sortOrder: 2, totalCreditsUsage: ["12296.4928", "14454.1673"] },
          { modelCode: "glm-5.3", modelName: "GLM-5.3", sortOrder: 1, totalCreditsUsage: ["51800.5265", "1459.2116"] },
          { modelCode: "glm-4.5v", modelName: "GLM-4.5V", sortOrder: 3, totalCreditsUsage: ["0.0000", "2.1985"] },
        ],
      },
    },
  });
  const parsed = parseUsageDetail(body);
  assert.ok(parsed);
  assert.equal(parsed.todayCredits, 265655.0232);
  assert.equal(parsed.cacheHitRate, 0.9624);
  assert.deepEqual(parsed.models, [
    { name: "GLM-5.3", credits: 53259.7381 },
    { name: "GLM-5.3-Flash", credits: 26750.6601 },
    { name: "GLM-4.5V", credits: 2.1985 },
  ]);
});

test("parseUsageDetail: non-200 and malformed json → null; empty summary degrades to nulls", () => {
  assert.equal(parseUsageDetail('{"code":401,"msg":"nope"}'), null);
  assert.equal(parseUsageDetail("{ not json"), null);
  const empty = parseUsageDetail('{"code":200,"data":{"summary":{}}}');
  assert.deepEqual(empty, { todayCredits: null, cacheHitRate: null, models: [] });
});

test("parseUsageDetail: partial summary degrades per-field, never throws", () => {
  const parsed = parseUsageDetail('{"code":200,"data":{"summary":{"totalCredits":{"value":"11614.3040"}}}}');
  assert.ok(parsed);
  assert.equal(parsed.todayCredits, 11614.304);
  assert.equal(parsed.cacheHitRate, null);
  assert.deepEqual(parsed.models, []);
});

test("parseActivity: streak fields; empty summary → null fields, bad envelope → null", () => {
  const ok = parseActivity(JSON.stringify({ code: 200, data: { summary: { currentStreakDays: 6, longestStreakDays: 8 } } }));
  assert.deepEqual(ok, { streakDays: 6, longestStreakDays: 8 });
  assert.equal(parseActivity('{"code":500}'), null);
  assert.deepEqual(parseActivity('{"code":200,"data":{"summary":{}}}'), { streakDays: null, longestStreakDays: null });
});
