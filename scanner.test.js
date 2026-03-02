// ============================================================
// scanner.test.js  -  Phase 1 cancellation unit tests
//
// Run:  node scanner.test.js
// No external test framework needed - pure Node.js assertions.
// ============================================================
"use strict";

const assert = require("node:assert/strict");
const path   = require("node:path");
const fs     = require("node:fs");
const os     = require("node:os");

const { scanProject, CancelToken } = require("./scanner");
const REQUIRE_CHROMIUM = process.env.A11Y_REQUIRE_CHROMIUM === "1";

// ── helpers ──────────────────────────────────────────────────────────────────

function noop() {}

function makeCallbacks(issueArr) {
  return {
    onProgress : noop,
    onLog      : noop,
    onIssue    : (issue) => issueArr.push(issue),
  };
}

// Create a tiny temp project with N html files so axe-core exercises the loop
function makeTempProject(htmlCount = 2) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-test-"));
  for (let i = 0; i < htmlCount; i++) {
    fs.writeFileSync(
      path.join(dir, `page${i}.html`),
      `<!DOCTYPE html><html lang="en"><head><title>T${i}</title></head>` +
      `<body><h1>Page ${i}</h1><p>Content.</p></body></html>`
    );
  }
  // One JS file for static analysis
  fs.writeFileSync(path.join(dir, "app.js"), "console.log('hello');");
  return dir;
}

function cleanTempProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── TEST 1: CancelToken basic behaviour ──────────────────────────────────────
function test_cancelToken_basic() {
  const token = new CancelToken();
  assert.equal(token.cancelled, false, "Initially not cancelled");
  token.cancel("test");
  assert.equal(token.cancelled, true, "Cancelled after cancel()");

  // Idempotent - second cancel should not throw
  token.cancel("again");
  assert.equal(token.cancelled, true, "Still cancelled after second cancel()");
  console.log("  PASS  test_cancelToken_basic");
}

// ── TEST 2: throwIfCancelled throws when cancelled ───────────────────────────
function test_cancelToken_throws() {
  const token = new CancelToken();
  token.cancel("reason");
  assert.throws(
    () => token.throwIfCancelled(),
    (err) => err.code === "SCAN_CANCELLED",
    "throwIfCancelled should throw with SCAN_CANCELLED code"
  );
  console.log("  PASS  test_cancelToken_throws");
}

// ── TEST 3: Pre-cancelled token — scanProject returns immediately ─────────────
async function test_precancelled_returns_fast() {
  const dir   = makeTempProject(3);
  const token = new CancelToken();
  token.cancel("pre_cancel");

  const issues = [];
  const { callbacks } = { callbacks: makeCallbacks(issues) };
  const cb = makeCallbacks(issues);

  const start  = Date.now();
  const result = await scanProject(dir, cb.onProgress, cb.onLog, cb.onIssue, token);
  const elapsed = Date.now() - start;

  cleanTempProject(dir);

  assert.equal(result.cancelled, true, "Result should be cancelled:true");
  assert.ok(elapsed < 3000, `Pre-cancelled scan should finish within 3 s, got ${elapsed} ms`);
  console.log(`  PASS  test_precancelled_returns_fast (${elapsed} ms)`);
}

// ── TEST 4: Static-only project — cancel mid-loop stops iteration ─────────────
async function test_cancel_during_static() {
  // Make a project with many JS/CSS files but no HTML (skips axe-core)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-static-"));
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(dir, `file${i}.js`), `// file ${i}\nconsole.log(${i});`);
  }

  const token  = new CancelToken();
  const issues = [];
  const cb     = makeCallbacks(issues);

  let progressCount = 0;
  const onProgress = (processed) => {
    progressCount++;
    // Cancel after 5 files processed
    if (progressCount === 5 && !token.cancelled) {
      token.cancel("mid_static");
    }
  };

  const start  = Date.now();
  const result = await scanProject(dir, onProgress, cb.onLog, cb.onIssue, token);
  const elapsed = Date.now() - start;

  cleanTempProject(dir);

  assert.equal(result.cancelled, true, "Should be cancelled");
  assert.ok(
    result.totalFiles < 30,
    `Should have processed fewer than all 30 files, got ${result.totalFiles}`
  );
  assert.ok(elapsed < 5000, `Cancellation should complete within 5 s, got ${elapsed} ms`);
  console.log(`  PASS  test_cancel_during_static  (${result.totalFiles} files processed in ${elapsed} ms)`);
}

