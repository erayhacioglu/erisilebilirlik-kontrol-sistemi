"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const {
  createEmptyStore,
  updateReliabilityStore,
  adaptFindingsByReliability,
  loadReliabilityStore,
  saveReliabilityStore,
  buildReliabilitySummary,
} = require("./reliability");

function test_update_store_and_summary() {
  let store = createEmptyStore();
  store = updateReliabilityStore(store, [
    { rule: "focus-outline-removed", status: "WARNING", source: "static", severity: "warning" },
    { rule: "focus-outline-removed", status: "WARNING", source: "static", severity: "warning" },
    { rule: "skip-link-missing", status: "FAIL", source: "static", severity: "critical" },
  ]);
  const summary = buildReliabilitySummary(store, 5);
  assert.equal(summary.ruleCount, 2);
  assert.ok(summary.totalObservations >= 3);
  assert.ok(Array.isArray(summary.lowRules));
}

function test_adaptation_softens_low_reliability_warnings() {
  let store = createEmptyStore();
  store.rules["focus-outline-removed"] = {
    total: 20, fail: 0, warning: 20, pass: 0, manual: 0, na: 0,
    scansSeen: 4, lastSeenAt: new Date().toISOString(),
    reliabilityScore: 0.1, reliabilityBucket: "low",
  };
  const inFindings = [
    { rule: "focus-outline-removed", status: "WARNING", severity: "warning", source: "static", confidence: "medium" },
  ];
  const { adaptedFindings, stats } = adaptFindingsByReliability(inFindings, store);
  assert.equal(adaptedFindings[0].severity, "review");
  assert.equal(adaptedFindings[0].confidence, "low");
  assert.equal(adaptedFindings[0].reliabilityAdjusted, true);
  assert.ok(stats.adaptedCount >= 1);
}

function test_store_load_save_roundtrip() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-rel-"));
  const fp = path.join(tmpDir, "reliability.json");
  const store = createEmptyStore();
  store.rules["x-rule"] = {
    total: 1, fail: 1, warning: 0, pass: 0, manual: 0, na: 0,
    scansSeen: 1, lastSeenAt: new Date().toISOString(),
    reliabilityScore: 0.8, reliabilityBucket: "high",
  };
  saveReliabilityStore(fp, store);
  const loaded = loadReliabilityStore(fp);
  assert.equal(loaded.rules["x-rule"].fail, 1);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function run() {
  test_update_store_and_summary();
  test_adaptation_softens_low_reliability_warnings();
  test_store_load_save_roundtrip();
  console.log("reliability.test.js OK");
}

run();
