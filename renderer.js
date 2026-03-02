// ============================================
// A11y Scanner — Renderer (PHASE 1: IPC cancel)
// ============================================

// --- STATE ---
let currentFolder = null;
let folderStats = null;
let scanRunning = false;
let mockIssues = [];
let rawIssues = [];
let findingGroups = [];
let dedupStats = { rawCount: 0, uniqueCount: 0, duplicateCount: 0 };
let checklistResults = [];
let mediaCtx = {};
let reliabilitySummary = null;
let currentFilter = "all";
let currentPage = 0;
const ISSUES_PER_PAGE = 8;
let _lastFocusBeforeModal = null;
const MANUAL_CHECKLIST_STORAGE_KEY = "a11y-manual-checklist-v1";

// Ayarlar state
let settings = {
  theme: "dark",
  terminalLines: 100,
  exportFormat: "pdf",
};

// localStorage'den ayarları yükle
function loadSettings() {
  try {
    const saved = localStorage.getItem("a11y-settings");
    if (saved) settings = { ...settings, ...JSON.parse(saved) };
  } catch {}
}

function saveSettings() {
  try { localStorage.setItem("a11y-settings", JSON.stringify(settings)); } catch {}
}

loadSettings();

function setScanHeadline(text) {
  const el = document.querySelector("#scan-status h1");
  if (el) el.textContent = text;
}

function deriveManualStatus(answer, expectedAnswer) {
  if (answer === "yes") return expectedAnswer === "Yes" ? "pass" : "fail";
  if (answer === "no") return expectedAnswer === "No" ? "pass" : "fail";
  return "na";
}