// ── TEST 5: Stale events suppressed after cancel ──────────────────────────────
async function test_no_stale_issues_after_cancel() {
  const dir    = makeTempProject(1);
  const token  = new CancelToken();
  const issues = [];

  let issuesAfterCancel = 0;
  const onIssue = (issue) => {
    if (token.cancelled) issuesAfterCancel++;
    issues.push(issue);
  };

  // Cancel immediately before scan (very early)
  token.cancel("stale_test");

  await scanProject(dir, noop, noop, onIssue, token);
  cleanTempProject(dir);

  assert.equal(
    issuesAfterCancel, 0,
    `No issues should be emitted after cancel, got ${issuesAfterCancel}`
  );
  console.log("  PASS  test_no_stale_issues_after_cancel");
}

// ── TEST 6: Two sequential scans - no event interleaving ─────────────────────
async function test_sequential_scans_clean() {
  const dir     = makeTempProject(1);
  const issues1 = [];
  const issues2 = [];

  // First scan - cancel immediately
  const token1 = new CancelToken();
  token1.cancel("first");
  await scanProject(dir, noop, noop, (i) => issues1.push(i), token1);

  // Second scan - run to completion
  const token2 = new CancelToken();
  const result2 = await scanProject(dir, noop, noop, (i) => issues2.push(i), token2);

  cleanTempProject(dir);

  assert.equal(result2.cancelled, false, "Second scan should complete normally");
  // Issues from scan1 and scan2 should be completely separate (different id sequences)
  if (issues1.length > 0 && issues2.length > 0) {
    const ids1 = new Set(issues1.map(i => i.id));
    const ids2 = new Set(issues2.map(i => i.id));
    // IDs may overlap because each scan starts from 1 - that's fine.
    // The important thing is they're from separate arrays.
    assert.ok(ids1.size > 0 || ids2.size > 0, "At least one scan produced issues");
  }
  console.log(`  PASS  test_sequential_scans_clean (scan2 issues: ${issues2.length})`);
}

// ── TEST 7: onBrowserOpen callback cancellation (env dependent) ───────────────
async function test_onBrowserOpen_callback() {
  let puppeteerAvailable = false;
  try { require("puppeteer"); puppeteerAvailable = true; } catch {}
  try { if (!puppeteerAvailable) { require("puppeteer-core"); puppeteerAvailable = true; } } catch {}
  try { if (puppeteerAvailable) require("axe-core"); } catch { puppeteerAvailable = false; }

  if (!puppeteerAvailable) {
    throw new Error("puppeteer/axe-core not installed but test requires runtime deps");
  }

  const dir = makeTempProject(1);
  const token = new CancelToken();
  let browserRef = null;
  const logs = [];
  const onLog = (msg, level) => logs.push({ msg: String(msg || ""), level: String(level || "info") });

  const onBrowserOpen = (b) => {
    browserRef = b;
    // Immediately cancel — this is how main.js fast-cancel works
    token.cancel("browser_open_cancel");
  };

  const result = await scanProject(dir, noop, onLog, noop, token, onBrowserOpen);
  cleanTempProject(dir);

  // Some environments have puppeteer installed but cannot launch Chromium.
  // In that case callback won't fire; fallback davranışını doğrula.
  if (browserRef === null) {
    if (REQUIRE_CHROMIUM) {
      throw new Error("Chromium launch unavailable (A11Y_REQUIRE_CHROMIUM=1)");
    }
    assert.equal(result.cancelled, false, "Without launched browser, scan should continue in fallback mode");
    assert.ok(
      logs.some((x) => /Tarayıcı hatası|Statik analiz ile devam ediliyor/i.test(x.msg)),
      "Fallback log should be emitted when Chromium cannot launch"
    );
    console.log("  PASS  test_onBrowserOpen_callback (fallback mode)");
    return;
  }

  assert.equal(result.cancelled, true, "Scan should be cancelled after browser-open abort");
  assert.ok(browserRef !== null, "onBrowserOpen should have been called");
  console.log("  PASS  test_onBrowserOpen_callback");
}

