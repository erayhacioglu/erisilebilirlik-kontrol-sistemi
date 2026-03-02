"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RELIABILITY_SCHEMA_VERSION = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createEmptyStore() {
  return {
    version: RELIABILITY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    rules: {},
  };
}

function normalizeStatus(status) {
  const s = String(status || "").toUpperCase();
  if (["FAIL", "WARNING", "PASS", "MANUAL", "N/A"].includes(s)) return s;
  return "WARNING";
}

function createRuleStat() {
  return {
    total: 0,
    fail: 0,
    warning: 0,
    pass: 0,
    manual: 0,
    na: 0,
    scansSeen: 0,
    lastSeenAt: "",
    reliabilityScore: 0.5,
    reliabilityBucket: "medium",
  };
}

function computeRuleReliability(stat) {
  const total = Math.max(1, Number(stat.total) || 0);
  const fail = Number(stat.fail) || 0;
  const pass = Number(stat.pass) || 0;
  const warning = Number(stat.warning) || 0;
  const manual = Number(stat.manual) || 0;

  // Decisive signals (PASS/FAIL) increase trust, warning/manual-heavy patterns reduce trust.
  const signal = (fail + pass) / total;
  const noise = ((warning * 0.6) + (manual * 0.8)) / total;
  const maturity = Math.min(1, total / 25);
  const score = clamp(signal - noise + (maturity * 0.25), 0.05, 0.99);

  const bucket = score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low";
  return { score: Number(score.toFixed(4)), bucket };
}

function loadReliabilityStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return createEmptyStore();
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== RELIABILITY_SCHEMA_VERSION || typeof parsed.rules !== "object") {
      return createEmptyStore();
    }
    return parsed;
  } catch {
    return createEmptyStore();
  }
}

function saveReliabilityStore(filePath, store) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeStore = store && typeof store === "object" ? store : createEmptyStore();
  safeStore.version = RELIABILITY_SCHEMA_VERSION;
  safeStore.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(safeStore, null, 2), "utf-8");
}

function updateReliabilityStore(store, findings) {
  const next = store && typeof store === "object" ? store : createEmptyStore();
  if (!next.rules || typeof next.rules !== "object") next.rules = {};

  const scanRuleSeen = new Set();
  for (const finding of (Array.isArray(findings) ? findings : [])) {
    const rule = String(finding.rule || "").trim().toLowerCase();
    if (!rule) continue;
    const status = normalizeStatus(finding.status);

    const stat = next.rules[rule] || createRuleStat();
    stat.total += 1;
    if (status === "FAIL") stat.fail += 1;
    else if (status === "WARNING") stat.warning += 1;
    else if (status === "PASS") stat.pass += 1;
    else if (status === "MANUAL") stat.manual += 1;
    else if (status === "N/A") stat.na += 1;

    if (!scanRuleSeen.has(rule)) {
      stat.scansSeen += 1;
      scanRuleSeen.add(rule);
    }

    stat.lastSeenAt = new Date().toISOString();
    const rel = computeRuleReliability(stat);
    stat.reliabilityScore = rel.score;
    stat.reliabilityBucket = rel.bucket;
    next.rules[rule] = stat;
  }

  next.version = RELIABILITY_SCHEMA_VERSION;
  next.updatedAt = new Date().toISOString();
  return next;
}

function adaptFindingsByReliability(findings, store) {
  const input = Array.isArray(findings) ? findings : [];
  const rules = (store && store.rules) || {};
  const stats = { adaptedCount: 0, warningToReview: 0, failToWarning: 0 };

  const adaptedFindings = input.map((finding) => {
    const rule = String(finding.rule || "").trim().toLowerCase();
    const stat = rules[rule];
    if (!stat) return finding;

    const score = Number(stat.reliabilityScore) || 0.5;
    const bucket = stat.reliabilityBucket || "medium";
    const source = String(finding.source || "");
    const isCustom = rule.startsWith("custom-");
    const isAxe = source === "axe-core";

    const out = {
      ...finding,
      reliabilityScore: score,
      reliabilityBucket: bucket,
    };

    // Only soften non-axe and non-custom findings.
    if ((bucket === "low" || bucket === "medium") && !isAxe && !isCustom) {
      if (finding.status === "WARNING") {
        if (finding.severity !== "review") {
          out.severity = "review";
          stats.warningToReview += 1;
        }
        out.confidence = "low";
        out.reliabilityAdjusted = true;
        stats.adaptedCount += 1;
      } else if (bucket === "low" && finding.status === "FAIL" && source === "static") {
        out.status = "WARNING";
        out.severity = "warning";
        out.confidence = "low";
        out.reliabilityAdjusted = true;
        stats.failToWarning += 1;
        stats.adaptedCount += 1;
      }
    }

    return out;
  });

  return { adaptedFindings, stats };
}

function buildReliabilitySummary(store, limit = 12) {
  const rules = (store && store.rules) || {};
  const rows = Object.entries(rules).map(([rule, stat]) => ({
    rule,
    reliabilityScore: Number(stat.reliabilityScore) || 0.5,
    reliabilityBucket: stat.reliabilityBucket || "medium",
    total: Number(stat.total) || 0,
    fail: Number(stat.fail) || 0,
    warning: Number(stat.warning) || 0,
    pass: Number(stat.pass) || 0,
    manual: Number(stat.manual) || 0,
    scansSeen: Number(stat.scansSeen) || 0,
    lastSeenAt: stat.lastSeenAt || "",
  }));

  const totalObservations = rows.reduce((sum, x) => sum + x.total, 0);
  const highCount = rows.filter((x) => x.reliabilityBucket === "high").length;
  const mediumCount = rows.filter((x) => x.reliabilityBucket === "medium").length;
  const lowCount = rows.filter((x) => x.reliabilityBucket === "low").length;
  const lowRules = rows
    .sort((a, b) => (a.reliabilityScore - b.reliabilityScore) || (b.total - a.total))
    .slice(0, Math.max(1, limit));

  return {
    version: store && store.version ? store.version : RELIABILITY_SCHEMA_VERSION,
    updatedAt: (store && store.updatedAt) || "",
    ruleCount: rows.length,
    totalObservations,
    highCount,
    mediumCount,
    lowCount,
    lowRules,
  };
}

module.exports = {
  RELIABILITY_SCHEMA_VERSION,
  createEmptyStore,
  computeRuleReliability,
  loadReliabilityStore,
  saveReliabilityStore,
  updateReliabilityStore,
  adaptFindingsByReliability,
  buildReliabilitySummary,
};
