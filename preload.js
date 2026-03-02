const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("versions", {
  node:     () => process.versions.node,
  chrome:   () => process.versions.chrome,
  electron: () => process.versions.electron,
});

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Temel ──────────────────────────────────────────────────────────────
  selectFolder:    () => ipcRenderer.invoke("select-folder"),
  getFolderInfo:   (path) => ipcRenderer.invoke("get-folder-info", path),
  setTitleBarTheme:(theme) => ipcRenderer.invoke("set-titlebar-theme", theme),
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
  getRuleReliabilitySummary: () => ipcRenderer.invoke("get-rule-reliability-summary"),
  resetRuleReliabilitySummary: () => ipcRenderer.invoke("reset-rule-reliability-summary"),

  // ── Tarama ─────────────────────────────────────────────────────────────
  // scanProject() her zaman resolve eder, reject atmaz.
  // İptal edilmişse dönen nesne: { cancelled: true }
  scanProject: (path) => ipcRenderer.invoke("scan-project", path),

  // cancelScan() main.js'e "cancel-scan" IPC gönderir.
  // main.js token'ı iptal eder, browser'ı kapatır ve
  // { cancelled: true } döner.  Renderer bu sonucu bekleyebilir.
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),

  // ── Dışa aktarım ───────────────────────────────────────────────────────
  exportReport: (data) => ipcRenderer.invoke("export-report", data),

  // ── Tarama olayları ────────────────────────────────────────────────────
  onScanProgress: (cb) => ipcRenderer.on("scan-progress", (_, d) => cb(d)),
  onScanLog:      (cb) => ipcRenderer.on("scan-log",      (_, d) => cb(d)),
  onScanIssue:    (cb) => ipcRenderer.on("scan-issue",    (_, d) => cb(d)),
  removeScanListeners: () => {
    ipcRenderer.removeAllListeners("scan-progress");
    ipcRenderer.removeAllListeners("scan-log");
    ipcRenderer.removeAllListeners("scan-issue");
  },

  // ── Job state (debug / test) ───────────────────────────────────────────
  getJobState: () => ipcRenderer.invoke("get-job-state"),
});