function loadManualChecklistStore() {
  try {
    const raw = localStorage.getItem(MANUAL_CHECKLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveManualChecklistStore(store) {
  try {
    localStorage.setItem(MANUAL_CHECKLIST_STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

function getCurrentProjectManualState() {
  if (!currentFolder) return {};
  const store = loadManualChecklistStore();
  return (store && store[currentFolder]) || {};
}

function persistManualChecklistState() {
  if (!currentFolder || !Array.isArray(checklistResults) || checklistResults.length === 0) return;
  const store = loadManualChecklistStore();
  const projectState = {};

  for (const q of checklistResults) {
    const kontrol = String(q.kontrolTuru || "").toLowerCase();
    const manualType = q.autoOrManual === "manual" || kontrol === "manüel" || kontrol === "manuel";
    if (!manualType) continue;

    const hasAnswer = typeof q.manualAnswer === "string" && q.manualAnswer.length > 0;
    const hasNote = typeof q.manualNote === "string" && q.manualNote.trim().length > 0;
    if (!hasAnswer && !hasNote) continue;

    projectState[q.id] = {
      manualAnswer: hasAnswer ? q.manualAnswer : null,
      manualNote: hasNote ? q.manualNote : "",
    };
  }

  store[currentFolder] = projectState;
  saveManualChecklistStore(store);
}

function applyPersistedManualChecklistState() {
  const projectState = getCurrentProjectManualState();
  if (!projectState || !checklistResults.length) return;

  for (const q of checklistResults) {
    const saved = projectState[q.id];
    if (!saved) continue;

    if (saved.manualAnswer) {
      q.manualAnswer = saved.manualAnswer;
      q.finalStatus = deriveManualStatus(saved.manualAnswer, q.expectedAnswer);
      q.status = q.finalStatus;
    }
    if (typeof saved.manualNote === "string") {
      q.manualNote = saved.manualNote;
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getVisibleReportIssues() {
  return (mockIssues || []).filter((i) =>
    i.source !== "runtime-infra" &&
    i.rule !== "runtime-scenario-failure" &&
    String(i.status || "").toUpperCase() !== "N/A"
  );
}

// --- NAV ---
const navBtns = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");

function navigateTo(page) {
  navBtns.forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  navBtns.forEach((b) => {
    if (b.dataset.page === page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  pages.forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
  pages.forEach((p) => p.setAttribute("aria-hidden", p.id === `page-${page}` ? "false" : "true"));
  const pageTitles = {
    projects: "Projeler — Erişilebilirlik Denetleyici",
    scan: "Tarama — Erişilebilirlik Denetleyici",
    report: "Rapor — Erişilebilirlik Denetleyici",
    checklist: "Kontrol Listesi — Erişilebilirlik Denetleyici",
    settings: "Ayarlar — Erişilebilirlik Denetleyici",
  };
  document.title = pageTitles[page] || "Erişilebilirlik Denetleyici";
}

navBtns.forEach((btn) => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.page));
});
navigateTo("projects");

// --- ABOUT ---
document.getElementById("about-electron").textContent = window.versions.electron();
document.getElementById("about-node").textContent = window.versions.node();
document.getElementById("about-chrome").textContent = window.versions.chrome();

// --- TOAST ---
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
  toast.setAttribute("aria-live", type === "error" || type === "warning" ? "assertive" : "polite");
  const icons = { info: "\u2139", success: "\u2713", error: "\u2715", warning: "\u26a0" };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || "\u2139"}</span>${msg}`;
  container.appendChild(toast);
  announceStatus(msg, type === "error" || type === "warning" ? "alert" : "status");
  setTimeout(() => toast.remove(), 3500);
}

function announceStatus(msg, mode = "status") {
  const id = mode === "alert" ? "sr-alert" : "sr-status";
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = msg; }, 20);
}

// --- FOLDER SELECT ---
document.getElementById("browse-btn").addEventListener("click", selectFolder);
document.getElementById("change-folder-btn").addEventListener("click", selectFolder);

async function selectFolder() {
  const path = await window.electronAPI.selectFolder();
  if (!path) return;
  currentFolder = path;

  const name = path.split("\\").pop().split("/").pop();
  document.getElementById("project-name").textContent = name;
  document.getElementById("project-path").textContent = path;

  folderStats = await window.electronAPI.getFolderInfo(path);
  const statsEl = document.getElementById("project-stats");

  if (folderStats) {
    statsEl.innerHTML = `
      <div class="stat-chip"><span class="stat-num">${folderStats.html}</span><span class="stat-lbl">HTML</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.js}</span><span class="stat-lbl">JS</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.ts || 0}</span><span class="stat-lbl">TS</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.jsx}</span><span class="stat-lbl">JSX</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.tsx}</span><span class="stat-lbl">TSX</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.vue}</span><span class="stat-lbl">Vue</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.css + folderStats.scss}</span><span class="stat-lbl">CSS/SCSS</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.total}</span><span class="stat-lbl">Toplam</span></div>
      <div class="stat-chip"><span class="stat-num">${folderStats.sizeMB}</span><span class="stat-lbl">MB</span></div>
    `;
  }

  document.getElementById("drop-zone").classList.add("hidden");
  document.getElementById("selected-project").classList.remove("hidden");
}

// --- START SCAN ---
document.getElementById("start-scan-btn").addEventListener("click", startScan);
document.getElementById("cancel-scan-btn").addEventListener("click", cancelScan);

async function startScan() {
  if (!currentFolder) return;
  scanRunning = true;
  navigateTo("scan");
  setScanHeadline("Taranıyor...");

  document.getElementById("scan-project-label").textContent = currentFolder;

  // Reset UI
  document.getElementById("progress-bar").style.width = "0%";
  document.getElementById("progress-bar").setAttribute("aria-valuenow", "0");
  document.getElementById("progress-pct").textContent = "0%";
  document.getElementById("progress-files").textContent = `0 / ${folderStats ? folderStats.total : "?"} dosya islendi`;
  document.getElementById("progress-eta").textContent = "Tahmini: hesaplaniyor...";
  document.getElementById("scanned-html").textContent = "0";
  document.getElementById("scanned-jsx").textContent = "0";
  document.getElementById("scanned-css").textContent = "0";
  document.getElementById("scanned-issues").textContent = "0";
  document.getElementById("cancel-scan-btn").disabled = false;
  document.getElementById("cancel-scan-btn").innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    Taramayi Iptal Et`;

  mockIssues = [];
  rawIssues = [];
  findingGroups = [];
  dedupStats = { rawCount: 0, uniqueCount: 0, duplicateCount: 0 };

  // Terminal
  const termBody = document.getElementById("terminal-body");
  const maxLines = parseInt(settings.terminalLines) || 100;

  function addLog(text, type = "info") {
    const line = document.createElement("div");
    line.className = `log-line log-${type}`;
    line.innerHTML = `<span class="log-prefix">&gt; </span>${text}`;
    termBody.appendChild(line);

    const allLines = termBody.querySelectorAll(".log-line");
    if (allLines.length > maxLines) allLines[0].remove();

    termBody.scrollTop = termBody.scrollHeight;
  }

  addLog("WCAG 2.2 Level A kontrol listesi yukleniyor...", "info");
  addLog("31 kriter - 122 kontrol sorusu hazir.", "success");
  addLog(`Proje taranmaya baslanıyor: ${currentFolder}`, "info");
  announceStatus("Tarama başlatıldı.", "status");

  let scannedHtml = 0, scannedJsx = 0, scannedCss = 0;
  const scanStartTime = Date.now();
  let lastAnnouncedPct = -10;

  window.electronAPI.removeScanListeners();

  window.electronAPI.onScanProgress(({ processed, total, file }) => {
    const pct = Math.min(100, Math.round((processed / total) * 100));
    document.getElementById("progress-bar").style.width = pct + "%";
    document.getElementById("progress-bar").setAttribute("aria-valuenow", String(pct));
    document.getElementById("progress-pct").textContent = pct + "%";
    document.getElementById("progress-files").textContent = `${processed} / ${total} dosya islendi`;

    const elapsed = (Date.now() - scanStartTime) / 1000;
    const rate = processed / Math.max(elapsed, 0.1);
    const remaining = Math.max(0, Math.round((total - processed) / rate));
    document.getElementById("progress-eta").textContent = remaining > 0 ? `Tahmini: ~${remaining}s` : "Tamamlaniyor...";

    if (file.match(/\.(html|htm)$/i)) { scannedHtml++; document.getElementById("scanned-html").textContent = scannedHtml; }
    else if (file.match(/\.(jsx|tsx)$/i)) { scannedJsx++; document.getElementById("scanned-jsx").textContent = scannedJsx; }
    else if (file.match(/\.(css|scss|sass)$/i)) { scannedCss++; document.getElementById("scanned-css").textContent = scannedCss; }

    if (pct >= lastAnnouncedPct + 25) {
      lastAnnouncedPct = pct;
      announceStatus(`Tarama ilerlemesi yüzde ${pct}.`, "status");
    }
  });

  window.electronAPI.onScanLog(({ msg, level }) => {
    if (msg) addLog(msg, level === "error" ? "error" : level === "warn" ? "warn" : "info");
  });

  window.electronAPI.onScanIssue((issue) => {
    mockIssues.push(issue);
    document.getElementById("scanned-issues").textContent = mockIssues.length;
  });

  try {
    const result = await window.electronAPI.scanProject(currentFolder);

    // ── PHASE 1: iptal edilmisse scanProject { cancelled:true } dondurur ──
    // cancelScan() zaten UI'i guncelledi; burada sadece cikmak yeterli.
    if (result && result.cancelled) {
      scanRunning = false;
      window.electronAPI.removeScanListeners();
      setScanHeadline("Tarama iptal edildi");
      return;
    }

    scanRunning = false;
    window.electronAPI.removeScanListeners();

    // Backend returns deduped findings for scoring/reporting and preserves raw set.
    mockIssues = (result.issues || result.technicalFindings || []);
    rawIssues = (result.technicalFindingsRaw || mockIssues);
    findingGroups = Array.isArray(result.findingGroups) ? result.findingGroups : [];
    dedupStats = result.dedupStats || {
      rawCount: rawIssues.length,
      uniqueCount: mockIssues.length,
      duplicateCount: Math.max(0, rawIssues.length - mockIssues.length),
    };

    checklistResults = result.checklistResults || [];
    applyPersistedManualChecklistState();
    mediaCtx = result.mediaCtx || {};
    reliabilitySummary = result.reliabilitySummary || reliabilitySummary;
    renderReliabilityPanel(reliabilitySummary);

    addLog("", "info");
    addLog("===================================================", "info");
    addLog(`Tarama tamamlandi. ${result.totalFiles} dosya, ${result.totalIssues} benzersiz sorun.`, "success");
    addLog(`Dedup: ham ${dedupStats.rawCount} -> benzersiz ${dedupStats.uniqueCount} (tekrar ${dedupStats.duplicateCount})`, "info");
    if (result.reliabilityAdaptationStats && result.reliabilityAdaptationStats.adaptedCount > 0) {
      const s = result.reliabilityAdaptationStats;
      addLog(
        `Güvenilirlik uyarlaması: ${s.adaptedCount} bulgu yumuşatıldı (uyarı->inceleme ${s.warningToReview}, fail->uyarı ${s.failToWarning}).`,
        "warn"
      );
    }

    const autoFails  = checklistResults.filter(q => q.status === "fail").length;
    const autoPasses = checklistResults.filter(q => q.status === "pass").length;
    const manuals    = checklistResults.filter(q => q.status === "manual").length;
    addLog(`Kontrol listesi: UYGUN ${autoPasses} geçti | UYGUNSUZ ${autoFails} kaldı | ? ${manuals} manuel`, "info");

    if (mediaCtx.hasVideo) addLog("Video tespit edildi - WCAG 1.2.2 kontrol listesi etkin", "info");
    if (mediaCtx.hasAudio) addLog("Ses tespit edildi - WCAG 1.2.1 kontrol listesi etkin", "info");
    if (mediaCtx.hasCaptcha) addLog("CAPTCHA tespit edildi - Manuel dogrulama gerekli", "warn");
    if (mediaCtx.hasCanvas) addLog("Canvas tespit edildi - WCAG 4.1.2 kontrol aktif", "info");

    document.getElementById("progress-eta").textContent = "Tamamlandi OK";
    setScanHeadline("Tarama tamamlandı");
    document.getElementById("progress-bar").style.width = "100%";
    document.getElementById("progress-bar").setAttribute("aria-valuenow", "100");
    document.getElementById("progress-pct").textContent = "100%";
    document.getElementById("cancel-scan-btn").disabled = true;
    document.getElementById("cancel-scan-btn").innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      Tarama Tamamlandi`;

    setTimeout(() => {
      showToast(`Tarama tamamlandi! ${result.totalIssues} sorun bulundu.`, result.totalIssues > 0 ? "warning" : "success");
      announceStatus(`Tarama tamamlandı. ${result.totalIssues} benzersiz sorun bulundu.`, "status");
      buildReport();
      buildChecklist();
      navigateTo("report");
      addToRecent();
    }, 1200);
  } catch (err) {
    scanRunning = false;
    window.electronAPI.removeScanListeners();
    setScanHeadline("Tarama hatası");
    addLog(`Tarama hatasi: ${err.message}`, "error");
    showToast("Tarama sirasinda hata olustu.", "error");
    document.getElementById("cancel-scan-btn").disabled = false;
  }
}

// ── PHASE 1: Tam IPC cancel ────────────────────────────────────────────────
//
// Akis:
//   1. UI butonu aninda devre disi birak (kac tiklama engeli)
//   2. main.js'e cancel-scan IPC gonder
//      -> main.js token.cancel() + browser.close() yapar (~<500 ms)
//   3. scanRunning = false + listener temizle
//   4. Terminal logu + toast + UI guncelle
//
async function cancelScan() {
  if (!scanRunning) return;

  // 1. Buton hemen disable — cift tiklama engeli
  const cancelBtn = document.getElementById("cancel-scan-btn");
  cancelBtn.disabled = true;
  cancelBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    Iptal ediliyor...`;

  // 2. main.js'e IPC gonder — token set + browser kapat
  try {
    await window.electronAPI.cancelScan();
  } catch {}

  // 3. State + listener temizle
  scanRunning = false;
  window.electronAPI.removeScanListeners();

  // 4. Terminal + UI
  const termBody = document.getElementById("terminal-body");
  const logLine = document.createElement("div");
  logLine.className = "log-line log-warn";
  logLine.innerHTML = `<span class="log-prefix">&gt; </span>Tarama kullanici tarafindan iptal edildi.`;
  termBody.appendChild(logLine);

  showToast("Tarama iptal edildi.", "warning");
  announceStatus("Tarama kullanıcı tarafından iptal edildi.", "alert");
  setScanHeadline("Tarama iptal edildi");
  document.getElementById("progress-eta").textContent = "Iptal edildi";
  navigateTo("projects");
}

// --- REPORT ---
let lastScanDate = "";

function buildReport() {
  const visibleIssues = getVisibleReportIssues();
  const criticalCount = visibleIssues.filter((i) => i.severity === "critical").length;
  const warningCount = visibleIssues.filter((i) => i.severity === "warning").length;
  const reviewCount = visibleIssues.filter((i) => i.severity === "review").length;
  const passedCount = Math.max(0, (folderStats?.total || 50) * 2 - visibleIssues.length);

  document.getElementById("count-critical").textContent = criticalCount;
  document.getElementById("count-warning").textContent = warningCount;
  document.getElementById("count-review").textContent = reviewCount;
  document.getElementById("count-passed").textContent = passedCount;

  const name = currentFolder.split("\\").pop().split("/").pop();
  const now = new Date();
  lastScanDate = now.toLocaleString("tr-TR");

  document.getElementById("report-id").textContent = `Tarama Kimliği: #${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  document.getElementById("report-subtitle").textContent = `Proje: ${name} | Son tarama: ${now.toLocaleTimeString("tr-TR")}`;

  buildReportTypeBand();

  const score = Math.max(0, Math.min(100, Math.round(100 - (criticalCount * 4) - (warningCount * 2) - reviewCount)));
  const scoreEl = document.getElementById("accessibility-score");
  if (scoreEl) {
    scoreEl.textContent = score + "%";
    scoreEl.style.color = score >= 80 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--critical)";
  }

  currentPage = 0;
  currentFilter = "all";
  document.querySelectorAll(".filter-tab:not(.cl-filter-tab)").forEach((t) => t.classList.toggle("active", t.dataset.filter === "all"));
  document.getElementById("issue-search").value = "";
  renderIssues();
}

function buildReportTypeBand() {
  const band = document.getElementById("report-type-band");
  if (!band) return;

  const visibleIssues = getVisibleReportIssues();
  const axeIssues    = visibleIssues.filter(i => i.source === "axe-core");
  const staticIssues = visibleIssues.filter(i => i.source === "static");
  const manualItems  = checklistResults ? checklistResults.filter(q => q.status === "manual") : [];
  const manualDone   = manualItems.filter(q => q.manualAnswer !== null);

  band.innerHTML = `
    <div class="rtb-item rtb-auto" title="axe-core DOM + statik kod analizi ile tespit edilen sorunlar">
      <span class="rtb-icon">&#9889;</span>
      <div>
        <strong>${axeIssues.length}</strong> otomatik (axe-core)
        <small>+ ${staticIssues.length} statik analiz</small>
      </div>
      <span class="rtb-label rtb-high">${axeIssues.length > 0 ? "Yüksek Güven" : "Temiz"}</span>
    </div>
    <div class="rtb-sep">|</div>
    <div class="rtb-item rtb-manual" title="Durumu manuel olan kontrol listesi soruları">
      <span class="rtb-icon">&#9997;</span>
      <div>
        <strong>${manualItems.length}</strong> manuel durum
        <small>${manualDone.length}/${manualItems.length} yanitlandi</small>
      </div>
      <span class="rtb-label rtb-manual-lbl">Inceleme Gerekli</span>
    </div>
    <div class="rtb-sep">|</div>
    <div class="rtb-item rtb-partial" title="Kismi inceleme">
      <span class="rtb-icon">&#9681;</span>
      <div>
        <strong>${visibleIssues.filter(i => i.severity === "review").length}</strong> kismi inceleme
        <small>review seviyesi</small>
      </div>
      <span class="rtb-label rtb-partial-lbl">Kismi</span>
    </div>
    ${checklistResults && checklistResults.length ? `
    <button class="rtb-checklist-btn" id="report-open-checklist-btn" type="button">
      Kontrol Listesini Aç &rarr; ${checklistResults.filter(q=>q.status==='fail').length} sorun
    </button>` : ""}
  `;

  const openChecklistBtn = document.getElementById("report-open-checklist-btn");
  if (openChecklistBtn) {
    openChecklistBtn.addEventListener("click", () => navigateTo("checklist"));
  }
}

function renderIssues() {
  const displayIssues = getVisibleReportIssues();
  let filtered = displayIssues;
  if (currentFilter !== "all") {
    filtered = displayIssues.filter((i) => i.severity === currentFilter);
  }

  const searchVal = document.getElementById("issue-search").value.toLowerCase();
  if (searchVal) {
    filtered = filtered.filter((i) =>
      (i.rule || "").includes(searchVal) ||
      (i.file || "").includes(searchVal) ||
      (i.title || "").toLowerCase().includes(searchVal) ||
      (i.wcag || "").includes(searchVal)
    );
  }

  const start = currentPage * ISSUES_PER_PAGE;
  const pageItems = filtered.slice(start, start + ISSUES_PER_PAGE);

  const list = document.getElementById("issues-list");
  list.innerHTML = "";

  if (pageItems.length === 0) {
    list.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted);">
      ${filtered.length === 0 && currentFilter !== "all" ? "Bu seviyede sorun bulunamadi" : "Sonuc bulunamadi."}
    </div>`;
  } else {
    pageItems.forEach((issue) => {
      const row = document.createElement("div");
      row.className = "issue-row";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", `${issue.severity || "durum"} seviye, ${issue.rule || "kural"}, dosya ${issue.file || "-"}`);
      const severity = issue.severity === "critical" ? "critical"
        : issue.severity === "warning" ? "warning"
          : "review";
      const severityLabel = severity === "critical" ? "Kritik" : severity === "warning" ? "Uyarı" : "İnceleme";
      const ruleName = escapeHtml((issue.rule || "").replace(/^[\d.]+-/, ""));
      const wcagText = escapeHtml(issue.wcag || "");
      const fileText = escapeHtml(issue.file || "—");
      const lineText = escapeHtml(issue.line || "—");
      const source = issue.source === "axe-core" ? `<span class="source-badge axe">dinamik</span>` : `<span class="source-badge static">statik</span>`;
      const dupInfo = issue.dedup && issue.dedup.duplicateCount > 1
        ? `<span class="source-badge static">x${escapeHtml(issue.dedup.duplicateCount)}</span>`
        : "";
      row.innerHTML = `
        <span><span class="severity-badge ${severity}">${severityLabel}</span></span>
        <span class="issue-rule"><span class="wcag-num">${wcagText}</span> ${ruleName} ${source} ${dupInfo}</span>
        <span class="issue-file">${fileText}</span>
        <span class="issue-line">S: ${lineText}</span>
        <span class="issue-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>
      `;
      row.addEventListener("click", () => openDetail(issue));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail(issue);
        }
      });
      list.appendChild(row);
    });
  }

  const endIdx = Math.min(start + ISSUES_PER_PAGE, filtered.length);
  document.getElementById("issues-count-label").textContent =
    filtered.length > 0 ? `${start + 1}\u2013${endIdx} / ${filtered.length} sonuc` : "0 sonuc";

  document.getElementById("prev-page").disabled = currentPage === 0;
  document.getElementById("next-page").disabled = (currentPage + 1) * ISSUES_PER_PAGE >= filtered.length;
}

