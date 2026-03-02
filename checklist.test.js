"use strict";

const assert = require("node:assert/strict");
const {
  CHECKLIST,
  QUESTION_RULE_MAPPING,
  buildChecklistResults,
  validateOfficialChecklistSchema,
} = require("./checklist");

function getById(arr, id) {
  return arr.find((x) => x.id === id);
}

function test_has_122_questions() {
  assert.equal(CHECKLIST.length, 122, `Expected 122 questions, got ${CHECKLIST.length}`);
  assert.equal(Object.keys(QUESTION_RULE_MAPPING).length, 122, "Mapping table must contain 122 entries");
  console.log("  PASS  test_has_122_questions");
}

function test_official_schema_integrity() {
  const result = validateOfficialChecklistSchema(CHECKLIST);
  assert.equal(result.valid, true, `Checklist resmi şeması geçersiz: ${result.errors.join(" | ")}`);
  console.log("  PASS  test_official_schema_integrity");
}

function test_star_logic_double_star_expected_no() {
  const target = CHECKLIST.find((q) => q.star === "**" && q.auto === true && !q.trigger);
  assert.ok(target, "Need at least one auto ** question");

  const result = buildChecklistResults([], {});
  const evaluated = getById(result, target.id);
  assert.ok(evaluated, "Question result missing");
  assert.equal(evaluated.expectedAnswer, "No", "Double-star question should expect No");
  assert.equal(evaluated.computedAnswer, "No", "Without findings, ** question should compute No");
  assert.equal(evaluated.computedOutcome, "PASS", "Without findings, compliance should PASS");
  assert.equal(evaluated.status, "pass");
  console.log("  PASS  test_star_logic_double_star_expected_no");
}

function test_branching_no_jump_marks_intermediate_na() {
  const branchQ = CHECKLIST.find((q) => q.nextOnNo && q.auto === true && q.expectedAnswer === "Yes");
  assert.ok(branchQ, "Need at least one auto branching question with expected Yes");

  const mappedRule = (branchQ.mappedRules || [])[0];
  assert.ok(mappedRule, "Branch question must have mapped rule");

  // Force computedAnswer=No by injecting a FAIL finding on mapped rule.
  const technicalFindings = [{
    rule: mappedRule,
    status: "FAIL",
    confidence: "high",
    source: "static",
  }];

  const result = buildChecklistResults(technicalFindings, {
    hasVideo: true, hasAudio: true, hasCaptcha: true, hasCanvas: true,
  });

  const q = getById(result, branchQ.id);
  assert.equal(q.computedAnswer, "No", "Branching source question should evaluate to No");

  const fromIdx = CHECKLIST.findIndex((x) => x.id === branchQ.id);
  const toIdx = CHECKLIST.findIndex((x) => x.id === branchQ.nextOnNo);
  assert.ok(toIdx > fromIdx + 1, "Need at least one intermediate question to test branching");

  for (let i = fromIdx + 1; i < toIdx; i++) {
    const inter = getById(result, CHECKLIST[i].id);
    assert.equal(inter.computedOutcome, "N/A", `Intermediate question ${inter.id} should be N/A`);
    assert.equal(inter.status, "na", `Intermediate question ${inter.id} should be na`);
    assert.equal(inter.branchSkippedBy, branchQ.id, `Intermediate question ${inter.id} should record branch source`);
  }

  console.log("  PASS  test_branching_no_jump_marks_intermediate_na");
}

function run() {
  console.log("\n=== Checklist Engine Tests ===\n");
  const tests = [
    test_has_122_questions,
    test_official_schema_integrity,
    test_star_logic_double_star_expected_no,
    test_branching_no_jump_marks_intermediate_na,
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
