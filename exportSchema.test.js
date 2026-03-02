"use strict";

const assert = require("node:assert/strict");
const {
  EXPORT_SCHEMA_NAME,
  EXPORT_SCHEMA_VERSION,
  buildExportPayload,
  buildCsvFromPayload,
  buildPdfHtmlFromPayload,
} = require("./exportSchema");

function sampleInput() {
  const issue = {
    id: 7,
    rule: "custom-img-alt-nonempty",
    title: "IMG alt kontrolü",
    desc: "alt niteliği eksik",
    reason: "Every img must have non-empty alt",
    triggeredCondition: "fail_when: img alt missing",
    severity: "critical",
    status: "FAIL",
    confidence: "high",
    wcag: "1.1.1",
    source: "custom-rule",
    file: "index.html",
    line: 13,
    selector: "img.hero",
    evidence: {
      selector: "img.hero",
      snippet: "<img class=\"hero\" src=\"x.png\">",
      context: { domPath: "html > body > main > img.hero", ancestorSummary: "main | body" },
      pageState: { scenario: "modal-open-state", stepId: "modal.visible" },
      timestamp: "2026-02-28T12:00:00.000Z",
      url: "file:///fixture/index.html",
    },
    dedup: {
      key: "k1",
      groupId: "G00001",
      duplicateCount: 3,
      isGrouped: true,
    },
  };
  return {
    projectName: "demo-project",
    scanDate: "2026-02-28T12:01:00.000Z",
    issues: [issue],
    rawIssues: [issue, { ...issue, id: 8 }],
    dedupStats: { rawCount: 2, uniqueCount: 1, duplicateCount: 1 },
    checklistResults: [{
      id: "Q001",
      wcag: "1.1.1",
      criterion: "Metin Dışı İçerik",
      question: "Soru metni",
      expectedAnswer: "Yes",
      computedAnswer: "No",
      computedOutcome: "FAIL",
      status: "fail",
      confidence: "high",
      rationale: "FAIL bulundu",
      autoOrManual: "auto",
      nextOnNo: "Q003",
      mappedRules: ["custom-img-alt-nonempty"],
      triggeredRuleStatuses: ["FAIL"],
    },
    {
      id: "Q098",
      wcag: "3.2.6",
      criterion: "Tutarlı Yardım",
      question: "Yardım mekanizması tutarlı mı?",
      expectedAnswer: "Yes",
      computedAnswer: "MANUAL",
      computedOutcome: "MANUAL",
      status: "manual",
      confidence: "low",
      rationale: "Manuel doğrulama gerekir.",
      autoOrManual: "manual",
      manualAnswer: "yes",
      manualNote: "Ekranlar arasında aynı yerde kaldı.",
      mappedRules: [],
      triggeredRuleStatuses: [],
    }],
    findingGroups: [{
      groupId: "G00001",
      dedupKey: "k1",
      rule: "custom-img-alt-nonempty",
      file: "index.html",
      selector: "img.hero",
      duplicateCount: 3,
    }],
    mediaCtx: { hasVideo: false, hasAudio: false, hasCaptcha: false, hasCanvas: false },
    reliabilitySummary: {
      ruleCount: 3,
      totalObservations: 42,
      highCount: 1,
      mediumCount: 1,
      lowCount: 1,
      updatedAt: "2026-03-02T18:00:00.000Z",
      lowRules: [],
    },
  };
}

function test_export_payload_schema_and_fields() {
  const payload = buildExportPayload(sampleInput());
  assert.equal(payload.schema.name, EXPORT_SCHEMA_NAME);
  assert.equal(payload.schema.version, EXPORT_SCHEMA_VERSION);
  assert.equal(payload.summary.dedup.uniqueCount, 1);
  assert.equal(payload.summary.dedup.rawCount, 2);
  assert.equal(payload.summary.technicalFindings.bySeverity.critical, 1);
  assert.equal(payload.summary.technicalFindings.byStatus.FAIL, 1);
  assert.equal(payload.technicalFindings.deduplicated[0].evidence.pageState.scenario, "modal-open-state");
  assert.equal(payload.checklist.outcomes[0].id, "Q001");
  assert.equal(payload.checklist.outcomes[0].computedOutcome, "FAIL");
  assert.ok(payload.summary.checklist.quality, "Checklist quality summary should exist");
  assert.equal(typeof payload.summary.checklist.quality.manualCoverageRate, "number");
  assert.equal(payload.summary.reliability.ruleCount, 3);
  console.log("  PASS  test_export_payload_schema_and_fields");
}

function test_csv_contains_version_and_metadata() {
  const payload = buildExportPayload(sampleInput());
  const csv = buildCsvFromPayload(payload);
  assert.ok(csv.includes("SCHEMA_VERSION"));
  assert.ok(csv.includes(EXPORT_SCHEMA_VERSION));
  assert.ok(csv.includes("TECHNICAL_FINDINGS_DEDUP"));
  assert.ok(csv.includes("CHECKLIST_OUTCOMES"));
  assert.ok(csv.includes("modal-open-state"));
  assert.ok(csv.includes("FAIL"));
  assert.ok(csv.includes("manualAnswer"));
  assert.ok(csv.includes("Ekranlar arasında aynı yerde kaldı."));
  assert.ok(csv.includes("RELIABILITY_SUMMARY"));
  console.log("  PASS  test_csv_contains_version_and_metadata");
}

function test_pdf_contains_version_status_confidence() {
  const payload = buildExportPayload(sampleInput());
  const html = buildPdfHtmlFromPayload(payload);
  assert.ok(html.includes(`${EXPORT_SCHEMA_NAME}`));
  assert.ok(html.includes(`v${EXPORT_SCHEMA_VERSION}`));
  assert.ok(html.includes("FAIL"));
  assert.ok(html.includes("high"));
  assert.ok(html.includes("modal-open-state"));
  assert.ok(html.includes("Manual"));
  assert.ok(html.includes("yes"));
  console.log("  PASS  test_pdf_contains_version_status_confidence");
}

function run() {
  console.log("\n=== Export Schema Tests ===\n");
  let passed = 0;
  let failed = 0;

  const tests = [
    test_export_payload_schema_and_fields,
    test_csv_contains_version_and_metadata,
    test_pdf_contains_version_status_confidence,
  ];

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