document.querySelectorAll(".filter-tab:not(.cl-filter-tab)").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab:not(.cl-filter-tab)").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.filter;
    currentPage = 0;
    renderIssues();
  });
});

document.getElementById("issue-search").addEventListener("input", () => {
  currentPage = 0;
  renderIssues();
});

document.getElementById("prev-page").addEventListener("click", () => {
  if (currentPage > 0) { currentPage--; renderIssues(); }
});

document.getElementById("next-page").addEventListener("click", () => {
  const displayIssues = getVisibleReportIssues();
  const filtered = currentFilter === "all" ? displayIssues : displayIssues.filter((i) => i.severity === currentFilter);
  if ((currentPage + 1) * ISSUES_PER_PAGE < filtered.length) { currentPage++; renderIssues(); }
});

// --- DETAIL PANEL ---
function openDetail(issue) {
  const panel = document.getElementById("detail-panel");
  panel.classList.remove("hidden");

  const badge = document.getElementById("detail-badge");
  badge.textContent = issue.severity === "critical" ? "KRİTİK" : issue.severity === "warning" ? "UYARI" : "İNCELEME";
  badge.className = "detail-badge";
  if (issue.severity === "warning") badge.classList.add("warning-badge");
  if (issue.severity === "review") badge.classList.add("review-badge");

  document.getElementById("detail-rule-name").textContent = `WCAG ${issue.wcag || "?"} \u2014 ${issue.rule || ""}`;
  document.getElementById("detail-title").textContent = issue.title || "\u2014";
  document.getElementById("detail-description").textContent = issue.desc || "\u2014";
  document.getElementById("detail-file").textContent = issue.file || "\u2014";
  document.getElementById("detail-line").textContent = issue.line ? `Satir ${issue.line}` : "\u2014";

  const wcagLink = document.getElementById("detail-wcag-link");
  if (issue.wcag) {
    wcagLink.href = "#";
    wcagLink.onclick = (e) => {
      e.preventDefault();
      window.electronAPI.openExternalUrl(`https://www.w3.org/WAI/WCAG21/Understanding/${getWcagSlug(issue.wcag)}`);
    };
    wcagLink.style.display = "inline-block";
  } else if (issue.fix && issue.fix.startsWith("https://")) {
    wcagLink.href = "#";
    wcagLink.onclick = (e) => {
      e.preventDefault();
      window.electronAPI.openExternalUrl(issue.fix);
    };
    wcagLink.style.display = "inline-block";
  } else {
    wcagLink.style.display = "none";
    wcagLink.onclick = null;
  }

  const codeBlock = document.getElementById("detail-code");
  const lineNum = issue.line || 0;

  if (issue.lineContent && issue.lineContent.trim()) {
    const escaped = issue.lineContent.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    codeBlock.innerHTML = `<span class="line-highlight"><span class="line-num">${lineNum || "?"}</span>  ${escaped}</span>`;
  } else if ((issue.file || "").trim() === "(proje geneli)") {
    codeBlock.textContent = "Bu bulgu belirli bir satırdan değil, proje genelindeki desenlerden üretildi.";
  } else {
    const sampleCode = getSampleCode(issue.rule);
    codeBlock.innerHTML = `<span class="line-num">${lineNum > 1 ? lineNum - 1 : ""}</span>  ${sampleCode.before}\n<span class="line-highlight"><span class="line-num">${lineNum || "?"}</span>  ${sampleCode.error}</span><span class="line-num">${lineNum ? lineNum + 1 : ""}</span>  ${sampleCode.after}`;
  }

  const fixText = issue.fix || "";
  const deterministicPatch = buildDeterministicPatch(issue);
  const displayFix = deterministicPatch || (fixText.startsWith("https://")
    ? "\u2014 axe-core detaylari icin WCAG linkine bakin."
    : (fixText || getFallbackFixText(issue)));
  document.getElementById("detail-fix").textContent = displayFix;
  let note = issue.fixNote || "\u2014";
  if (deterministicPatch) {
    note = `${note === "\u2014" ? "" : note + " | "}Satır-bazlı öneri otomatik üretildi.`.trim();
  }
  if (issue.dedup && issue.dedup.duplicateCount > 1) {
    note += ` | Tekrarlanan kök bulgu: ${issue.dedup.duplicateCount} kez (grup ${issue.dedup.groupId})`;
  }
  document.getElementById("detail-fix-note").textContent = note;

  let sourceInfo = document.getElementById("detail-source-info");
  if (!sourceInfo) {
    sourceInfo = document.createElement("div");
    sourceInfo.id = "detail-source-info";
    sourceInfo.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:8px;";
    document.getElementById("detail-fix-note").after(sourceInfo);
  }
  sourceInfo.textContent = issue.source === "axe-core"
    ? "axe-core DOM analizi ile tespit edildi"
    : "Statik kod analizi ile tespit edildi";

  setTimeout(() => {
    const closeBtn = document.getElementById("detail-close");
    if (closeBtn) closeBtn.focus();
  }, 50);
}