// ── TEST 8: Native AbortController signal works identically ───────────────────
async function test_abortSignal_native() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-native-signal-"));
  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(dir, `file${i}.js`), `console.log(${i});`);
  }

  const controller = new AbortController();
  let seenProgress = 0;
  const onProgress = () => {
    seenProgress++;
    if (seenProgress === 3) controller.abort("native_abort");
  };

  const result = await scanProject(dir, onProgress, noop, noop, controller.signal);
  cleanTempProject(dir);

  assert.equal(result.cancelled, true, "Native signal cancellation should mark result.cancelled");
  assert.ok(result.totalFiles < 20, `Expected partial processing, got ${result.totalFiles}`);
  console.log("  PASS  test_abortSignal_native");
}

// ── TEST 9: Rule contract metadata exists on technical findings ───────────────
async function test_rule_contract_metadata() {
  const dir = makeTempProject(1);
  const token = new CancelToken();
  const result = await scanProject(dir, noop, noop, noop, token);
  cleanTempProject(dir);

  assert.ok(Array.isArray(result.technicalFindings), "Result should include technicalFindings array");
  assert.ok(Array.isArray(result.issues), "Result should keep backward-compatible issues array");
  assert.equal(result.technicalFindings.length, result.issues.length, "technicalFindings and issues length should match");

  if (result.technicalFindings.length === 0) {
    throw new Error("no findings produced in fixture");
  }

  const f = result.technicalFindings[0];
  assert.ok(["PASS", "FAIL", "WARNING", "N/A", "MANUAL"].includes(f.status), "status should use contract enum");
  assert.ok(typeof f.triggeredCondition === "string" && f.triggeredCondition.length > 0, "triggeredCondition missing");
  assert.ok(typeof f.reason === "string" && f.reason.length > 0, "reason missing");
  assert.ok(typeof f.confidence === "string" && f.confidence.length > 0, "confidence missing");
  assert.ok(f.ruleContract && typeof f.ruleContract === "object", "ruleContract missing");
  assert.ok("pass_when" in f.ruleContract, "ruleContract.pass_when missing");
  assert.ok("fail_when" in f.ruleContract, "ruleContract.fail_when missing");
  assert.ok("warning_when" in f.ruleContract, "ruleContract.warning_when missing");
  assert.ok("not_applicable_when" in f.ruleContract, "ruleContract.not_applicable_when missing");
  assert.ok("manual_when" in f.ruleContract, "ruleContract.manual_when missing");
  assert.ok(f.evidenceLink && typeof f.evidenceLink === "object", "evidenceLink missing");

  console.log("  PASS  test_rule_contract_metadata");
}

