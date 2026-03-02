"use strict";

const EXPORT_SCHEMA_NAME = "a11y-scanner-report";
const EXPORT_SCHEMA_VERSION = "1.0.0";

function toIso(value) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function normalizeIssue(issue, index = 0) {
  const e = issue && issue.evidence ? issue.evidence : {};
  const c = e.context || {};
  const p = e.pageState || {};
  return {
    id: issue.id || index + 1,
    rule: issue.rule || "",
    title: issue.title || "",
    desc: issue.desc || "",
    reason: issue.reason || issue.desc || "",
    triggeredCondition: issue.triggeredCondition || "",
    severity: issue.severity || "review",
    status: issue.status || "WARNING",
    confidence: issue.confidence || "low",
    wcag: issue.wcag || "",
    source: issue.source || "static",
    file: issue.file || "",
    line: Number.isFinite(issue.line) ? issue.line : 0,
    selector: issue.selector || e.selector || "",
    timestamp: issue.timestamp || e.timestamp || "",
    url: issue.url || e.url || "",
    dedup: issue.dedup || null,
    evidence: {
      selector: e.selector || issue.selector || "",
      snippet: e.snippet || issue.lineContent || "",
      context: {
        domPath: c.domPath || "",
        ancestorSummary: c.ancestorSummary || "",
      },
      pageState: {
        scenario: p.scenario || "",
        stepId: p.stepId || "",
      },
      timestamp: e.timestamp || issue.timestamp || "",
      url: e.url || issue.url || "",
    },
    fix: issue.fix || "",
    fixNote: issue.fixNote || "",
    lineContent: issue.lineContent || "",
  };
}

function normalizeChecklistResults(checklistResults) {
  const cl = Array.isArray(checklistResults) ? checklistResults : [];
  return cl.map((q) => ({
    id: q.id || "",
    wcag: q.wcag || "",
    criterion: q.criterion || "",
    question: q.question || "",
    expectedAnswer: q.expectedAnswer || "",
    computedAnswer: q.computedAnswer || "",
    computedOutcome: q.computedOutcome || "",
    status: q.status || "",
    confidence: q.confidence || "",
    rationale: q.rationale || "",
    autoOrManual: q.autoOrManual || "",
    manualAnswer: q.manualAnswer == null ? null : String(q.manualAnswer),
    manualNote: q.manualNote || "",
    nextOnNo: q.nextOnNo || null,
    branchSkippedBy: q.branchSkippedBy || null,
    mappedRules: Array.isArray(q.mappedRules) ? q.mappedRules : [],
    triggeredRuleStatuses: Array.isArray(q.triggeredRuleStatuses) ? q.triggeredRuleStatuses : [],
  }));
}

function normalizeGroups(findingGroups) {
  const groups = Array.isArray(findingGroups) ? findingGroups : [];
  return groups.map((g) => ({
    groupId: g.groupId || "",
    dedupKey: g.dedupKey || "",
    rule: g.rule || "",
    file: g.file || "",
    selector: g.selector || "",
    duplicateCount: Number.isFinite(g.duplicateCount) ? g.duplicateCount : 0,
  }));
}