function closeDetail() {
  document.getElementById("detail-panel").classList.add("hidden");
}

function getWcagSlug(wcag) {
  const slugs = {
    "1.1.1": "non-text-content", "1.2.1": "audio-only-and-video-only-prerecorded",
    "1.2.2": "captions-prerecorded", "1.2.3": "audio-description-or-media-alternative-prerecorded",
    "1.3.1": "info-and-relationships", "1.3.2": "meaningful-sequence",
    "1.3.3": "sensory-characteristics", "1.4.1": "use-of-color",
    "1.4.2": "audio-control", "2.1.1": "keyboard",
    "2.1.2": "no-keyboard-trap", "2.1.4": "character-key-shortcuts",
    "2.2.1": "timing-adjustable", "2.2.2": "pause-stop-hide",
    "2.3.1": "three-flashes-or-below-threshold", "2.4.1": "bypass-blocks",
    "2.4.2": "page-titled", "2.4.3": "focus-order",
    "2.4.4": "link-purpose-in-context", "2.5.1": "pointer-gestures",
    "2.5.2": "pointer-cancellation", "2.5.3": "label-in-name",
    "2.5.4": "motion-actuation", "3.1.1": "language-of-page",
    "3.2.1": "on-focus", "3.2.2": "on-input",
    "3.2.6": "consistent-help", "3.3.1": "error-identification",
    "3.3.2": "labels-or-instructions", "3.3.7": "redundant-entry",
    "4.1.2": "name-role-value",
  };
  return slugs[wcag] || "";
}

