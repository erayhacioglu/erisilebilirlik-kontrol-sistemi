"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyRuleContractToFinding } = require("./ruleContracts");

function loadFixture(name) {
  const p = path.join(__dirname, "fixtures", "rule-classifier", `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function test_classifier_pass() {
  const finding = loadFixture("pass");
  const out = applyRuleContractToFinding(finding);
  assert.equal(out.status, "PASS");
  assert.equal(out.triggeredCondition, "pass_when");
  assert.equal(out.confidence, "high");
  assert.ok(out.reason.length > 0);
  assert.ok(out.ruleContract && out.ruleContract.pass_when);
  console.log("  PASS  test_classifier_pass");
}

function test_classifier_fail() {
  const finding = loadFixture("fail");
  const out = applyRuleContractToFinding(finding);
  assert.equal(out.status, "FAIL");
  assert.equal(out.triggeredCondition, "fail_when");
  assert.ok(out.reason.length > 0);
  console.log("  PASS  test_classifier_fail");
}

function test_classifier_warning() {
  const finding = loadFixture("warning");
  const out = applyRuleContractToFinding(finding);
  assert.equal(out.status, "WARNING");
  assert.equal(out.triggeredCondition, "warning_when");
  console.log("  PASS  test_classifier_warning");
}

function test_classifier_manual_and_na() {
  const manualOut = applyRuleContractToFinding({
    rule: "some-rule-review",
    source: "axe-core",
    severity: "review",
    desc: "incomplete",
  });
  assert.equal(manualOut.status, "MANUAL");
  assert.equal(manualOut.triggeredCondition, "manual_when");

  const naOut = applyRuleContractToFinding({
    rule: "x",
    source: "custom-rule",
    status: "N/A",
    desc: "not applicable",
  });
  assert.equal(naOut.status, "N/A");
  assert.equal(naOut.triggeredCondition, "not_applicable_when");
  console.log("  PASS  test_classifier_manual_and_na");
}

function run() {
  console.log("\n=== Rule Contract Tests ===\n");
  const tests = [
    test_classifier_pass,
    test_classifier_fail,
    test_classifier_warning,
    test_classifier_manual_and_na,
  ];
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      passed++;
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${t.name}`);
      console.error(`        ${err.message}`);
    }
  }
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
