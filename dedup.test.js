"use strict";

const assert = require("node:assert/strict");
const { buildDedupKey, dedupeFindings } = require("./dedup");

function fixtureFindings() {
  return [
    {
      rule: "custom-img-alt-nonempty",
      file: "src/a.html",
      selector: "IMG.hero:nth-child(1)",
      reason: "alt niteliği eksik",
      status: "FAIL",
    },
    {
      rule: "custom-img-alt-nonempty",
      file: "src\\a.html",
      selector: " img.hero :nth-child(2) ",
      reason: "  alt   niteliği   eksik ",
      status: "FAIL",
    },
    {
      rule: "custom-img-alt-nonempty",
      file: "src/a.html",
      selector: "img.logo",
      reason: "alt boş (empty alt FAIL)",
      status: "FAIL",
    },
    {
      rule: "custom-html-lang-tr",
      file: "index.html",
      selector: "html",
      reason: "Geçersiz/missing lang: en",
      status: "FAIL",
    },
    {
      rule: "custom-html-lang-tr",
      file: "index.html",
      selector: "html",
      reason: "Geçersiz/missing lang: tr-tr",
      status: "FAIL",
    },
  ];
}

function test_normalized_key_stability() {
  const a = fixtureFindings()[0];
  const b = fixtureFindings()[1];
  const keyA = buildDedupKey(a);
  const keyB = buildDedupKey(b);
  assert.equal(keyA, keyB, "Equivalent findings should produce same dedup key");
  console.log("  PASS  test_normalized_key_stability");
}

function test_reproducible_unique_counts() {
  const r1 = dedupeFindings(fixtureFindings());
  const r2 = dedupeFindings(fixtureFindings());
  assert.equal(r1.stats.rawCount, 5);
  assert.equal(r1.stats.uniqueCount, 4);
  assert.equal(r1.stats.duplicateCount, 1);
  assert.deepEqual(
    r1.uniqueFindings.map((f) => f.dedup.key),
    r2.uniqueFindings.map((f) => f.dedup.key),
    "Unique keys should be reproducible for same fixture"
  );
  console.log("  PASS  test_reproducible_unique_counts");
}

function run() {
  console.log("\n=== Dedup Tests ===\n");
  let passed = 0;
  let failed = 0;
  const tests = [test_normalized_key_stability, test_reproducible_unique_counts];
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