function getSampleCode(rule) {
  const codes = {
    "1.1.1-image-alt": { before: '&lt;div className="logo"&gt;', error: '  &lt;img src="/logo.png" /&gt;', after: "&lt;/div&gt;" },
    "1.2.2-video-captions": { before: '&lt;video controls&gt;', error: '  &lt;source src="video.mp4" /&gt;', after: "&lt;/video&gt;" },
    "1.3.1-heading-semantic": { before: '&lt;div class="section"&gt;', error: '  &lt;div class="big-bold"&gt;Baslik&lt;/div&gt;', after: "&lt;/div&gt;" },
    "2.1.1-keyboard": { before: '&lt;div class="card"&gt;', error: '  &lt;div onclick="open()"&gt;Detay&lt;/div&gt;', after: "&lt;/div&gt;" },
    "2.4.1-skip-link": { before: '&lt;body&gt;', error: '  &lt;nav&gt;...20 link...&lt;/nav&gt;', after: "  &lt;main&gt;...&lt;/main&gt;" },
    "2.4.2-page-title": { before: '&lt;head&gt;', error: '  &lt;title&gt;&lt;/title&gt;', after: "&lt;/head&gt;" },
    "2.4.4-link-purpose": { before: '&lt;p&gt;Haber icin', error: '  &lt;a href="/haber/123"&gt;tiklayin&lt;/a&gt;', after: "&lt;/p&gt;" },
    "3.1.1-html-lang": { before: '&lt;!DOCTYPE html&gt;', error: '&lt;html&gt;', after: "&lt;head&gt;..." },
    "3.3.1-error-identification": { before: '&lt;form&gt;', error: '  &lt;input class="error" /&gt;', after: "&lt;/form&gt;" },
    "3.3.2-form-label": { before: '&lt;div class="form-group"&gt;', error: '  &lt;input type="email" placeholder="Email" /&gt;', after: "&lt;/div&gt;" },
    "4.1.2-name-role-value": { before: '&lt;div class="dropdown"&gt;', error: '  &lt;div onclick="toggle()"&gt;Secin&lt;/div&gt;', after: "&lt;/div&gt;" },
    "4.1.2-iframe-title": { before: '&lt;div class="embed"&gt;', error: '  &lt;iframe src="harita.html"&gt;&lt;/iframe&gt;', after: "&lt;/div&gt;" },
    "focus-outline-removed": { before: ':focus {', error: '  outline: none;', after: "}" },
    "reduced-motion-missing": { before: '@keyframes slide {', error: '  from { transform: translateX(0) }', after: "}" },
    "interactive-role-missing": { before: '&lt;div class="card"&gt;', error: '  &lt;div onClick={fn}&gt;Icerik&lt;/div&gt;', after: "&lt;/div&gt;" },
    "keyboard-focus-missing": { before: '&lt;div class="btn"', error: '  onClick={fn}&gt;Tikla&lt;/div&gt;', after: "" },
    "live-region-missing": { before: '&lt;div className="toast"&gt;', error: '  Mesaj icerigi', after: "&lt;/div&gt;" },
    "modal-role-missing": { before: '&lt;div className="modal"&gt;', error: '  &lt;div className="modal-content"&gt;', after: "  &lt;/div&gt;&lt;/div&gt;" },
    "skip-link-missing": { before: '&lt;body&gt;', error: '  &lt;header&gt;...nav...&lt;/header&gt;', after: "  &lt;main&gt;...&lt;/main&gt;" },
    "html-lang-missing": { before: '&lt;!DOCTYPE html&gt;', error: '&lt;html&gt;', after: "&lt;head&gt;..." },
  };
  return codes[rule] || { before: "...", error: "  &lt;!-- hatali satir --&gt;", after: "..." };
}

function getFallbackFixText(issue) {
  const rule = String(issue.rule || "");
  if (rule.startsWith("custom-menu-pattern")) return "Menü için semantic nav/ul/li veya tam ARIA menu pattern (menu/menuitem) + klavye davranışı uygulayın.";
  if (rule.startsWith("custom-modal-focus-management")) return "Modal açıldığında odak içeriye alınmalı, Tab modal içinde dolaşmalı, kapanınca tetikleyiciye dönmelidir.";
  if (rule.startsWith("custom-tabs-pattern")) return "Tabs için role=tablist/tab/tabpanel, aria-selected ve klavye ok tuşu davranışı ekleyin.";
  if (rule.startsWith("custom-dropdown-a11y")) return "Dropdown tetikleyicisine aria-expanded/aria-controls/aria-haspopup ve klavye davranışı ekleyin.";
  if (rule.startsWith("custom-slider-a11y")) return "Slider için erişilebilir isim, aria-valuemin/max/now ve klavye desteği ekleyin.";
  if (rule.startsWith("custom-table-a11y")) return "Veri tablolarında caption, th ve scope kullanın; layout için table yerine CSS tercih edin.";
  if (rule === "heading-hierarchy-skip" || rule === "custom-headings-skip-warning") return "Başlık seviyelerini sırayla ilerletin (H1 -> H2 -> H3). H1'den doğrudan H3'e geçmeyin.";
  return "Bu bulgu için ilgili bileşeni semantik/ARIA ve klavye erişimi açısından gözden geçirip yeniden test edin.";
}

function buildDeterministicPatch(issue) {
  const rule = String(issue.rule || "");
  const line = String(issue.lineContent || "").trim();

  if (rule === "interactive-role-missing" && /<(div|span)\b/i.test(line) && /onClick|onclick/i.test(line)) {
    const patched = line
      .replace(/^<div\b/i, '<button type="button"')
      .replace(/^<span\b/i, '<button type="button"')
      .replace(/<\/(div|span)>\s*$/i, "</button>");
    return `Önce:\n${line}\n\nSonra:\n${patched}`;
  }

  if (rule === "keyboard-focus-missing" && /onClick|onclick/i.test(line) && !/tabindex|tabIndex/i.test(line)) {
    const patched = line.replace(/>$/, ' tabIndex={0} onKeyDown={(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault(); fn?.();}}}>');
    return `Önce:\n${line}\n\nSonra:\n${patched}`;
  }

  if (rule === "focus-outline-removed" && /outline\s*:\s*(none|0)/i.test(line)) {
    const patched = line.replace(/outline\s*:\s*(none|0)\s*;?/i, "outline: 2px solid #2563eb;");
    return `Önce:\n${line}\n\nSonra:\n${patched}\n\nNot: :focus-visible için de aynı stili tanımlayın.`;
  }

  if (rule === "loading-not-announced") {
    return `Önce:\n${line || '<div class="skeleton-loader"></div>'}\n\nSonra:\n<div role="status" aria-live="polite" aria-busy="true">Yükleniyor...</div>`;
  }

  if (rule === "skip-link-missing") {
    return 'Önce:\n<header>...</header>\n\nSonra:\n<a class="skip-link" href="#main">Ana İçeriğe Atla</a>\n<main id="main">...</main>';
  }

  return "";
}

document.getElementById("detail-close").addEventListener("click", () => {
  closeDetail();
});

document.getElementById("detail-ignore").addEventListener("click", () => {
  showToast("Sorun yoksayildi.", "info");
  closeDetail();
});

document.getElementById("detail-mark-fixed").addEventListener("click", () => {
  showToast("Düzeltildi olarak işaretlendi.", "success");
  closeDetail();
});

// --- RESCAN ---
document.getElementById("rescan-btn").addEventListener("click", () => {
  if (currentFolder) startScan();
});

// --- EXPORT ---
document.getElementById("export-btn").addEventListener("click", () => openExportModal());

function closeExportModal() {
  const modal = document.getElementById("export-modal");
  if (modal) modal.remove();
  // Modal kapanırken odağı geri taşı
  if (_lastFocusBeforeModal) {
    _lastFocusBeforeModal.focus();
    _lastFocusBeforeModal = null;
  }
}

