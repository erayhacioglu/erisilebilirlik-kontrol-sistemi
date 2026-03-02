"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { scanProject } = require("./scanner");
const REQUIRE_CHROMIUM = process.env.A11Y_REQUIRE_CHROMIUM === "1";

function hasRuntimeDeps() {
  try {
    require("puppeteer");
    require("axe-core");
    return true;
  } catch {
    return false;
  }
}

async function test_runtime_scenarios_modal_dropdown_form_toast() {
  if (!hasRuntimeDeps()) {
    throw new Error("puppeteer/axe-core unavailable");
  }

  const fixtureDir = path.join(__dirname, "fixtures", "runtime-scenarios");
  const logs = [];
  const prevIncremental = process.env.A11Y_INCREMENTAL;
  process.env.A11Y_INCREMENTAL = "0";
  let result;
  try {
    result = await scanProject(
      fixtureDir,
      () => {},
      (message, level) => logs.push({ message: String(message || ""), level: String(level || "info") }),
      () => {},
      new AbortController().signal
    );
  } finally {
    if (prevIncremental == null) delete process.env.A11Y_INCREMENTAL;
    else process.env.A11Y_INCREMENTAL = prevIncremental;
  }
  const findings = result.technicalFindings || result.issues || [];

  const launchUnavailable = logs.some((l) =>
    /Tarayıcı hatası|Failed to launch the browser process|Could not find Chrome|Browser was not found/i.test(l.message)
  );
  if (launchUnavailable) {
    if (REQUIRE_CHROMIUM) {
      throw new Error("Chromium launch unavailable (A11Y_REQUIRE_CHROMIUM=1)");
    }
    // Chromium yoksa fallback: runtime katmanının güvenli şekilde düşüp statik analize devam ettiğini doğrula.
    assert.ok(
      logs.some((l) => /Statik analiz ile devam ediliyor/i.test(l.message)),
      "Expected fallback log when Chromium is unavailable"
    );
    assert.ok(Array.isArray(findings), "scanProject should still return findings array");
    console.log("  PASS  test_runtime_scenarios_modal_dropdown_form_toast (fallback mode)");
    return;
  }

  const fullLog = logs.map((l) => l.message).join("\n");
  const scenarioNames = new Set(
    findings
      .map((f) => (f.pageState && f.pageState.scenario) || (f.evidence && f.evidence.pageState && f.evidence.pageState.scenario))
      .filter(Boolean)
  );

  const scenarios = [
    "modal-open-state",
    "dropdown-expanded-state",
    "form-invalid-state",
    "toast-status-visible-state",
    "focus-order-state",
    "skip-link-activation-state",
    "loading-announcement-state",
    "route-change-state",
  ];

  for (const scenario of scenarios) {
    const hasFinding = scenarioNames.has(scenario);
    const hasFailure = findings.some((f) => f.rule === "runtime-scenario-failure" && (f.desc || "").includes(scenario));
    const hasExecutionLog =
      fullLog.includes(`state=${scenario}`) ||
      fullLog.includes(`Scenario failed: ${scenario}`) ||
      fullLog.includes(`Scenario skipped: ${scenario}`);

    assert.ok(
      hasFinding || hasFailure || hasExecutionLog,
      `${scenario} scenario had no finding, deterministic failure, or execution log`
    );
  }

  const hasAnyRuntimeState =
    scenarioNames.has("initial-load") ||
    scenarioNames.has("modal-open-state") ||
    scenarioNames.has("dropdown-expanded-state") ||
    scenarioNames.has("form-invalid-state") ||
    scenarioNames.has("toast-status-visible-state") ||
    scenarioNames.has("focus-order-state") ||
    scenarioNames.has("skip-link-activation-state") ||
    scenarioNames.has("loading-announcement-state") ||
    scenarioNames.has("route-change-state") ||
    findings.some((f) => f.rule === "runtime-scenario-failure") ||
    fullLog.includes("axe-core taraması:");
  assert.ok(hasAnyRuntimeState, "No runtime scenario state evidence was produced");

  console.log("  PASS  test_runtime_scenarios_modal_dropdown_form_toast");
}

async function run() {
  console.log("\n=== Runtime Scenario Tests ===\n");
  let passed = 0;
  let failed = 0;
  try {
    await test_runtime_scenarios_modal_dropdown_form_toast();
    passed++;
  } catch (err) {
    failed++;
    console.error("  FAIL  test_runtime_scenarios_modal_dropdown_form_toast");
    console.error(`        ${err.message}`);
  }
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Runtime scenario test runner crashed:", err);
  process.exit(1);
});
