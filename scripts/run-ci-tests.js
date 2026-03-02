"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function existsFile(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function addCandidate(candidates, p) {
  if (!p || typeof p !== "string") return;
  if (existsFile(p)) candidates.add(path.resolve(p));
}

function addPuppeteerCandidates(candidates) {
  let puppeteer = null;
  try {
    puppeteer = require("puppeteer");
  } catch {
    return;
  }

  try {
    if (typeof puppeteer.executablePath === "function") {
      addCandidate(candidates, puppeteer.executablePath());
    }
  } catch {}
}

function addCommonOsCandidates(candidates) {
  // macOS
  addCandidate(candidates, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  addCandidate(candidates, "/Applications/Chromium.app/Contents/MacOS/Chromium");
  addCandidate(candidates, "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");

  // Linux
  addCandidate(candidates, "/usr/bin/google-chrome");
  addCandidate(candidates, "/usr/bin/google-chrome-stable");
  addCandidate(candidates, "/usr/bin/chromium");
  addCandidate(candidates, "/usr/bin/chromium-browser");
  addCandidate(candidates, "/snap/bin/chromium");
  addCandidate(candidates, "/opt/google/chrome/chrome");
  addCandidate(candidates, "/usr/bin/microsoft-edge");

  // Windows
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pfx86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  addCandidate(candidates, path.join(pf, "Google", "Chrome", "Application", "chrome.exe"));
  addCandidate(candidates, path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe"));
  addCandidate(candidates, path.join(local, "Google", "Chrome", "Application", "chrome.exe"));
  addCandidate(candidates, path.join(pf, "Chromium", "Application", "chrome.exe"));
  addCandidate(candidates, path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"));
  addCandidate(candidates, path.join(pfx86, "Microsoft", "Edge", "Application", "msedge.exe"));
}

function addPuppeteerCacheCandidates(candidates) {
  const home = os.homedir();
  if (!home) return;
  const root = path.join(home, ".cache", "puppeteer", "chrome");
  if (!fs.existsSync(root)) return;

  let versions = [];
  try {
    versions = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return;
  }

  for (const v of versions) {
    addCandidate(
      candidates,
      path.join(root, v, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
    );
    addCandidate(
      candidates,
      path.join(root, v, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
    );
    addCandidate(candidates, path.join(root, v, "chrome-linux64", "chrome"));
    addCandidate(candidates, path.join(root, v, "chrome-linux", "chrome"));
    addCandidate(candidates, path.join(root, v, "chrome-win64", "chrome.exe"));
    addCandidate(candidates, path.join(root, v, "chrome-win", "chrome.exe"));
  }
}

function resolveChromiumPath() {
  const candidates = new Set();
  addCandidate(candidates, process.env.PUPPETEER_EXECUTABLE_PATH);
  addCandidate(candidates, process.env.CHROME_PATH);
  addPuppeteerCandidates(candidates);
  addPuppeteerCacheCandidates(candidates);
  addCommonOsCandidates(candidates);
  return [...candidates][0] || "";
}

function run() {
  const chromePath = resolveChromiumPath();
  if (!chromePath) {
    console.error("HATA: Chromium/Chrome yürütülebilir dosyası bulunamadı.");
    console.error("Çözüm: CHROME_PATH veya PUPPETEER_EXECUTABLE_PATH değişkenini geçerli bir dosya yoluna ayarlayın.");
    process.exit(1);
  }

  console.log(`Chromium bulundu: ${chromePath}`);

  const env = {
    ...process.env,
    A11Y_REQUIRE_CHROMIUM: "1",
    A11Y_COMPONENT_GATE: "1",
    CHROME_PATH: chromePath,
    PUPPETEER_EXECUTABLE_PATH: chromePath,
  };

  const testsEntry = path.join(__dirname, "..", "run-tests.js");
  const r = spawnSync(process.execPath, [testsEntry], { stdio: "inherit", env });
  process.exit(typeof r.status === "number" ? r.status : 1);
}

run();
