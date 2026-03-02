"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { OFFICIAL_CHECKLIST_METADATA } = require("./officialChecklistMetadata");

function canonicalize(obj) {
  if (Array.isArray(obj)) return obj.map(canonicalize);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return obj;
}

function toReferenceArray(metadata) {
  return Object.keys(metadata)
    .sort()
    .map((id) => ({ id, ...metadata[id] }));
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function test_official_reference_file_matches_metadata() {
  const refPath = path.join(__dirname, "officialChecklistReference.json");
  const expected = JSON.parse(fs.readFileSync(refPath, "utf8"));
  const actual = toReferenceArray(OFFICIAL_CHECKLIST_METADATA);

  assert.deepEqual(
    canonicalize(actual),
    canonicalize(expected),
    "Resmi kontrol listesi metaverisi referans dosya ile birebir aynı olmalı."
  );

  assert.equal(actual.length, 122, "Referans soru sayısı 122 olmalı.");

  const expectedDigest = sha256(canonicalize(expected));
  const actualDigest = sha256(canonicalize(actual));
  assert.equal(
    actualDigest,
    expectedDigest,
    "Resmi kontrol listesi özeti değişti; metin/WCAG/kriter/atlama alanlarında sapma var."
  );

  console.log("  PASS  test_official_reference_file_matches_metadata");
}

function run() {
  console.log("\n=== Official Checklist Reference Tests ===\n");
  try {
    test_official_reference_file_matches_metadata();
    console.log("\n=== Results: 1 passed, 0 failed ===\n");
    process.exit(0);
  } catch (err) {
    console.error("  FAIL  test_official_reference_file_matches_metadata");
    console.error(`        ${err.message}`);
    console.log("\n=== Results: 0 passed, 1 failed ===\n");
    process.exit(1);
  }
}

run();