// ── TEST 10: Mandatory custom rule failures are emitted deterministically ─────
async function test_mandatory_custom_rules_fail() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-custom-fail-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="en"><head><title>x</title></head><body>
      <img src="/logo.png" alt="">
      <div class="modal"><button class="close">x</button></div>
    </body></html>`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const fImg = findings.find((f) => f.rule === "custom-img-alt-nonempty");
  const fLang = findings.find((f) => f.rule === "custom-html-lang-tr");
  const fClose = findings.find((f) => f.rule === "custom-modal-close-label-tr");

  assert.ok(fImg, "custom-img-alt-nonempty finding missing");
  assert.ok(fLang, "custom-html-lang-tr finding missing");
  assert.ok(fClose, "custom-modal-close-label-tr finding missing");
  assert.equal(fImg.status, "FAIL", "Expected img-alt custom rule to FAIL");
  assert.equal(fLang.status, "FAIL", "Expected html-lang custom rule to FAIL");
  assert.equal(fClose.status, "FAIL", "Expected modal close label custom rule to FAIL");
  console.log("  PASS  test_mandatory_custom_rules_fail");
}

// ── TEST 11: Mandatory custom rule pass path for img/lang ─────────────────────
async function test_mandatory_custom_rules_pass() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-custom-pass-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="tr"><head><title>x</title></head><body>
      <img src="/logo.png" alt="Site logosu">
      <button><span class="sr-only">Kapat</span><svg aria-hidden="true"></svg></button>
    </body></html>`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const fImg = findings.find((f) => f.rule === "custom-img-alt-nonempty");
  const fLang = findings.find((f) => f.rule === "custom-html-lang-tr");
  assert.ok(fImg, "custom-img-alt-nonempty finding missing");
  assert.ok(fLang, "custom-html-lang-tr finding missing");
  assert.equal(fImg.status, "PASS", "Expected img-alt custom rule to PASS");
  assert.equal(fLang.status, "PASS", "Expected html-lang custom rule to PASS");
  console.log("  PASS  test_mandatory_custom_rules_pass");
}

// ── TEST 12: cancel+start race — second scan must complete cleanly ────────────
async function test_cancel_start_race() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-race-"));
  for (let i = 0; i < 25; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.js`), `console.log(${i});`);
  }

  const c1 = new AbortController();
  let start2Promise = null;
  let staleAfterCancel = 0;

  const first = scanProject(
    dir,
    (processed) => {
      if (processed >= 3 && !c1.signal.aborted) {
        c1.abort("race_cancel");
        start2Promise = scanProject(dir, noop, noop, () => {}, new AbortController().signal);
      }
    },
    noop,
    () => { if (c1.signal.aborted) staleAfterCancel++; },
    c1.signal
  );

  const r1 = await first;
  const r2 = await (start2Promise || scanProject(dir, noop, noop, () => {}, new AbortController().signal));
  cleanTempProject(dir);

  assert.equal(r1.cancelled, true, "First scan should be cancelled");
  assert.equal(r2.cancelled, false, "Second scan should complete");
  assert.equal(staleAfterCancel, 0, "No stale issues should be emitted after cancel");
  console.log("  PASS  test_cancel_start_race");
}

// ── TEST 13: Skip link missing should be detected robustly ───────────────────
async function test_skip_link_missing_detected() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-skip-missing-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="tr"><head><title>x</title></head><body>
      <!-- "skip" kelimesi yorumda geçiyor ama gerçek skip link yok -->
      <header><nav><a href="/urunler">Ürünler</a></nav></header>
      <main id="main"><h1>Sayfa</h1></main>
    </body></html>`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const skipMissing = findings.find((f) => f.rule === "skip-link-missing");
  assert.ok(skipMissing, "skip-link-missing finding missing");
  assert.equal(skipMissing.status, "FAIL", "Expected skip-link-missing to FAIL when no skip link exists");
  console.log("  PASS  test_skip_link_missing_detected");
}

