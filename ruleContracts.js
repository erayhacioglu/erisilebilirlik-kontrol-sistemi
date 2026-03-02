"use strict";

const MANUAL_RULES = new Set([
  "captcha-detected",
  "motion-actuation",
]);

function defaultContract(ruleId, source) {
  return {
    rule_id: ruleId || "unknown-rule",
    pass_when: "Kural ihlali veya şüpheli durum tespit edilmediğinde.",
    fail_when: source === "axe-core"
      ? "Axe kuralı violation sonucu ürettiğinde."
      : "Kesin teknik ihlal paterni tespit edildiğinde.",
    warning_when: "Heuristik veya kısmi doğrulukta risk paterni tespit edildiğinde.",
    not_applicable_when: "İlgili bileşen/senaryo sayfada bulunmadığında.",
    manual_when: "Otomasyonla kesin karar verilemeyen durumlarda manuel doğrulama gerektiğinde.",
  };
}

function resolveRuleContract(ruleId, source) {
  const c = defaultContract(ruleId, source);
  if ((ruleId || "").startsWith("custom-")) {
    return {
      ...c,
      pass_when: "Zorunlu custom kuralın tüm doğrulama koşulları sağlandığında.",
      fail_when: "Zorunlu custom kuralın en az bir zorunlu koşulu sağlanmadığında.",
      warning_when: "Kural uyarı seviyesinde tanımlı ara koşul üretirse.",
      not_applicable_when: "İlgili bileşen/senaryo projede yoksa.",
      manual_when: "Sadece otomasyonla kesin karar üretilemeyen custom kural varyantlarında.",
    };
  }
  if (ruleId === "runtime-scenario-failure") {
    return {
      ...c,
      fail_when: "Uygulanamaz.",
      warning_when: "Senaryo adımı timeout veya deterministik adım hatası verdiğinde.",
      manual_when: "Gerekmez.",
    };
  }
  if ((ruleId || "").endsWith("-review")) {
    return {
      ...c,
      fail_when: "Uygulanamaz.",
      warning_when: "Uygulanamaz.",
      manual_when: "Axe incomplete sonucu ile otomatik tamamlanamayan kontrol oluştuğunda.",
    };
  }
  if (ruleId === "captcha-detected") {
    return {
      ...c,
      fail_when: "Uygulanamaz.",
      warning_when: "Uygulanamaz.",
      manual_when: "CAPTCHA varlığı tespit edildiğinde alternatif erişim manuel doğrulanmalıdır.",
    };
  }
  return c;
}

function inferStatus(finding) {
  const rule = (finding.rule || "").toLowerCase();
  if (finding.status && ["PASS", "FAIL", "WARNING", "N/A", "MANUAL"].includes(finding.status)) {
    return finding.status;
  }
  if (rule.endsWith("-review")) return "MANUAL";
  if (MANUAL_RULES.has(rule)) return "MANUAL";
  if (finding.source === "runtime" && rule === "runtime-scenario-failure") return "WARNING";
  if (finding.severity === "critical") return "FAIL";
  if (finding.severity === "warning") return "WARNING";
  if (finding.severity === "review") return "WARNING";
  return "WARNING";
}

function inferConfidence(finding, status) {
  if (finding.confidence) return finding.confidence;
  const rule = (finding.rule || "").toLowerCase();

  // Rule-specific confidence calibration for better consistency.
  if (status === "FAIL") {
    if (rule === "skip-link-missing") return "high";
    if (rule === "focus-outline-removed") return "high";
    if (rule.startsWith("custom-")) return "high";
    if (rule === "keyboard-focus-missing") return "medium";
  }
  if (status === "WARNING") {
    if (rule === "loading-not-announced") return "medium";
    if (rule === "runtime-scenario-failure") return "medium";
    if (rule === "ambiguous-link-text") return "low";
  }
  if (status === "PASS" && rule.startsWith("custom-")) return "high";

  if (status === "PASS" && (finding.rule || "").startsWith("custom-")) return "high";
  if (status === "MANUAL") return "low";
  if (finding.source === "axe-core") return status === "FAIL" ? "high" : "medium";
  if (finding.source === "runtime") return "medium";
  if (finding.source === "static") return finding.severity === "critical" ? "medium" : "low";
  return "low";
}

function inferReason(finding, status) {
  if (finding.reason) return finding.reason;
  const text = (finding.desc || finding.title || "").toString().trim();
  if (!text) return `Rule ${finding.rule || "unknown"} evaluated as ${status}.`;
  return text.split("\n")[0].slice(0, 280);
}

function inferTriggeredCondition(status) {
  if (status === "FAIL") return "fail_when";
  if (status === "WARNING") return "warning_when";
  if (status === "N/A") return "not_applicable_when";
  if (status === "MANUAL") return "manual_when";
  return "pass_when";
}

function buildEvidenceLink(finding) {
  const ev = finding.evidence || {};
  const ps = finding.pageState || ev.pageState || {};
  return {
    scenario: ps.scenario || "initial-load",
    stepId: ps.stepId || "initial.ready",
    selector: ev.selector || finding.selector || "",
    snippet: ev.snippet || finding.lineContent || "",
  };
}

function applyRuleContractToFinding(finding) {
  const status = inferStatus(finding);
  const ruleContract = resolveRuleContract(finding.rule, finding.source);
  return {
    ...finding,
    status,
    triggeredCondition: inferTriggeredCondition(status),
    reason: inferReason(finding, status),
    confidence: inferConfidence(finding, status),
    evidenceLink: buildEvidenceLink(finding),
    ruleContract,
  };
}

module.exports = {
  resolveRuleContract,
  applyRuleContractToFinding,
};
