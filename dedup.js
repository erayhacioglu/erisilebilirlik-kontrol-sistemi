"use strict";

function normalizeFile(file) {
  return (file || "").toString().trim().replace(/\\/g, "/");
}

function normalizeSelector(selector) {
  return (selector || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([>+~])\s*/g, "$1")
    .replace(/\s*:\s*/g, ":")
    // DOM yapısı değiştikçe farklılaşan nth-* değerlerini stabilize et.
    .replace(/:nth-(?:child|of-type)\(\s*\d+\s*\)/g, ":nth-*")
    .replace(/:nth-(?:last-child|last-of-type)\(\s*\d+\s*\)/g, ":nth-last-*");
}

function normalizeMessage(msg) {
  return (msg || "")
    .toString()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\d+/g, "#")
    .trim();
}

function buildDedupKey(finding) {
  const rule = (finding.rule || "").toString().trim().toLowerCase();
  const file = normalizeFile(finding.file);
  const line = Number.isFinite(finding.line) ? finding.line : 0;
  const selector = normalizeSelector(finding.selector || (finding.evidence && finding.evidence.selector) || "");
  const message = normalizeMessage(finding.reason || finding.desc || finding.title || "");
  // line > 0 ise key'e dahil et (axe-core bulgularında line=0, bunlar selector ile ayrılır)
  const linePart = line > 0 ? `|L${line}` : "";
  return `${rule}|${file}${linePart}|${selector}|${message}`;
}

function dedupeFindings(findings) {
  const rawFindings = (Array.isArray(findings) ? findings : []).filter(
    (f) => f && f.source !== "runtime-infra" && f.rule !== "runtime-scenario-failure" && !f.hidden
  );
  const byKey = new Map();

  for (const f of rawFindings) {
    const key = buildDedupKey(f);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }

  const uniqueFindings = [];
  const groups = [];
  let idx = 0;

  for (const [dedupKey, items] of byKey.entries()) {
    idx++;
    const canonical = items[0];
    const groupId = `G${String(idx).padStart(5, "0")}`;
    const duplicates = items.slice(1);
    const duplicateCount = items.length;

    uniqueFindings.push({
      ...canonical,
      dedup: {
        key: dedupKey,
        groupId,
        duplicateCount,
        isGrouped: duplicateCount > 1,
      },
    });

    groups.push({
      groupId,
      dedupKey,
      rule: canonical.rule || "",
      file: canonical.file || "",
      selector: canonical.selector || "",
      duplicateCount,
      canonical,
      duplicates,
      all: items,
    });
  }

  return {
    rawFindings,
    uniqueFindings,
    groups,
    stats: {
      rawCount: rawFindings.length,
      uniqueCount: uniqueFindings.length,
      duplicateCount: rawFindings.length - uniqueFindings.length,
    },
  };
}

module.exports = {
  buildDedupKey,
  dedupeFindings,
};