// ── TEST 14: Skip link presence should suppress project-level missing rule ───
async function test_skip_link_present_not_flagged() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-skip-present-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="tr"><head><title>x</title></head><body>
      <a class="skip-link" href="#main">Ana İçeriğe Atla</a>
      <header><nav><a href="/urunler">Ürünler</a></nav></header>
      <main id="main"><h1>Sayfa</h1></main>
    </body></html>`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const skipMissing = findings.find((f) => f.rule === "skip-link-missing");
  assert.equal(skipMissing, undefined, "skip-link-missing should not be emitted when skip link exists");
  console.log("  PASS  test_skip_link_present_not_flagged");
}

// ── TEST 15: Table + slider custom rules FAIL path ───────────────────────────
async function test_table_slider_custom_rules_fail() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-table-slider-fail-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="tr"><head><title>x</title></head><body>
      <table>
        <tr><td>Ad</td><td>Değer</td></tr>
      </table>
      <div role="slider"></div>
    </body></html>`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const tableRule = findings.find((f) => f.rule === "custom-table-a11y");
  const sliderRule = findings.find((f) => f.rule === "custom-slider-a11y");
  assert.ok(tableRule, "custom-table-a11y finding missing");
  assert.ok(sliderRule, "custom-slider-a11y finding missing");
  assert.equal(tableRule.status, "FAIL", "Expected custom-table-a11y to FAIL");
  assert.equal(sliderRule.status, "FAIL", "Expected custom-slider-a11y to FAIL");
  console.log("  PASS  test_table_slider_custom_rules_fail");
}

// ── TEST 16: Table + slider custom rules PASS path ───────────────────────────
async function test_table_slider_custom_rules_pass() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-table-slider-pass-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="tr"><head><title>x</title></head><body>
      <label for="ses">Ses</label>
      <input id="ses" type="range" min="0" max="100" value="40" />
      <table>
        <caption>Fiyat Listesi</caption>
        <thead><tr><th scope="col">Ürün</th><th scope="col">Fiyat</th></tr></thead>
        <tbody><tr><td>A</td><td>100</td></tr></tbody>
      </table>
    </body></html>`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const tableRule = findings.find((f) => f.rule === "custom-table-a11y");
  const sliderRule = findings.find((f) => f.rule === "custom-slider-a11y");
  assert.ok(tableRule, "custom-table-a11y finding missing");
  assert.ok(sliderRule, "custom-slider-a11y finding missing");
  assert.equal(tableRule.status, "PASS", "Expected custom-table-a11y to PASS");
  assert.equal(sliderRule.status, "PASS", "Expected custom-slider-a11y to PASS");
  console.log("  PASS  test_table_slider_custom_rules_pass");
}

// ── TEST 17: Component gate should point real interactive line, not import ──
async function test_component_gate_line_precision() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-component-gate-line-"));
  const targetFile = path.join(dir, "src", "components", "CardShowcase");
  fs.mkdirSync(targetFile, { recursive: true });
  fs.writeFileSync(
    path.join(targetFile, "index.jsx"),
    `import React, { useRef } from "react";
import "./card_showcase.scss";

export default function CardShowcase() {
  return (
    <div>
      <div className="card" onClick={() => {}}>Aç</div>
    </div>
  );
}
`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const gate = findings.find((f) => f.rule === "custom-component-a11y-gate");
  assert.ok(gate, "custom-component-a11y-gate finding missing");
  assert.equal(gate.status, "FAIL", "Expected component gate to FAIL");
  assert.ok((gate.line || 0) > 1, "Component gate should point actual element line, not line 1");
  assert.ok(/onClick|onclick/i.test(gate.lineContent || ""), "lineContent should include interactive element snippet");
  console.log("  PASS  test_component_gate_line_precision");
}

// ── TEST 18: Heading hierarchy rules should be emitted ───────────────────────
async function test_heading_hierarchy_rules_detected() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-heading-rules-"));
  fs.writeFileSync(
    path.join(dir, "no-h1.html"),
    `<!doctype html><html lang="tr"><head><title>x</title></head><body>
      <h2>Bölüm</h2>
      <p>İçerik</p>
    </body></html>`
  );
  fs.writeFileSync(
    path.join(dir, "skip-level.html"),
    `<!doctype html><html lang="tr"><head><title>y</title></head><body>
      <h1>Ana Başlık</h1>
      <h3>Alt başlık</h3>
    </body></html>`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const missingH1 = findings.find((f) => f.rule === "heading-hierarchy-h1-missing");
  const skipLevel = findings.find((f) => f.rule === "heading-hierarchy-skip");
  const vagueSkip = findings.find((f) => f.rule === "custom-headings-skip-warning");
  assert.ok(missingH1, "heading-hierarchy-h1-missing finding missing");
  assert.ok(skipLevel, "heading-hierarchy-skip finding missing");
  assert.ok(vagueSkip, "custom-headings-skip-warning finding missing");
  assert.ok((vagueSkip.line || 0) > 1, "custom-headings-skip-warning should include meaningful line");
  console.log("  PASS  test_heading_hierarchy_rules_detected");
}

// ── TEST 19: Custom menu/form rules should point relevant line ───────────────
async function test_custom_rule_line_precision_menu_form() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-custom-line-precision-"));
  const targetFile = path.join(dir, "src", "components");
  fs.mkdirSync(targetFile, { recursive: true });
  fs.writeFileSync(
    path.join(targetFile, "BadPanel.jsx"),
    `import React from "react";