function openExportModal() {
  if (mockIssues.length === 0) {
    showToast("Disa aktarilacak rapor yok. Once tarama yapin.", "warning");
    return;
  }

  document.getElementById("export-modal")?.remove();

  const modal = document.createElement("div");
  modal.id = "export-modal";
  modal.className = "export-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "export-modal-title");
  modal.innerHTML = `
    <div class="export-modal-backdrop"></div>
    <div class="export-modal-box">
      <h3 id="export-modal-title">Raporu Dışa Aktar</h3>
      <p class="export-modal-desc">${mockIssues.length} sorun | ${currentFolder ? currentFolder.split("/").pop() : "Proje"}</p>
      <div class="export-format-list">
        <label class="export-format-item">
          <input type="radio" name="exp-fmt" value="pdf" ${settings.exportFormat === "pdf" ? "checked" : ""}/>
          <span class="fmt-icon">PDF</span>
          <div><strong>PDF</strong><small>Yazdırılabilir rapor</small></div>
        </label>
        <label class="export-format-item">
          <input type="radio" name="exp-fmt" value="json" ${settings.exportFormat === "json" ? "checked" : ""}/>
          <span class="fmt-icon">JSON</span>
          <div><strong>JSON</strong><small>Makine okunabilir veri</small></div>
        </label>
        <label class="export-format-item">
          <input type="radio" name="exp-fmt" value="csv" ${settings.exportFormat === "csv" ? "checked" : ""}/>
          <span class="fmt-icon">CSV</span>
          <div><strong>CSV</strong><small>Excel uyumlu tablo</small></div>
        </label>
      </div>
      <div class="export-modal-actions">
        <button class="btn-outline" id="export-cancel-btn">İptal</button>
        <button class="btn-primary" id="export-confirm-btn">Kaydet</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  _lastFocusBeforeModal = document.activeElement;
  modal.querySelector(".export-modal-backdrop").addEventListener("click", () => closeExportModal());
  document.getElementById("export-cancel-btn").addEventListener("click", () => closeExportModal());
  document.getElementById("export-confirm-btn").addEventListener("click", async () => {
    const format = modal.querySelector("input[name='exp-fmt']:checked")?.value || "pdf";
    settings.exportFormat = format;
    saveSettings();
    closeExportModal();

    const btn = document.getElementById("export-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Hazirlaniyor...`;

    const projectName = currentFolder ? currentFolder.split("\\").pop().split("/").pop() : "proje";
    const result = await window.electronAPI.exportReport({
      format,
      issues: mockIssues,
      rawIssues,
      findingGroups,
      dedupStats,
      projectName,
      scanDate: lastScanDate,
      checklistResults: checklistResults || [],
      mediaCtx,
      reliabilitySummary,
    });

    btn.disabled = false;
    btn.innerHTML = `Disa Aktar`;

    if (result && result.success) {
      showToast(`Rapor kaydedildi: ${result.filePath.split("/").pop()}`, "success");
    } else if (result && result.error) {
      showToast(`Hata: ${result.error}`, "error");
    }
  });

  // Modal açıldığında ilk focusable elemana odaklan
  setTimeout(() => {
    const modalEl = document.getElementById("export-modal");
    const firstFocusable = modalEl && modalEl.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (firstFocusable) firstFocusable.focus();
    _lastFocusBeforeModal = _lastFocusBeforeModal || document.activeElement;
  }, 50);
}

// --- THEME ---
const themeSelect = document.getElementById("setting-theme");

function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light");
  } else {
    document.body.classList.remove("light");
  }
  settings.theme = theme;
  saveSettings();
  window.electronAPI.setTitleBarTheme(theme);
}

themeSelect.value = settings.theme;
applyTheme(settings.theme);

themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  showToast(themeSelect.value === "light" ? "Açık tema etkin" : "Koyu tema etkin", "info");
});

// --- AYARLAR UI SYNC ---
const terminalLinesSelect = document.getElementById("setting-terminal-lines");
if (terminalLinesSelect) {
  terminalLinesSelect.value = String(settings.terminalLines);
  terminalLinesSelect.addEventListener("change", () => {
    settings.terminalLines = parseInt(terminalLinesSelect.value);
    saveSettings();
  });
}

const exportFormatSelect = document.getElementById("setting-export-format");
if (exportFormatSelect) {
  exportFormatSelect.value = settings.exportFormat;
  exportFormatSelect.addEventListener("change", () => {
    settings.exportFormat = exportFormatSelect.value;
    saveSettings();
  });
}

function formatReliabilityPct(score) {
  return `${Math.round((Number(score) || 0) * 100)}%`;
}

function reliabilityBucketLabel(bucket) {
  if (bucket === "high") return "yüksek";
  if (bucket === "medium") return "orta";
  return "düşük";
}

function renderReliabilityPanel(summary) {
  const sumEl = document.getElementById("rel-summary");
  const listEl = document.getElementById("rel-low-rules");
  if (!sumEl || !listEl) return;

  if (!summary || !summary.ruleCount) {
    sumEl.innerHTML = `<div class="setting-hint">Henüz güvenilirlik verisi oluşmadı.</div>`;
    listEl.innerHTML = `<div class="setting-hint">Kural listesi bekleniyor.</div>`;
    return;
  }

  sumEl.innerHTML = `
    <div class="rel-kpis">
      <div class="rel-kpi"><strong>${summary.ruleCount}</strong><span>Kural</span></div>
      <div class="rel-kpi"><strong>${summary.totalObservations}</strong><span>Gözlem</span></div>
      <div class="rel-kpi"><strong>${summary.highCount}</strong><span>Yüksek</span></div>
      <div class="rel-kpi"><strong>${summary.mediumCount}</strong><span>Orta</span></div>
      <div class="rel-kpi"><strong>${summary.lowCount}</strong><span>Düşük</span></div>
    </div>
    <div class="setting-hint">Son güncelleme: ${summary.updatedAt ? new Date(summary.updatedAt).toLocaleString("tr-TR") : "-"}</div>
  `;

  const rows = Array.isArray(summary.lowRules) ? summary.lowRules.slice(0, 8) : [];
  if (!rows.length) {
    listEl.innerHTML = `<div class="setting-hint">Görüntülenecek düşük güvenli kural bulunmadı.</div>`;
    return;
  }

  listEl.innerHTML = rows.map((r) => `
    <div class="rel-row">
      <span class="rel-rule">${escapeHtml(r.rule)}</span>
      <span class="rel-bucket rel-bucket-${escapeHtml(r.reliabilityBucket)}">${reliabilityBucketLabel(r.reliabilityBucket)}</span>
      <span class="rel-score">${formatReliabilityPct(r.reliabilityScore)}</span>
      <span class="rel-count">${r.total} gözlem</span>
    </div>
  `).join("");
}

async function refreshReliabilityPanel(showFeedback = false) {
  if (!window.electronAPI.getRuleReliabilitySummary) return;
  try {
    reliabilitySummary = await window.electronAPI.getRuleReliabilitySummary();
    renderReliabilityPanel(reliabilitySummary);
    if (showFeedback) showToast("Güvenilirlik panosu güncellendi.", "info");
  } catch {
    if (showFeedback) showToast("Güvenilirlik verisi alınamadı.", "warning");
  }
}

const relRefreshBtn = document.getElementById("rel-refresh-btn");
if (relRefreshBtn) {
  relRefreshBtn.addEventListener("click", () => refreshReliabilityPanel(true));
}

