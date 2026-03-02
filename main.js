"use strict";

// ============================================================
// main.js  —  A11y Scanner v4
// PHASE 1: Job state machine + full cancellation
//
// State machine (one global job slot):
//   IDLE → STARTING → RUNNING → CANCELLING → CANCELLED | FAILED | COMPLETED
//
// Concurrency rules:
//   • Only one scan job may exist at a time.
//   • A second "scan-project" IPC while RUNNING triggers an
//     automatic cancel of the first job, then starts the new one.
//   • "cancel-scan" IPC during any non-IDLE state transitions to
//     CANCELLING and resolves both the cancel and scan Promises
//     cleanly within ~500 ms.
// ============================================================

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron/main");
const path = require("node:path");
const fs   = require("node:fs");
const { dedupeFindings } = require("./dedup");
const {
  buildExportPayload,
  buildCsvFromPayload,
  buildPdfHtmlFromPayload,
} = require("./exportSchema");
const {
  createEmptyStore,
  loadReliabilityStore,
  saveReliabilityStore,
  updateReliabilityStore,
  adaptFindingsByReliability,
  buildReliabilitySummary,
} = require("./reliability");

// ── Job state machine ─────────────────────────────────────────────────────────

const JobState = Object.freeze({
  IDLE       : "IDLE",
  STARTING   : "STARTING",
  RUNNING    : "RUNNING",
  CANCELLING : "CANCELLING",
  CANCELLED  : "CANCELLED",
  FAILED     : "FAILED",
  COMPLETED  : "COMPLETED",
});

class ScanJob {
  constructor(id) {
    this.id          = id;           // monotonically increasing integer
    this.state       = JobState.IDLE;
    // AbortController is the single cancellation source for this job.
    this.controller  = new AbortController();
    this.abortReason = null;
    // The browser reference is also stored so the cancel handler
    // can close it immediately without waiting for the scanner loop.
    // scanner.js sets this via the onBrowserOpen callback.
    this.browser     = null;
    this._doneResolve = null;
    this.donePromise = new Promise((resolve) => {
      this._doneResolve = resolve;
    });
  }

  setState(s) {
    if (this.isTerminal) return;
    this.state = s;
    if (this.isTerminal && this._doneResolve) this._doneResolve();
  }

  requestCancel(reason = "user_cancel") {
    this.abortReason = reason;
    if (this.state !== JobState.CANCELLING && !this.isTerminal) {
      this.state = JobState.CANCELLING;
    }
    if (!this.controller.signal.aborted) {
      this.controller.abort(reason);
    }
  }

  get isTerminal() {
    return (
      this.state === JobState.CANCELLED ||
      this.state === JobState.FAILED    ||
      this.state === JobState.COMPLETED
    );
  }
}

// Single global slot — only one job lives here at a time.
let _activeJob = null;
let _jobSeq    = 0;

function reliabilityStorePath() {
  return path.join(app.getPath("userData"), "rule-reliability.json");
}

function createJob() {
  const job = new ScanJob(++_jobSeq);
  _activeJob = job;
  return job;
}

