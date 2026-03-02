"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const tests = [
  "dedup.test.js",
  "reliability.test.js",
  "ruleContracts.test.js",
  "checklist.test.js",
  "officialChecklistReference.test.js",
  "exportSchema.test.js",
  "runtimeScenarios.test.js",
  "scanner.test.js",
];

let failed = 0;
for (const t of tests) {
  const abs = path.join(__dirname, t);
  const r = spawnSync(process.execPath, [abs], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

process.exit(failed > 0 ? 1 : 0);