const relResetBtn = document.getElementById("rel-reset-btn");
if (relResetBtn) {
  relResetBtn.addEventListener("click", async () => {
    try {
      reliabilitySummary = await window.electronAPI.resetRuleReliabilitySummary();
      renderReliabilityPanel(reliabilitySummary);
      showToast("Güvenilirlik verisi sıfırlandı.", "warning");
    } catch {
      showToast("Sıfırlama işlemi başarısız.", "error");
    }
  });
}

refreshReliabilityPanel(false);

// ============================================
// KONTROL LISTESI UI
// ============================================
let clFilter = "all";

function buildChecklist() {
  renderChecklist();
  updateChecklistStats();
}

function updateChecklistStats() {
  if (!checklistResults.length) return;
  const totals = { pass: 0, fail: 0, manual: 0, na: 0 };
  const turler = { otomatik: 0, hibrit: 0, manuel: 0 };
  const zorunlu = { pass: 0, fail: 0, manual: 0, na: 0, total: 0 };
  const onKosul = { pass: 0, fail: 0, manual: 0, na: 0, total: 0 };
  for (const q of checklistResults) totals[q.status] = (totals[q.status] || 0) + 1;
  for (const q of checklistResults) {
    const raw = String(q.kontrolTuru || "otomatik").toLowerCase();
    const key = raw === "manüel" ? "manuel" : raw;
    turler[key] = (turler[key] || 0) + 1;
    if (q.zorunluMu) {
      zorunlu.total++;
      zorunlu[q.status] = (zorunlu[q.status] || 0) + 1;
    } else {
      onKosul.total++;
      onKosul[q.status] = (onKosul[q.status] || 0) + 1;
    }
  }
  const el = document.getElementById("cl-stats");
  if (el) el.innerHTML = `
    <div class="cl-stats-main">
      <div class="cl-kpi cl-pass">
        <span class="cl-kpi-label">Geçti</span>
        <strong class="cl-kpi-value">${totals.pass}</strong>
      </div>
      <div class="cl-kpi cl-fail">
        <span class="cl-kpi-label">Kaldı</span>
        <strong class="cl-kpi-value">${totals.fail}</strong>
      </div>
      <div class="cl-kpi cl-manual">
        <span class="cl-kpi-label">Manuel</span>
        <strong class="cl-kpi-value">${totals.manual}</strong>
      </div>
    </div>
    <div class="cl-stats-sub">
      <span class="cl-sub-item">
        <button
          type="button"
          class="cl-sub-help"
          data-tooltip="Zorunlu sorular, erişilebilirlik sonucunu doğrudan etkiler. Önce buradaki kalanları düzeltin."
          aria-label="Zorunlu açıklaması"
          aria-describedby="cl-tip-zorunlu"
        >i</button>
        <span id="cl-tip-zorunlu" class="sr-only">Zorunlu sorular, erişilebilirlik sonucunu doğrudan etkiler. Önce buradaki kalanları düzeltin.</span>
        Zorunlu soru: ${zorunlu.total} (Geçti ${zorunlu.pass || 0}, Kaldı ${zorunlu.fail || 0})
      </span>
      <span class="cl-sub-dot">•</span>
      <span class="cl-sub-item">
        <button
          type="button"
          class="cl-sub-help"
          data-tooltip="Ön koşul sorular yalnızca ilgili içerik varsa değerlendirilir. Örneğin video, form veya CAPTCHA olan sayfalar."
          aria-label="Ön koşul açıklaması"
          aria-describedby="cl-tip-on-kosul"
        >i</button>
        <span id="cl-tip-on-kosul" class="sr-only">Ön koşul sorular yalnızca ilgili içerik varsa değerlendirilir. Örneğin video, form veya CAPTCHA olan sayfalar.</span>
        Ön koşul soru: ${onKosul.total}
      </span>
      <span class="cl-sub-dot">•</span>
      <span class="cl-sub-item">
        <button
          type="button"
          class="cl-sub-help"
          data-tooltip="Bu sayı, ekibin insan kontrolü yapması gereken soruları gösterir."
          aria-label="Dağılım açıklaması"
          aria-describedby="cl-tip-tur-dagilim"
        >i</button>
        <span id="cl-tip-tur-dagilim" class="sr-only">Bu sayı, ekibin insan kontrolü yapması gereken soruları gösterir.</span>
        Manuel kontrol gereken soru: ${totals.manual || 0}
      </span>
    </div>
  `;
}