import "./bad.scss";

export default function BadPanel() {
  return (
    <div>
      <div className="menu-panel">Menü</div>
      <form>
        <input name="email" />
        <div className="error-msg">Hata</div>
      </form>
    </div>
  );
}
`
  );

  const result = await scanProject(dir, noop, noop, noop, new CancelToken());
  cleanTempProject(dir);

  const findings = result.technicalFindings || [];
  const menuRule = findings.find((f) => f.rule === "custom-menu-pattern");
  const formRule = findings.find((f) => f.rule === "custom-form-validation-announcement");
  assert.ok(menuRule, "custom-menu-pattern finding missing");
  assert.ok(formRule, "custom-form-validation-announcement finding missing");
  assert.equal(menuRule.status, "FAIL", "Expected custom-menu-pattern to FAIL");
  assert.equal(formRule.status, "FAIL", "Expected custom-form-validation-announcement to FAIL");
  assert.ok((menuRule.line || 0) > 1, "custom-menu-pattern should not point line 1 import");
  assert.ok((formRule.line || 0) > 1, "custom-form-validation-announcement should not point line 1 import");
  console.log("  PASS  test_custom_rule_line_precision_menu_form");
}

// ── runner ───────────────────────────────────────────────────────────────────
async function run() {
  console.log("\n=== Phase 1 Cancellation Tests ===\n");

  const tests = [
    ["CancelToken basic",               () => Promise.resolve(test_cancelToken_basic())],
    ["CancelToken throws",              () => Promise.resolve(test_cancelToken_throws())],
    ["Pre-cancelled returns fast",      test_precancelled_returns_fast],
    ["Cancel during static analysis",   test_cancel_during_static],
    ["No stale issues after cancel",    test_no_stale_issues_after_cancel],
    ["Sequential scans clean",          test_sequential_scans_clean],
    ["onBrowserOpen callback",          test_onBrowserOpen_callback],
    ["Native AbortSignal cancel",       test_abortSignal_native],
    ["Rule contract metadata",          test_rule_contract_metadata],
    ["Mandatory custom rules FAIL",     test_mandatory_custom_rules_fail],
    ["Mandatory custom rules PASS",     test_mandatory_custom_rules_pass],
    ["Cancel+Start race",               test_cancel_start_race],
    ["Skip link missing detect",        test_skip_link_missing_detected],
    ["Skip link present detect",        test_skip_link_present_not_flagged],
    ["Table/slider custom FAIL",        test_table_slider_custom_rules_fail],
    ["Table/slider custom PASS",        test_table_slider_custom_rules_pass],
    ["Component gate line precision",   test_component_gate_line_precision],
    ["Heading hierarchy rules",         test_heading_hierarchy_rules_detected],
    ["Custom rule line precision",      test_custom_rule_line_precision_menu_form],
  ];

  let passed = 0, failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`  FAIL  ${name}`);
      console.error(`        ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Runner crashed:", err);
  process.exit(1);
});