function countBy(arr, key) {
  const out = {};
  for (const item of arr) {
    const val = (item && item[key]) || "";
    const k = String(val || "unknown");
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function buildDedupSummary(dedupStats, uniqueFindings, rawFindings) {
  const rawCount = Number.isFinite(dedupStats && dedupStats.rawCount) ? dedupStats.rawCount : rawFindings.length;
  const uniqueCount = Number.isFinite(dedupStats && dedupStats.uniqueCount) ? dedupStats.uniqueCount : uniqueFindings.length;
  const duplicateCount = Number.isFinite(dedupStats && dedupStats.duplicateCount)
    ? dedupStats.duplicateCount
    : Math.max(0, rawCount - uniqueCount);
  return { rawCount, uniqueCount, duplicateCount };
}

function buildChecklistSummary(checklist) {
  const total = checklist.length;
  const byStatus = countBy(checklist, "status");
  const autoCount = checklist.filter((x) => x.autoOrManual === "auto").length;
  const manualCount = checklist.filter((x) => x.autoOrManual === "manual").length;
  const manualItems = checklist.filter((x) => x.autoOrManual === "manual");
  const manualAnsweredAny = manualItems.filter((x) => ["yes", "no", "na"].includes((x.manualAnswer || "").toLowerCase()));
  const manualAnsweredYesNo = manualItems.filter((x) => ["yes", "no"].includes((x.manualAnswer || "").toLowerCase()));
  const manualFailFindings = manualAnsweredYesNo.filter((x) => String(x.status || "").toLowerCase() === "fail");

  const coverage = manualItems.length > 0 ? manualAnsweredAny.length / manualItems.length : 0;
  const discoveryRate = manualAnsweredYesNo.length > 0 ? manualFailFindings.length / manualAnsweredYesNo.length : 0;

  return {
    total,
    byStatus,
    autoCount,
    manualCount,
    quality: {
      manualSamples: manualItems.length,
      manualAnswered: manualAnsweredAny.length,
      manualCoverageRate: Number(coverage.toFixed(4)),
      manualDiscoveryRate: Number(discoveryRate.toFixed(4)),
      notReviewedCount: Math.max(0, manualItems.length - manualAnsweredAny.length),
    },
  };
}

function buildExportPayload(input) {
  const issues = Array.isArray(input && input.issues) ? input.issues : [];
  const rawIssues = Array.isArray(input && input.rawIssues) && input.rawIssues.length > 0
    ? input.rawIssues
    : issues;
  const deduped = issues.map((x, idx) => normalizeIssue(x, idx));
  const raw = rawIssues.map((x, idx) => normalizeIssue(x, idx));
  // Manuel cevapları final status'a çevir
  const rawChecklist = Array.isArray(input && input.checklistResults) ? input.checklistResults : [];
  const resolvedChecklist = rawChecklist.map((q) => {
    if (q.status === "manual" && q.manualAnswer) {
      const isPositive = q.manualAnswer === "yes";
      const expectedYes = q.expectedAnswer === "Yes";
      const pass = (isPositive && expectedYes) || (!isPositive && !expectedYes);
      return {
        ...q,
        status: pass ? "pass" : "fail",
        computedOutcome: pass ? "PASS" : "FAIL",
        computedAnswer: isPositive ? "Yes" : "No",
        rationale: `Manuel cevap: ${q.manualAnswer}. ${q.manualNote || ""}`.trim(),
        confidence: "medium",
      };
    }
    return q;
  });
  const checklist = normalizeChecklistResults(resolvedChecklist);
  const groups = normalizeGroups(input && input.findingGroups);
  const dedupSummary = buildDedupSummary(input && input.dedupStats, deduped, raw);
  const sm = (input && input.scanMeta) || {};
  const reliabilitySummary = (input && input.reliabilitySummary) || null;

  return {
    schema: {
      name: EXPORT_SCHEMA_NAME,
      version: EXPORT_SCHEMA_VERSION,
    },
    meta: {
      projectName: (input && input.projectName) || "proje",
      scanDate: toIso(input && input.scanDate),
      generatedAt: new Date().toISOString(),
      scanDurationMs: sm.scanDurationMs || 0,
      scanDurationFormatted: sm.scanDurationMs ? `${(sm.scanDurationMs / 1000).toFixed(1)}s` : "-",
      axeCoreVersion: sm.axeCoreVersion || "unknown",
      wcagVersion: sm.wcagVersion || "2.2",
      wcagLevel: sm.wcagLevel || "A",
      totalHtmlFiles: sm.totalHtmlFiles || 0,
      totalStaticFiles: sm.totalStaticFiles || 0,
    },
    summary: {
      dedup: dedupSummary,
      technicalFindings: {
        bySeverity: countBy(deduped, "severity"),
        byStatus: countBy(deduped, "status"),
        totalDeduplicated: deduped.length,
        totalRaw: raw.length,
      },
      checklist: buildChecklistSummary(checklist),
      reliability: reliabilitySummary,
    },
    technicalFindings: {
      deduplicated: deduped,
      raw,
      groups,
    },
    checklist: {
      summary: buildChecklistSummary(checklist),
      outcomes: checklist,
    },
    mediaContext: (input && input.mediaCtx) || {},
  };
}

function escCsv(v) {
  return `"${String(v == null ? "" : v).replace(/"/g, "\"\"")}"`;
}

function buildCsvFromPayload(payload) {
  const lines = [];
  lines.push(`SCHEMA_NAME,${escCsv(payload.schema.name)}`);
  lines.push(`SCHEMA_VERSION,${escCsv(payload.schema.version)}`);
  lines.push(`PROJECT,${escCsv(payload.meta.projectName)}`);
  lines.push(`SCAN_DATE,${escCsv(payload.meta.scanDate)}`);
  lines.push(`GENERATED_AT,${escCsv(payload.meta.generatedAt)}`);
  lines.push("");
  lines.push("DEDUP_SUMMARY,rawCount,uniqueCount,duplicateCount");
  lines.push(`DEDUP_SUMMARY,${payload.summary.dedup.rawCount},${payload.summary.dedup.uniqueCount},${payload.summary.dedup.duplicateCount}`);
  if (payload.summary.reliability) {
    const r = payload.summary.reliability;
    lines.push("RELIABILITY_SUMMARY,ruleCount,totalObservations,highCount,mediumCount,lowCount,updatedAt");
    lines.push(`RELIABILITY_SUMMARY,${r.ruleCount || 0},${r.totalObservations || 0},${r.highCount || 0},${r.mediumCount || 0},${r.lowCount || 0},${escCsv(r.updatedAt || "")}`);
  }
  lines.push("");

  lines.push("TECHNICAL_FINDINGS_DEDUP");
  lines.push([
    "id", "severity", "status", "confidence", "rule", "wcag", "title", "reason", "triggeredCondition",
    "source", "file", "line", "selector", "scenario", "stepId", "domPath", "ancestorSummary",
    "snippet", "url", "timestamp", "dedupGroupId", "dedupKey", "duplicateCount",
  ].join(","));
  for (const f of payload.technicalFindings.deduplicated) {
    lines.push([
      escCsv(f.id),
      escCsv(f.severity),
      escCsv(f.status),
      escCsv(f.confidence),
      escCsv(f.rule),
      escCsv(f.wcag),
      escCsv(f.title),
      escCsv(f.reason),
      escCsv(f.triggeredCondition),
      escCsv(f.source),
      escCsv(f.file),
      escCsv(f.line),
      escCsv(f.selector),
      escCsv(f.evidence.pageState.scenario),
      escCsv(f.evidence.pageState.stepId),
      escCsv(f.evidence.context.domPath),
      escCsv(f.evidence.context.ancestorSummary),
      escCsv(f.evidence.snippet),
      escCsv(f.evidence.url || f.url),
      escCsv(f.evidence.timestamp || f.timestamp),
      escCsv((f.dedup && f.dedup.groupId) || ""),
      escCsv((f.dedup && f.dedup.key) || ""),
      escCsv((f.dedup && f.dedup.duplicateCount) || 1),
    ].join(","));
  }
  lines.push("");

  lines.push("CHECKLIST_OUTCOMES");
  lines.push([
    "id", "wcag", "criterion", "question", "expectedAnswer", "computedAnswer", "computedOutcome",
    "status", "confidence", "autoOrManual", "manualAnswer", "manualNote", "rationale", "nextOnNo", "branchSkippedBy",
  ].join(","));
  for (const q of payload.checklist.outcomes) {
    lines.push([
      escCsv(q.id),
      escCsv(q.wcag),
      escCsv(q.criterion),
      escCsv(q.question),
      escCsv(q.expectedAnswer),
      escCsv(q.computedAnswer),
      escCsv(q.computedOutcome),
      escCsv(q.status),
      escCsv(q.confidence),
      escCsv(q.autoOrManual),
      escCsv(q.manualAnswer == null ? "" : q.manualAnswer),
      escCsv(q.manualNote || ""),
      escCsv(q.rationale),
      escCsv(q.nextOnNo || ""),
      escCsv(q.branchSkippedBy || ""),
    ].join(","));
  }

  return "\uFEFF" + lines.join("\n");
}

function escHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPdfHtmlFromPayload(payload) {
  const dedup = payload.summary.dedup;
  const tf = payload.summary.technicalFindings;
  const cl = payload.checklist.outcomes;

  const issueRows = payload.technicalFindings.deduplicated.map((f) => `
    <tr>
      <td>${escHtml(f.severity)}</td>
      <td>${escHtml(f.status)}</td>
      <td>${escHtml(f.confidence)}</td>
      <td>${escHtml(f.rule)}</td>
      <td>${escHtml(f.file)}:${escHtml(f.line)}</td>
      <td>${escHtml(f.evidence.pageState.scenario || "-")} / ${escHtml(f.evidence.pageState.stepId || "-")}</td>
      <td>${escHtml((f.reason || "").slice(0, 120))}</td>
    </tr>
  `).join("");

  const checklistRows = cl.slice(0, 122).map((q) => `
    <tr>
      <td>${escHtml(q.id)}</td>
      <td>${escHtml(q.status)}</td>
      <td>${escHtml(q.expectedAnswer)}</td>
      <td>${escHtml(q.computedOutcome)}</td>
      <td>${escHtml(q.confidence)}</td>
      <td>${escHtml(q.manualAnswer == null ? "-" : q.manualAnswer)}</td>
      <td>${escHtml((q.rationale || "").slice(0, 80))}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>A11y Report</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111827; padding: 24px; }
  h1, h2 { margin: 0 0 8px; }
  .muted { color: #6b7280; font-size: 11px; margin-bottom: 12px; }
  .summary { margin: 12px 0 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; }
  .num { font-size: 18px; font-weight: 700; display: block; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px; vertical-align: top; text-align: left; }
  th { background: #f9fafb; font-size: 10px; text-transform: uppercase; }
</style>
</head>
<body>
  <h1>Erişilebilirlik Raporu</h1>
  <div class="muted">Schema: ${escHtml(payload.schema.name)} v${escHtml(payload.schema.version)} | Proje: ${escHtml(payload.meta.projectName)} | Tarama: ${escHtml(payload.meta.scanDate)}</div>
  <div class="summary">
    <div class="card"><span class="num">${dedup.rawCount}</span>Ham Bulgu</div>
    <div class="card"><span class="num">${dedup.uniqueCount}</span>Benzersiz Bulgu</div>
    <div class="card"><span class="num">${dedup.duplicateCount}</span>Tekrar</div>
    <div class="card"><span class="num">${tf.totalDeduplicated}</span>Raporlanan</div>
  </div>
  <h2>Teknik Bulgular (Dedup)</h2>
  <table>
    <thead><tr><th>Severity</th><th>Status</th><th>Confidence</th><th>Rule</th><th>File</th><th>State</th><th>Reason</th></tr></thead>
    <tbody>${issueRows}</tbody>
  </table>
  <h2>Checklist Sonuçları (${cl.length})</h2>
  <table>
    <thead><tr><th>ID</th><th>Status</th><th>Expected</th><th>Outcome</th><th>Confidence</th><th>Manual</th><th>Rationale</th></tr></thead>
    <tbody>${checklistRows}</tbody>
  </table>
</body>
</html>`;
}

module.exports = {
  EXPORT_SCHEMA_NAME,
  EXPORT_SCHEMA_VERSION,
  buildExportPayload,
  buildCsvFromPayload,
  buildPdfHtmlFromPayload,
};