function renderChecklist() {
  const container = document.getElementById("checklist-items");
  if (!container) return;
  if (!checklistResults.length) {
    container.innerHTML = '<div class="cl-empty">Tarama yapildiktan sonra kontrol listesi burada gorunur.</div>';
    return;
  }

  let items = checklistResults;
  if (clFilter !== "all") items = checklistResults.filter(q => q.status === clFilter);

  container.innerHTML = "";

  const grouped = {};
  for (const q of items) {
    const key = `${q.wcag} ${q.criterion}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(q);
  }

  for (const [groupTitle, questions] of Object.entries(grouped)) {
    const section = document.createElement("div");
    section.className = "cl-group";

    const groupHeader = document.createElement("div");
    groupHeader.className = "cl-group-header";
    const failCount = questions.filter(q => q.status === "fail").length;
    groupHeader.innerHTML = `
      <span class="cl-wcag-tag">${questions[0].wcag}</span>
      <span class="cl-group-title">${questions[0].criterion}</span>
      ${failCount > 0 ? `<span class="cl-group-fail-count">${failCount} sorun</span>` : "<span class='cl-group-ok'>Uygun</span>"}
    `;
    section.appendChild(groupHeader);

    for (const q of questions) {
      const item = createChecklistItem(q);
      section.appendChild(item);
    }

    container.appendChild(section);
  }
}

function createChecklistItem(q) {
  const item = document.createElement("div");
  item.className = `cl-item cl-item-${q.status}`;
  item.dataset.qid = q.id;
  item.dataset.questionId = q.id;

  const statusIcons  = { pass: "✓", fail: "✗", manual: "?", na: "-" };
  const statusLabels = { pass: "Geçti", fail: "Kaldı", manual: "Manuel", na: "Uygulanamaz" };
  const confLabels   = {
    "auto-high": "Yüksek Güven", "auto-medium": "Orta Güven", "auto-low": "Düşük Güven", "manual": "İnceleme Gerekli",
    "high": "Yüksek Güven", "medium": "Orta Güven", "low": "Düşük Güven",
  };

  const hasFindings = q.findings && q.findings.length > 0;
  const renderFinding = (f) => {
    const fileText = escapeHtml(f.file || "Dosya bilgisi yok");
    const titleText = escapeHtml(f.title || "Bulgu");
    const lineText = Number.isFinite(f.line) && f.line > 0
      ? `<span class="cl-finding-line">:${escapeHtml(f.line)}</span>`
      : "";
    return `
      <div class="cl-finding">
        <div class="cl-finding-head">
          <span class="cl-finding-file">${fileText}</span>
          ${lineText}
        </div>
        <div class="cl-finding-title">${titleText}</div>
      </div>
    `;
  };
  const findingsHtml = hasFindings ? `
    <div class="cl-findings">
      ${q.findings.slice(0, 3).map(renderFinding).join("")}
      ${q.findings.length > 3 ? `
        <button type="button" class="cl-more-btn" data-qid="${q.id}" aria-expanded="false">
          +${q.findings.length - 3} daha...
        </button>
        <div class="cl-more-list" id="cl-more-${q.id}" hidden>
          ${q.findings.slice(3).map(renderFinding).join("")}
        </div>
      ` : ""}
    </div>
  ` : "";

  const manualHtml = q.status === "manual" ? `
    <div class="cl-manual-input" id="cl-manual-${q.id}">
      <div class="cl-manual-hint">${q.hint}</div>
      <div class="cl-manual-answer">
        <button class="cl-ans-btn cl-ans-yes ${q.manualAnswer === 'yes' ? 'selected' : ''}" data-qid="${q.id}" data-ans="yes">Evet (Uyumlu)</button>
        <button class="cl-ans-btn cl-ans-no  ${q.manualAnswer === 'no'  ? 'selected' : ''}" data-qid="${q.id}" data-ans="no">Hayır (Uyumsuz)</button>
        <button class="cl-ans-btn cl-ans-na  ${q.manualAnswer === 'na'  ? 'selected' : ''}" data-qid="${q.id}" data-ans="na">Uygulanamaz</button>
      </div>
      <textarea class="cl-manual-note" placeholder="Not ekle (isteğe bağlı)..." data-qid="${q.id}">${q.manualNote || ""}</textarea>
    </div>
  ` : "";

  item.innerHTML = `
    <div class="cl-item-header">
      <span class="cl-status-icon cl-status-${q.status}">${statusIcons[q.status]}</span>
      <span class="cl-id">${q.id}</span>
      <span class="cl-question">${q.question}</span>
      <span class="cl-status-label cl-status-${q.status}">${statusLabels[q.status]}</span>
      <span class="cl-confidence">${q.degerlendirmeSinifi === "ön-koşul" ? "ön koşul" : "zorunlu"}</span>
      <span class="cl-confidence">${(q.kontrolTuru || (q.autoOrManual === "manual" ? "manuel" : "otomatik")).replace("manüel", "manuel")}</span>
      <span class="cl-confidence">Kanıt: ${q.kanitDuzeyi || "bilinmiyor"}</span>
      ${q.confidence && q.confidence !== "manual" ? `<span class="cl-confidence cl-conf-${q.confidence}">${confLabels[q.confidence] || ""}</span>` : ""}
      ${q.status !== "na" && q.status !== "manual" ? `
        <button class="cl-toggle-btn" data-qid="${q.id}" aria-label="Detayı aç veya kapat" aria-expanded="false">
          <svg class="cl-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>` : ""}
    </div>
    <div class="cl-item-body" id="cl-body-${q.id}" style="display:none">
      ${findingsHtml}
      ${manualHtml}
      ${q.duzeltmeOnerisi ? `<div class="cl-hint"><strong>Düzeltme Önerisi:</strong> ${q.duzeltmeOnerisi}</div>` : ""}
      ${q.hint && q.status !== "manual" ? `<div class="cl-hint">${q.hint}</div>` : ""}
    </div>
  `;

  return item;
}

document.addEventListener("click", (e) => {
  const toggleBtn = e.target.closest(".cl-toggle-btn");
  if (toggleBtn) {
    const qid = toggleBtn.dataset.qid;
    const body = document.getElementById(`cl-body-${qid}`);
    if (body) {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      toggleBtn.classList.toggle("is-open", !open);
      toggleBtn.setAttribute("aria-expanded", open ? "false" : "true");
    }
  }

  const moreBtn = e.target.closest(".cl-more-btn");
  if (moreBtn) {
    const qid = moreBtn.dataset.qid;
    const moreList = document.getElementById(`cl-more-${qid}`);
    if (moreList) {
      const isHidden = moreList.hasAttribute("hidden");
      if (isHidden) {
        moreList.removeAttribute("hidden");
        moreBtn.setAttribute("aria-expanded", "true");
        moreBtn.textContent = "Daha az göster";
      } else {
        moreList.setAttribute("hidden", "");
        moreBtn.setAttribute("aria-expanded", "false");
        const q = checklistResults.find((x) => x.id === qid);
        const hiddenCount = Math.max(0, (q?.findings?.length || 0) - 3);
        moreBtn.textContent = `+${hiddenCount} daha...`;
      }
    }
  }

  if (e.target.matches(".cl-ans-btn")) {
    const { qid, ans } = e.target.dataset;
    const q = checklistResults.find(q => q.id === qid);
    if (!q) return;
    q.manualAnswer = ans;

    // Final status güncelle
    q.finalStatus = deriveManualStatus(ans, q.expectedAnswer);
    q.status = q.finalStatus;

    const parent = e.target.closest(".cl-manual-answer");
    parent.querySelectorAll(".cl-ans-btn").forEach(b => b.classList.remove("selected"));
    e.target.classList.add("selected");

    // Durum değişikliği sonrası kart ve filtre görünümünü modelden yeniden üret.
    renderChecklist();
    updateChecklistStats();
    persistManualChecklistState();
    showToast(`${qid} ${ans === "yes" ? "Uyumlu" : ans === "no" ? "Uyumsuz" : "Uygulanamaz"} olarak işaretlendi.`, "info");
  }
});

document.addEventListener("input", (e) => {
  if (e.target.matches(".cl-manual-note")) {
    const qid = e.target.dataset.qid;
    const q = checklistResults.find(q => q.id === qid);
    if (q) {
      q.manualNote = e.target.value;
      persistManualChecklistState();
    }
  }
});

document.querySelectorAll(".cl-filter-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".cl-filter-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    clFilter = tab.dataset.filter;
    renderChecklist();
  });
});

const clSearchInput = document.getElementById("cl-search");
if (clSearchInput) {
  clSearchInput.addEventListener("input", () => {
    const q = clSearchInput.value.toLowerCase();
    document.querySelectorAll(".cl-item").forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? "" : "none";
    });
  });
}

// --- RECENT ---
function addToRecent() {
  const name = currentFolder.split("\\").pop().split("/").pop();
  const criticalCount = mockIssues.filter((i) => i.severity === "critical").length;
  const total = mockIssues.length;
  const score = Math.max(0, Math.min(100, Math.round(100 - criticalCount * 4 - (total - criticalCount) * 2)));
  const scoreLabel = score >= 80 ? "AA" : score >= 60 ? "A" : "F";
  const scoreColor = score >= 80 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--critical)";

  const list = document.getElementById("recent-list");
  const emptyState = list.querySelector(".empty-state-sm");
  if (emptyState) emptyState.remove();

  const item = document.createElement("div");
  item.className = "recent-item";
  item.setAttribute("role", "button");
  item.setAttribute("tabindex", "0");
  const now = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  item.innerHTML = `
    <div class="recent-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
    <div class="recent-item-info"><strong>${name}</strong><span>${currentFolder}</span></div>
    <div class="recent-item-meta">
      <span class="recent-score" style="background:${scoreColor}20;color:${scoreColor}">${score}% ${scoreLabel}</span>
      <span class="recent-date">${now}</span>
    </div>
    <button class="recent-remove-btn" type="button" aria-label="${name} kaydını kaldır" title="Kaldır">Kaldır</button>
  `;
  item.addEventListener("click", () => navigateTo("report"));
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      item.click();
    }
  });
  const removeBtn = item.querySelector(".recent-remove-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      item.remove();
      if (!list.querySelector(".recent-item")) {
        list.innerHTML = `<div class="empty-state-sm">Henüz tarama yapılmadı.</div>`;
      }
      showToast("Tarama kaydı kaldırıldı.", "info");
    });
    removeBtn.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });
  }
  list.prepend(item);

  const allItems = list.querySelectorAll(".recent-item");
  if (allItems.length > 5) allItems[allItems.length - 1].remove();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("export-modal");
    if (modal && !modal.classList.contains("hidden")) {
      closeExportModal();
    }
    const detail = document.getElementById("detail-panel");
    if (detail && !detail.classList.contains("hidden")) {
      closeDetail();
    }
  }
});