// Immediately cancel the current job (if any) and wait for it to
// enter a terminal state.  Returns a Promise that resolves when the
// old job is fully done (≤ ~600 ms in practice).
async function cancelActiveJob(reason = "superseded") {
  const job = _activeJob;
  if (!job || job.isTerminal) return;

  job.requestCancel(reason);

  // Close the browser immediately — don't wait for the scanner loop
  // to notice the token.  This is the fast path that makes cancellation
  // feel instant to the user.
  if (job.browser) {
    await job.browser.close().catch(() => {});
    job.browser = null;
  }

  // Wait for terminal state. If runner gets stuck, force terminal state.
  const timeoutMs = 3000;
  let timer = null;
  try {
    await Promise.race([
      job.donePromise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!job.isTerminal) {
    job.setState(JobState.CANCELLED);
  }
}

// ── Window ────────────────────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width   : 1200,
    height  : 800,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#0b0f1a",
    titleBarStyle  : "hidden",
    titleBarOverlay: {
      color      : "#0b0f1a",
      symbolColor: "#8a94a6",
      height     : 38,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");
}

// ── Safe IPC sender ───────────────────────────────────────────────────────────
// Guards every mainWindow.webContents.send call against:
//   1. The window being destroyed (rapid close during scan).
//   2. The job having been superseded (stale events from old job).

function safeSend(jobId, channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!_activeJob || _activeJob.id !== jobId) return;    // stale job guard
  if (_activeJob.state === JobState.CANCELLING ||
      _activeJob.state === JobState.CANCELLED)  return;  // cancelled guard
  mainWindow.webContents.send(channel, payload);
}

// ── IPC: folder select ────────────────────────────────────────────────────────

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title      : "Proje Klasörünü Seç",
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ── IPC: folder info ──────────────────────────────────────────────────────────

ipcMain.handle("get-folder-info", async (_event, folderPath) => {
  try {
    const stats = { html:0, js:0, ts:0, jsx:0, tsx:0, vue:0, css:0, scss:0, total:0, sizeMB:0 };

    (function walk(dir) {
      try {
        for (const item of fs.readdirSync(dir)) {
          if (["node_modules",".git","dist","build"].includes(item)) continue;
          const full = path.join(dir, item);
          try {
            const s = fs.statSync(full);
            if (s.isDirectory()) { walk(full); continue; }
            const ext = path.extname(item).toLowerCase();
            stats.sizeMB += s.size;
            if ([".html",".htm"].includes(ext))          stats.html++;
            else if (ext === ".js")                       stats.js++;
            else if (ext === ".ts")                       stats.ts++;
            else if (ext === ".jsx")                      stats.jsx++;
            else if (ext === ".tsx")                      stats.tsx++;
            else if (ext === ".vue")                      stats.vue++;
            else if (ext === ".css")                      stats.css++;
            else if ([".scss",".sass"].includes(ext))     stats.scss++;
            if ([".html",".htm",".jsx",".tsx",".vue",
                 ".css",".scss",".sass",".js",".ts"].includes(ext)) stats.total++;
          } catch {}
        }
      } catch {}
    })(folderPath);

    stats.sizeMB = (stats.sizeMB / (1024 * 1024)).toFixed(1);
    return stats;
  } catch {
    return null;
  }
});

// ── IPC: scan-project ─────────────────────────────────────────────────────────
//
// Flow:
//   1. If a job is active, cancel it and wait for it to finish.
//   2. Create a new job, set state → STARTING.
//   3. Build AbortController signal, attach to job.
//   4. Set state → RUNNING, invoke scanProject().
//   5. On completion → COMPLETED; on cancel → CANCELLED; on error → FAILED.
//   6. Return result to renderer (always resolves, never rejects to renderer).

ipcMain.handle("scan-project", async (_event, folderPath) => {
  // Step 1 — tear down any active job
  await cancelActiveJob("superseded");

  // Step 2 — create fresh job
  const job = createJob();
  job.setState(JobState.STARTING);

  // Lazy-require scanner (allows hot-reload in dev without restart)
  const { scanProject } = require("./scanner");

  // Step 3 — use job signal for full cancellation propagation
  const signal = job.controller.signal;

  const jobId = job.id; // capture for safeSend closure

  // Step 4 — run
  job.setState(JobState.RUNNING);

  let result;
  try {
    result = await scanProject(
      folderPath,
      // onProgress
      (processed, total, file) => {
        safeSend(jobId, "scan-progress", { processed, total, file });
      },
      // onLog
      (msg, level) => {
        safeSend(jobId, "scan-log", { msg, level });
      },
      // onIssue
      (issue) => {
        safeSend(jobId, "scan-issue", issue);
      },
      // cancel signal
      signal,
      // onBrowserOpen — called by scanner.js as soon as browser is launched
      // so that the cancel handler can close it immediately
      (browser) => {
        if (_activeJob && _activeJob.id === jobId) {
          _activeJob.browser = browser;
        }
      },
    );
  } catch (err) {
    if (signal.aborted || err.code === "SCAN_CANCELLED") {
      job.setState(JobState.CANCELLED);
      return { cancelled: true, issues: [], totalFiles: 0, totalIssues: 0,
               technicalFindings: [], mediaCtx: {}, checklistResults: [] };
    }
    job.setState(JobState.FAILED);
    return { error: err.message, cancelled: false };
  }

  // Step 5 — determine terminal state
  if (result.cancelled || signal.aborted) {
    job.setState(JobState.CANCELLED);
    return { cancelled: true, issues: [], totalFiles: 0, totalIssues: 0,
             technicalFindings: [], mediaCtx: {}, checklistResults: [] };
  }

  job.setState(JobState.COMPLETED);

  const technicalFindings = Array.isArray(result.technicalFindings)
    ? result.technicalFindings
    : (result.issues || []);
  const dedup = dedupeFindings(technicalFindings);
  const dedupedFindings = dedup.uniqueFindings;

  const reliabilityPath = reliabilityStorePath();
  let reliabilityStore = loadReliabilityStore(reliabilityPath);
  reliabilityStore = updateReliabilityStore(reliabilityStore, dedupedFindings);
  const adaptation = adaptFindingsByReliability(dedupedFindings, reliabilityStore);
  const adaptedFindings = adaptation.adaptedFindings;
  saveReliabilityStore(reliabilityPath, reliabilityStore);
  const reliabilitySummary = buildReliabilitySummary(reliabilityStore);

  // Build checklist
  const { buildChecklistResults } = require("./checklist");
  const checklistResults = buildChecklistResults(
    adaptedFindings,
    result.mediaCtx || {}
  );

  return {
    cancelled      : false,
    technicalFindings: adaptedFindings,
    technicalFindingsRaw: technicalFindings,
    findingGroups: dedup.groups,
    dedupStats: dedup.stats,
    issues         : adaptedFindings, // backward-compat for renderer/export
    totalFiles     : result.totalFiles,
    totalIssues    : adaptedFindings.length,
    totalIssuesRaw : technicalFindings.length,
    mediaCtx       : result.mediaCtx || {},
    checklistResults,
    reliabilitySummary,
    reliabilityAdaptationStats: adaptation.stats,
  };
});

// ── IPC: cancel-scan ──────────────────────────────────────────────────────────
//
// Renderer calls this first, then removes its own listeners.
// We cancel the active job (token + browser close) and return
// { cancelled: true } once the job is in a terminal state.

ipcMain.handle("cancel-scan", async () => {
  if (!_activeJob || _activeJob.isTerminal) {
    return { cancelled: false, reason: "no_active_job" };
  }
  await cancelActiveJob("user_cancel");
  return { cancelled: true };
});

// ── IPC: export-report ────────────────────────────────────────────────────────

ipcMain.handle("export-report", async (_event, {
  format,
  issues,
  rawIssues,
  dedupStats,
  projectName,
  scanDate,
  checklistResults,
  findingGroups,
  mediaCtx,
  reliabilitySummary,
}) => {
  const ext         = format === "pdf" ? "pdf" : format === "json" ? "json" : "csv";
  const safeProject = (projectName || "proje").replace(/[^a-zA-Z0-9_-]/g, "-");
  const defaultName = `a11y-rapor-${safeProject}-${new Date().toISOString().slice(0, 10)}.${ext}`;

  const filterMap = {
    pdf : { name: "PDF",  extensions: ["pdf"]  },
    json: { name: "JSON", extensions: ["json"] },
    csv : { name: "CSV",  extensions: ["csv"]  },
  };

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title      : "Raporu Kaydet",
    defaultPath: defaultName,
    filters    : [filterMap[format] || filterMap.pdf],
  });

  if (canceled || !filePath) return { success: false };

  try {
    const payload = buildExportPayload({
      issues,
      rawIssues,
      dedupStats,
      projectName,
      scanDate,
      checklistResults,
      findingGroups,
      mediaCtx,
      reliabilitySummary,
    });

    // ── JSON ──────────────────────────────────────────────────────────────
    if (format === "json") {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");

    // ── CSV ───────────────────────────────────────────────────────────────
    } else if (format === "csv") {
      fs.writeFileSync(filePath, buildCsvFromPayload(payload), "utf-8");

    // ── PDF ───────────────────────────────────────────────────────────────
    } else if (format === "pdf") {
      let puppeteer;
      try      { puppeteer = require("puppeteer"); }
      catch    { try { puppeteer = require("puppeteer-core"); }
                 catch { return { success: false, error: "Puppeteer kurulu değil." }; } }
      const htmlContent = buildPdfHtmlFromPayload(payload);

      const launchOpts = {
        headless: "new",
        args    : ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      };
      try { const p = puppeteer.executablePath(); if (fs.existsSync(p)) launchOpts.executablePath = p; } catch {}

      const pdfBrowser = await puppeteer.launch(launchOpts);
      const page       = await pdfBrowser.newPage();
      await page.setContent(htmlContent, { waitUntil: "load" });
      await page.pdf({ path: filePath, format: "A4", printBackground: true,
                       margin: { top: "20px", bottom: "20px", left: "0", right: "0" } });
      await pdfBrowser.close();
    }

    shell.showItemInFolder(filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: open-external-url ────────────────────────────────────────────────────

ipcMain.handle("open-external-url", async (_event, url) => {
  if (url && (url.startsWith("https://") || url.startsWith("http://"))) {
    shell.openExternal(url);
  }
});

// ── IPC: set-titlebar-theme ───────────────────────────────────────────────────

ipcMain.handle("set-titlebar-theme", (_event, theme) => {
  if (!mainWindow) return;
  if (theme === "light") {
    mainWindow.setTitleBarOverlay({ color: "#ffffff", symbolColor: "#5a6170" });
  } else {
    mainWindow.setTitleBarOverlay({ color: "#0b0f1a", symbolColor: "#8a94a6" });
  }
});

ipcMain.handle("get-rule-reliability-summary", () => {
  const store = loadReliabilityStore(reliabilityStorePath());
  return buildReliabilitySummary(store);
});

ipcMain.handle("reset-rule-reliability-summary", () => {
  const fp = reliabilityStorePath();
  const empty = createEmptyStore();
  saveReliabilityStore(fp, empty);
  return buildReliabilitySummary(empty);
});

// ── IPC: get-job-state (for debugging / tests) ────────────────────────────────

ipcMain.handle("get-job-state", () => {
  if (!_activeJob) return { state: JobState.IDLE, id: null };
  return { state: _activeJob.state, id: _activeJob.id };
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Cancel any running scan before quitting — prevents orphaned Chromium
  cancelActiveJob("app_quit").then(() => {
    if (process.platform !== "darwin") app.quit();
  });
});
