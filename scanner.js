// ============================================
// A11y Scanner v4 — Hibrit Motor
// Katman 1: Puppeteer + axe-core (DOM analizi)
// Katman 2: Statik kaynak kodu analizi
//
// PHASE 1: Job state machine + cancellation
// Her scanProject() çağrısı AbortSignal (veya uyumluluk için CancelToken) alır.
// Signal iptal edildiğinde:
//   - Puppeteer döngüsü bir sonraki dosyada durur
//   - Sayfa ve browser kapatılır
//   - Statik döngü bir sonraki dosyada durur
//   - emit() çağrıları susturulur
// ============================================

"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const { applyRuleContractToFinding } = require("./ruleContracts");

// ── Sabitler ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = [
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".svelte-kit", "vendor", "coverage", "out", ".nuxt", ".cache",
  "__tests__", ".turbo", ".vercel", "fixtures", "test", "tests", "__mocks__",
];
const SCAN_EXTS = [
  ".html", ".htm", ".jsx", ".tsx", ".vue", ".js", ".ts",
  ".css", ".scss", ".sass", ".svelte",
];
const MAX_FILE_SIZE  = 5 * 1024 * 1024; // 5 MB
const AXE_TAGS       = ["wcag2a", "wcag21a", "wcag22a", "best-practice"];
const PAGE_TIMEOUT   = 15_000; // ms
const SCENARIO_TIMEOUT = 4_000; // ms
const REQUIRED_HTML_LANG = process.env.A11Y_REQUIRED_HTML_LANG || "tr";
const ALLOW_LANG_PREFIX  = process.env.A11Y_ALLOW_LANG_PREFIX === "1";
const ALLOWED_MODAL_CLOSE_LABELS = new Set([
  // Türkçe standart
  "kapat", "modalı kapat", "pencereyi kapat", "dialogu kapat", "iletişim kutusunu kapat",
  // Yaygın alternatifler
  "iptal", "vazgeç", "geri dön", "tamam", "anladım",
  // İngilizce (uluslararası projeler için)
  "close", "dismiss", "cancel",
  // Kapat + X kombinasyonları (aria-label'dan gelen)
  "kapat x", "close x",
]);

// ── Cancellation helpers ──────────────────────────────────────────────────────
//
// Backward-compatible wrapper: existing tests/tools may still pass CancelToken.
// Internal engine always consumes AbortSignal.
//
class CancelToken {
  constructor() {
    this._controller = new AbortController();
  }

  cancel(reason = "user_cancel") {
    if (!this.cancelled) this._controller.abort(reason);
  }

  get signal() {
    return this._controller.signal;
  }

  get cancelled() {
    return this._controller.signal.aborted;
  }

  throwIfCancelled() {
    if (this.cancelled) throw makeAbortError(this.signal.reason);
  }
}

function makeAbortError(reason) {
  const err = new Error(`Scan cancelled: ${reason || "user_cancel"}`);
  err.code = "SCAN_CANCELLED";
  return err;
}

function toAbortSignal(cancelTokenOrSignal) {
  if (cancelTokenOrSignal instanceof CancelToken) return cancelTokenOrSignal.signal;
  if (cancelTokenOrSignal && typeof cancelTokenOrSignal.aborted === "boolean") {
    return cancelTokenOrSignal;
  }
  return new AbortController().signal;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw makeAbortError(signal.reason);
}

function onceAbort(signal) {
  if (signal.aborted) return Promise.reject(makeAbortError(signal.reason));
  return new Promise((_, reject) => {
    const onAbort = () => reject(makeAbortError(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function injectAxeIfNeeded(page, axeSource, signal) {
  const alreadyLoaded = await Promise.race([
    page.evaluate(() => typeof window.axe !== "undefined"),
    onceAbort(signal),
  ]);
  if (!alreadyLoaded) {
    await Promise.race([
      page.addScriptTag({ content: axeSource }),
      onceAbort(signal),
    ]);
  }
}

async function runAxeWithAbort(page, axeSource, signal) {
  await injectAxeIfNeeded(page, axeSource, signal);
  return Promise.race([
    page.evaluate((tags) => {
      return window.axe.run(document, {
        runOnly: { type: "tag", values: tags },
      });
    }, AXE_TAGS),
    onceAbort(signal),
  ]);
}

async function sleepAbort(ms, signal) {
  return Promise.race([
    new Promise((resolve) => setTimeout(resolve, ms)),
    onceAbort(signal),
  ]);
}

async function waitForPageStable(page, signal, timeoutMs = 2200) {
  const t0 = Date.now();

  // Try network-idle first when available.
  try {
    if (typeof page.waitForNetworkIdle === "function") {
      await Promise.race([
        page.waitForNetworkIdle({ idleTime: 350, timeout: Math.min(timeoutMs, 1600) }),
        onceAbort(signal),
      ]);
    }
  } catch {}

  // Render-stability pass: wait until document size stabilizes.
  let stableTicks = 0;
  let lastSig = "";
  while (Date.now() - t0 < timeoutMs) {
    throwIfAborted(signal);
    const sig = await Promise.race([
      page.evaluate(() => {
        const bodyLen = document.body ? document.body.innerText.length : 0;
        const htmlLen = document.documentElement ? document.documentElement.outerHTML.length : 0;
        return `${document.readyState}|${bodyLen}|${htmlLen}`;
      }),
      onceAbort(signal),
    ]);
    if (sig === lastSig) stableTicks++;
    else stableTicks = 0;
    lastSig = sig;
    if (stableTicks >= 2) break;
    await sleepAbort(120, signal);
  }
}

async function findFirstVisibleSelector(page, selectors, signal) {
  return Promise.race([
    page.evaluate((sels) => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === "hidden" || style.display === "none") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      for (const sel of sels) {
        try {
          const el = document.querySelector(sel);
          if (isVisible(el)) return sel;
        } catch {}
      }
      return null;
    }, selectors),
    onceAbort(signal),
  ]);
}

async function clickSelector(page, selector, signal) {
  return Promise.race([
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    }, selector),
    onceAbort(signal),
  ]);
}

async function waitVisibleAny(page, selectors, signal, timeoutMs = SCENARIO_TIMEOUT) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const found = await findFirstVisibleSelector(page, selectors, signal);
    if (found) return found;
    await sleepAbort(120, signal);
  }
  return null;
}

async function submitFormInvalidState(page, signal) {
  return Promise.race([
    page.evaluate(() => {
      const form = document.querySelector("form");
      if (!form) return { ok: false, reason: "no-form" };

      const candidate = form.querySelector("input[required], textarea[required], select[required]");
      if (candidate) {
        if ("value" in candidate) candidate.value = "";
        candidate.dispatchEvent(new Event("input", { bubbles: true }));
        candidate.dispatchEvent(new Event("change", { bubbles: true }));
      }

      const submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submit) submit.click();
      else if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      return { ok: true, reason: candidate ? "required-emptied" : "submitted-no-required" };
    }),
    onceAbort(signal),
  ]);
}

async function collectDomContext(page, selector, signal) {
  if (!selector) return { domPath: "", ancestorSummary: "" };
  try {
    return await Promise.race([
      page.evaluate((sel) => {
        let el = null;
        try { el = document.querySelector(sel); } catch { return { domPath: "", ancestorSummary: "" }; }
        if (!el) return { domPath: "", ancestorSummary: "" };

        const nodeName = (n) => (n.nodeName || "").toLowerCase();
        const idPart = (n) => n.id ? `#${n.id}` : "";
        const classPart = (n) => {
          const c = (n.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
          return c.length ? "." + c.join(".") : "";
        };
        const label = (n) => `${nodeName(n)}${idPart(n)}${classPart(n)}`;

        const chain = [];
        let cur = el;
        while (cur && chain.length < 8) {
          chain.unshift(label(cur));
          cur = cur.parentElement;
        }

        const ancestors = [];
        cur = el.parentElement;
        while (cur && ancestors.length < 4) {
          ancestors.push(label(cur));
          cur = cur.parentElement;
        }

        return {
          domPath: chain.join(" > "),
          ancestorSummary: ancestors.join(" | "),
        };
      }, selector),
      onceAbort(signal),
    ]);
  } catch {
    return { domPath: "", ancestorSummary: "" };
  }
}

async function buildNodeEvidence(page, node, pageState, signal) {
  const selector = (node.target || []).join(", ");
  const snippet = (node.html || "").substring(0, 240);
  const context = await collectDomContext(page, selector, signal);
  return {
    selector,
    snippet,
    context,
    pageState,
    timestamp: new Date().toISOString(),
    url: page.url(),
  };
}

function buildScenarioFailureIssue(relFile, scenarioName, stepId, reason, selector, pageUrl) {
  return {
    severity   : "review",
    wcag       : "",
    rule       : "runtime-scenario-failure",
    title      : `[Runtime scenario failure] ${scenarioName}`,
    desc       : `Scenario step failed deterministically. step=${stepId}, reason=${reason}`,
    file       : relFile,
    line       : 0,
    lineContent: "",
    fix        : "Senaryo adımı için selector/wait koşullarını doğrulayın ve ilgili UI durumunu tetikleyin.",
    fixNote    : "Bu hata teknik tarama altyapısı içindir; işlevsel UI state yakalanamamış olabilir.",
    source     : "runtime-infra",
    hidden     : true,
    selector   : selector || "",
    evidence   : {
      selector: selector || "",
      snippet: "",
      context: { domPath: "", ancestorSummary: "" },
      pageState: { scenario: scenarioName, stepId },
      timestamp: new Date().toISOString(),
      url: pageUrl || "",
    },
  };
}

function detectSkipLinkInContent(content) {
  const text = String(content || "");
  if (!text) return false;

  // Fast pre-check to avoid expensive regex scans on unrelated files.
  if (!/(skip|atla|i[çc]eri[ğg]|main|content)/i.test(text)) return false;

  const patterns = [
    // Classic anchor/button/link with visible skip text
    /<(a|button|Link|NavLink)\b[^>]*>[\s\S]{0,240}(ana\s*i[çc]eri[ğg]e\s*atla|i[çc]eri[ğg]e\s*ge[çc]|skip\s*(to)?\s*(main|content|navigation)?)[\s\S]{0,240}<\/(a|button|Link|NavLink)>/i,
    // Hash target to main/content-like IDs with skip-ish visible text
    /<(a|Link|NavLink)\b[^>]*(href|to)\s*=\s*["']#(main|content|ana-?i[çc]erik|main-content|app-main|primary|icerik)["'][^>]*>[\s\S]{0,200}(atla|skip|i[çc]eri[ğg])[\s\S]{0,200}<\/(a|Link|NavLink)>/i,
    // Hash target to main/content-like IDs with explicit skip-ish class
    /<(a|Link|NavLink)\b[^>]*(href|to)\s*=\s*["']#(main|content|ana-?i[çc]erik|main-content|app-main|primary|icerik)["'][^>]*(class|className)\s*=\s*["'][^"']*skip[^"']*["'][^>]*>/i,
    // Same as above but class may appear before href/to
    /<(a|Link|NavLink)\b[^>]*(class|className)\s*=\s*["'][^"']*skip[^"']*["'][^>]*(href|to)\s*=\s*["']#(main|content|ana-?i[çc]erik|main-content|app-main|primary|icerik)["'][^>]*>/i,
    // ARIA-labeled skip action with hash target
    /<(a|button|Link|NavLink)\b[^>]*(href|to)\s*=\s*["']#[^"']+["'][^>]*(aria-label|title)\s*=\s*["'][^"']*(atla|skip|i[çc]eri[ğg])[^"']*["'][^>]*>/i,
    // i18n key patterns commonly used in JSX
    /(skip[_-]?to[_-]?(main|content)|ana[_-]?i[çc]erik[_-]?atla)/i,
  ];

  return patterns.some((re) => re.test(text));
}

const INCREMENTAL_CACHE_FILE = ".a11y-incremental-cache.json";
const INCREMENTAL_SCHEMA_VERSION = 1;

function fileSignature(file) {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${Math.floor(s.mtimeMs)}`;
  } catch {
    return "";
  }
}

function loadIncrementalCache(folderPath) {
  try {
    const p = path.join(folderPath, INCREMENTAL_CACHE_FILE);
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!parsed || parsed.schema !== INCREMENTAL_SCHEMA_VERSION || typeof parsed.files !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveIncrementalCache(folderPath, filesMap) {
  try {
    const p = path.join(folderPath, INCREMENTAL_CACHE_FILE);
    const payload = {
      schema: INCREMENTAL_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      files: filesMap,
    };
    fs.writeFileSync(p, JSON.stringify(payload), "utf8");
  } catch {}
}

function discoverChromeCandidates(puppeteerRef) {
  const candidates = new Set();

  const add = (p) => {
    if (!p || typeof p !== "string") return;
    if (fs.existsSync(p)) candidates.add(p);
  };

  add(process.env.PUPPETEER_EXECUTABLE_PATH);
  add(process.env.CHROME_PATH);

  try {
    const fromPuppeteer = puppeteerRef && puppeteerRef.executablePath ? puppeteerRef.executablePath() : "";
    add(fromPuppeteer);
  } catch {}

  // macOS Chrome stable
  add("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  // macOS Chrome for Testing (default Puppeteer cache root)
  try {
    const home = process.env.HOME || "";
    const root = path.join(home, ".cache", "puppeteer", "chrome");
    if (fs.existsSync(root)) {
      const versions = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      const last = versions[versions.length - 1];
      if (last) {
        add(path.join(root, last, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
        add(path.join(root, last, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
      }
    }
  } catch {}

  return [...candidates];
}

async function launchBrowserWithFallbacks(puppeteerRef, signal, safeLog) {
  const baseArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  const executableCandidates = discoverChromeCandidates(puppeteerRef);
  const launchPlans = [];

  // 1) Use Puppeteer-managed resolution first (without forcing executablePath).
  launchPlans.push({ headless: true, args: baseArgs });
  launchPlans.push({ headless: "new", args: baseArgs });

  // 2) Then try explicit binary candidates.
  for (const executablePath of executableCandidates) {
    launchPlans.push({ headless: true, args: baseArgs, executablePath });
    launchPlans.push({ headless: "new", args: baseArgs, executablePath });
  }

  let lastErr = null;
  for (let i = 0; i < launchPlans.length; i++) {
    throwIfAborted(signal);
    const plan = launchPlans[i];
    try {
      const browser = await puppeteerRef.launch(plan);
      if (plan.executablePath) {
        safeLog(`✓ Tarayıcı başlatıldı (${path.basename(plan.executablePath)})`, "info");
      } else {
        safeLog("✓ Tarayıcı başlatıldı", "info");
      }
      return browser;
    } catch (err) {
      lastErr = err;
      if (i < launchPlans.length - 1) {
        safeLog("i Tarayıcı başlatma denemesi başarısız, alternatif denenecek...", "warn");
      }
    }
  }

  throw lastErr || new Error("Browser launch failed");
}

async function runScenarioState(page, signal, scenarioName) {
  if (scenarioName === "modal-open-state") {
    const triggerSelectors = [
      '[data-bs-toggle="modal"]',
      '[data-modal-target]',
      '[aria-haspopup="dialog"]',
      '[aria-controls*="modal" i]',
      '.modal-trigger',
      'button[class*="modal" i]',
    ];
    const visibleSelectors = [
      'dialog[open]',
      '[role="dialog"][aria-modal="true"]',
      '[role="dialog"]',
      '.modal.show',
      '.modal[open]',
      '[class*="modal"][aria-hidden="false"]',
    ];

    const trigger = await findFirstVisibleSelector(page, triggerSelectors, signal);
    if (!trigger) return { status: "skipped", reason: "no-trigger", stepId: "modal.trigger" };
    await clickSelector(page, trigger, signal);
    await waitForPageStable(page, signal, 1400);
    const visible = await waitVisibleAny(page, visibleSelectors, signal, SCENARIO_TIMEOUT);
    if (!visible) return { status: "failed", reason: "timeout-visible", stepId: "modal.wait-visible", selector: trigger };
    return { status: "ok", stepId: "modal.visible", selector: visible };
  }

  if (scenarioName === "dropdown-expanded-state") {
    const triggerSelectors = [
      '[aria-haspopup="listbox"]',
      '[aria-haspopup="menu"]',
      '[role="combobox"]',
      '.dropdown-toggle',
      '[class*="dropdown"][role="button"]',
      '[data-testid*="dropdown" i]',
    ];
    const visibleSelectors = [
      '[aria-expanded="true"]',
      '[role="listbox"]',
      '[role="menu"]',
      '.dropdown-menu.show',
      '.dropdown.open',
    ];

    const trigger = await findFirstVisibleSelector(page, triggerSelectors, signal);
    if (!trigger) return { status: "skipped", reason: "no-trigger", stepId: "dropdown.trigger" };
    await clickSelector(page, trigger, signal);
    await waitForPageStable(page, signal, 1200);
    const expanded = await waitVisibleAny(page, visibleSelectors, signal, SCENARIO_TIMEOUT);
    if (!expanded) return { status: "failed", reason: "timeout-expanded", stepId: "dropdown.wait-expanded", selector: trigger };
    return { status: "ok", stepId: "dropdown.expanded", selector: expanded };
  }

  if (scenarioName === "form-invalid-state") {
    const submitted = await submitFormInvalidState(page, signal);
    if (!submitted.ok) return { status: "skipped", reason: submitted.reason, stepId: "form.submit-invalid" };
    await waitForPageStable(page, signal, 1200);
    const invalidMarker = await waitVisibleAny(
      page,
      ['[aria-invalid="true"]', '.error', '.invalid-feedback', '[role="alert"]', '[aria-live="assertive"]'],
      signal,
      SCENARIO_TIMEOUT
    );
    if (!invalidMarker) return { status: "failed", reason: "timeout-invalid-state", stepId: "form.wait-invalid" };
    return { status: "ok", stepId: "form.invalid-visible", selector: invalidMarker };
  }

  if (scenarioName === "toast-status-visible-state") {
    const triggerSelectors = [
      '[data-toast-trigger]',
      '[data-testid*="toast" i]',
      'button[class*="toast" i]',
      'button[class*="notify" i]',
    ];
    const visibleSelectors = [
      '.toast.show',
      '.toast.visible',
      '[role="status"]',
      '[role="alert"]',
      '[aria-live="polite"]',
      '[aria-live="assertive"]',
    ];

    const trigger = await findFirstVisibleSelector(page, triggerSelectors, signal);
    if (trigger) {
      await clickSelector(page, trigger, signal);
      await waitForPageStable(page, signal, 1200);
    }
    const visible = await waitVisibleAny(page, visibleSelectors, signal, SCENARIO_TIMEOUT);
    if (!visible) return { status: "failed", reason: "timeout-status-visible", stepId: "toast.wait-visible", selector: trigger || "" };
    return { status: "ok", stepId: "toast.visible", selector: visible };
  }

  if (scenarioName === "focus-order-state") {
    const triggerSelectors = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[tabindex='0']",
      "[role='button']",
      "[role='link']",
    ];

    const first = await findFirstVisibleSelector(page, triggerSelectors, signal);
    if (!first) return { status: "skipped", reason: "no-focusable", stepId: "focus.first" };

    await Promise.race([
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.focus();
        return document.activeElement === el;
      }, first),
      onceAbort(signal),
    ]);
    await sleepAbort(80, signal);
    await Promise.race([page.keyboard.press("Tab"), onceAbort(signal)]);
    await sleepAbort(80, signal);

    const moved = await Promise.race([
      page.evaluate((sel) => {
        const firstEl = document.querySelector(sel);
        const active = document.activeElement;
        const isVisible = (el) => {
          if (!el) return false;
          const st = window.getComputedStyle(el);
          if (!st || st.display === "none" || st.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        if (!firstEl || !active) return { ok: false, reason: "no-active" };
        if (active === firstEl) return { ok: false, reason: "focus-not-moved" };
        if (!isVisible(active)) return { ok: false, reason: "focus-moved-invisible" };
        const id = active.id ? `#${active.id}` : "";
        return { ok: true, selector: `${active.tagName.toLowerCase()}${id}` };
      }, first),
      onceAbort(signal),
    ]);

    if (!moved.ok) {
      return { status: "failed", reason: moved.reason || "focus-order-check-failed", stepId: "focus.tab-order", selector: first };
    }
    return { status: "ok", stepId: "focus.tab-order", selector: moved.selector || first };
  }

  if (scenarioName === "skip-link-activation-state") {
    const candidate = await Promise.race([
      page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("a[href], button, [role='link'], [role='button']"));
        const isVisible = (el) => {
          const st = window.getComputedStyle(el);
          if (!st || st.display === "none" || st.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const skipLike = (el) => {
          const txt = `${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`.toLowerCase();
          const hasText = /(ana\s*içeriğe\s*atla|içeriğe\s*geç|skip\s*(to)?\s*(main|content|navigation)?)/i.test(txt);
          const href = (el.getAttribute("href") || el.getAttribute("to") || "").trim();
          const cls = `${el.className || ""}`.toLowerCase();
          const hashTarget = /^#(main|content|ana-?içerik|main-content|app-main|primary|icerik)/i.test(href);
          return hasText && (hashTarget || cls.includes("skip"));
        };

        for (const el of nodes) {
          if (!isVisible(el) || !skipLike(el)) continue;
          el.setAttribute("data-a11y-skip-candidate", "1");
          const href = (el.getAttribute("href") || el.getAttribute("to") || "").trim();
          const targetId = href.startsWith("#") ? href.slice(1) : "";
          return { selector: '[data-a11y-skip-candidate=\"1\"]', targetId };
        }
        return null;
      }),
      onceAbort(signal),
    ]);

    if (!candidate || !candidate.selector) {
      return { status: "skipped", reason: "no-skip-link", stepId: "skip-link.find" };
    }

    await clickSelector(page, candidate.selector, signal);
    await waitForPageStable(page, signal, 900);

    const activated = await Promise.race([
      page.evaluate((targetId) => {
        const active = document.activeElement;
        const currentHash = (window.location.hash || "").replace(/^#/, "");
        const target = targetId ? document.getElementById(targetId) : null;
        const ok = !!target && (
          currentHash === targetId ||
          active === target ||
          (active && target.contains(active))
        );
        const cleanup = document.querySelector('[data-a11y-skip-candidate=\"1\"]');
        if (cleanup) cleanup.removeAttribute("data-a11y-skip-candidate");
        return { ok, currentHash, targetId };
      }, candidate.targetId),
      onceAbort(signal),
    ]);

    if (!activated.ok) {
      return {
        status: "failed",
        reason: `skip-link-not-activated target=${activated.targetId || "-"} hash=${activated.currentHash || "-"}`,
        stepId: "skip-link.activate",
        selector: candidate.selector,
      };
    }
    return { status: "ok", stepId: "skip-link.activate", selector: candidate.selector };
  }

  if (scenarioName === "loading-announcement-state") {
    const loadingState = await Promise.race([
      page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll(
            [
              '[class*="loading" i]',
              '[class*="spinner" i]',
              '[class*="loader" i]',
              '[class*="skeleton" i]',
              '[aria-busy="true"]',
            ].join(",")
          )
        );
        const isVisible = (el) => {
          const st = window.getComputedStyle(el);
          if (!st || st.display === "none" || st.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const getSelector = (el) => {
          if (!el) return "";
          if (el.id) return `#${el.id}`;
          const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean)[0];
          return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
        };

        for (const el of candidates) {
          if (!isVisible(el)) continue;
          const wrapper = el.closest("[aria-live], [role='status'], [role='alert'], [role='progressbar'], [aria-busy]");
          const announced = !!wrapper && (
            wrapper.hasAttribute("aria-live") ||
            /^(status|alert|progressbar)$/i.test(wrapper.getAttribute("role") || "") ||
            wrapper.getAttribute("aria-busy") === "true"
          );
          return { found: true, announced, selector: getSelector(el) };
        }
        return { found: false, announced: false, selector: "" };
      }),
      onceAbort(signal),
    ]);

    if (!loadingState.found) {
      return { status: "skipped", reason: "no-loading-element", stepId: "loading.detect" };
    }
    if (!loadingState.announced) {
      return { status: "failed", reason: "loading-not-announced", stepId: "loading.announcement", selector: loadingState.selector || "" };
    }
    return { status: "ok", stepId: "loading.announcement", selector: loadingState.selector || "" };
  }

  if (scenarioName === "route-change-state") {
    const routeCandidate = await Promise.race([
      page.evaluate(() => {
        const isVisible = (el) => {
          const st = window.getComputedStyle(el);
          if (!st || st.display === "none" || st.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const currHash = window.location.hash || "";
        const links = Array.from(document.querySelectorAll("a[href^='#']"));
        for (const a of links) {
          if (!isVisible(a)) continue;
          const href = a.getAttribute("href") || "";
          if (href && href !== "#" && href !== currHash) {
            a.setAttribute("data-a11y-route-candidate", "1");
            return { selector: '[data-a11y-route-candidate="1"]', mode: "hash", target: href.slice(1) };
          }
        }
        return null;
      }),
      onceAbort(signal),
    ]);

    if (!routeCandidate) return { status: "skipped", reason: "no-route-candidate", stepId: "route.find" };

    const before = await Promise.race([
      page.evaluate(() => window.location.hash || ""),
      onceAbort(signal),
    ]);

    await clickSelector(page, routeCandidate.selector, signal);
    await waitForPageStable(page, signal, 1200);

    const routeChanged = await Promise.race([
      page.evaluate((target, beforeHash) => {
        const after = window.location.hash || "";
        const active = document.activeElement;
        const targetEl = target ? document.getElementById(target) : null;
        const ok = after !== beforeHash || (targetEl && (active === targetEl || targetEl.contains(active)));
        const cleanup = document.querySelector('[data-a11y-route-candidate="1"]');
        if (cleanup) cleanup.removeAttribute("data-a11y-route-candidate");
        return { ok, after };
      }, routeCandidate.target, before),
      onceAbort(signal),
    ]);

    if (!routeChanged.ok) {
      return { status: "failed", reason: "route-not-changed", stepId: "route.change", selector: routeCandidate.selector };
    }
    return { status: "ok", stepId: "route.change", selector: routeCandidate.selector };
  }

  return { status: "skipped", reason: "unknown-scenario", stepId: "scenario.unknown" };
}

// ── Yardımcı: severity / wcag eşleştirme ─────────────────────────────────────

function mapSeverity(impact) {
  if (impact === "critical" || impact === "serious") return "critical";
  if (impact === "moderate") return "warning";
  return "review";
}

function extractWcag(tags) {
  for (const t of tags || []) {
    const m = t.match(/^wcag(\d)(\d)(\d+)$/);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return "";
}

// ── Ana tarama fonksiyonu ────────────────────────────────────────────────────
//
// Signature:
//   scanProject(folderPath, onProgress, onLog, onIssue, cancelSignal?)
//
// cancelSignal yoksa bağımsız bir signal üretilir (standalone çalışma için).
// Signal iptal edildiğinde fonksiyon { issues, totalFiles, mediaCtx,
// cancelled: true } döndürür — exception fırlatmaz.
//
async function scanProject(folderPath, onProgress, onLog, onIssue, cancelSignal, onBrowserOpen) {
  const signal = toAbortSignal(cancelSignal);
  const scanStartTime = Date.now();

  // ── emit: token iptalinde susturulur ────────────────────────────────────
  let issueId = 0;
  const issues = [];
  let processedStaticFiles = 0;
  let processedUnits = 0;

  function emit(d) {
    if (signal.aborted) return;   // stale event engeli
    issueId++;
    const issue = applyRuleContractToFinding({ id: issueId, ...d });
    issues.push(issue);
    onIssue(issue);
  }

  // ── Güvenli progress/log wrapper'ları ─────────────────────────────────
  function safeLog(msg, level = "info") {
    if (!signal.aborted) onLog(msg, level);
  }

  function safeProgress(file) {
    if (!signal.aborted) onProgress(processedUnits, TOTAL_UNITS, file);
  }

  // ── Dosyaları topla (senkron, iptal öncesi yapılır) ───────────────────
  const files = collectFiles(folderPath);
  const incrementalEnabled = (process.env.A11Y_INCREMENTAL || "1") !== "0";
  const incrementalPrev = incrementalEnabled ? loadIncrementalCache(folderPath) : null;
  const currentSignatures = {};
  const changedRelSet = new Set();
  for (const file of files) {
    const rel = path.relative(folderPath, file).replace(/\\/g, "/");
    const sig = fileSignature(file);
    currentSignatures[rel] = sig;
    const prevSig = incrementalPrev && incrementalPrev.files ? incrementalPrev.files[rel] : "";
    if (!prevSig || prevSig !== sig) changedRelSet.add(rel);
  }
  let staticSkippedByIncremental = 0;
  const anyScriptChanged = files.some((file) => {
    const rel = path.relative(folderPath, file).replace(/\\/g, "/");
    const ext = path.extname(file).toLowerCase();
    return changedRelSet.has(rel) && [".js", ".ts", ".jsx", ".tsx", ".vue", ".svelte"].includes(ext);
  });

  // HTML dosyaları axe-core için ayrı tutulur.
  // Statik döngü tüm dosyaları tarar — HTML'ler dahil.
  // Progress toplamı: htmlFiles (axe pass) + files (static pass)
  const htmlFiles = files.filter(
    f => [".html", ".htm"].includes(path.extname(f).toLowerCase())
  );
  const TOTAL_UNITS = htmlFiles.length + files.length;

  // ── Puppeteer yükle ───────────────────────────────────────────────────
  let puppeteer  = null;
  let axeSource  = null;
  let browser    = null;
  let activePage = null;
  const scenarioQueue = [...htmlFiles];

  const teardownResources = async () => {
    if (activePage) {
      await activePage.close().catch(() => {});
      activePage = null;
    }
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
  };
  const onAbort = () => {
    // Stop queued scenario tasks immediately.
    scenarioQueue.length = 0;
    // Force-close active browser resources to interrupt pending awaits.
    void teardownResources();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    puppeteer = require("puppeteer");
    axeSource = fs.readFileSync(require.resolve("axe-core"), "utf-8");
    safeLog("✓ Puppeteer + axe-core yüklü", "info");
  } catch {
    try {
      puppeteer = require("puppeteer-core");
      axeSource = fs.readFileSync(require.resolve("axe-core"), "utf-8");
      safeLog("✓ Puppeteer + axe-core yüklü (core)", "info");
    } catch {
      safeLog("⚠ Puppeteer/axe-core bulunamadı — yalnızca statik analiz yapılacak", "warn");
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // KATMAN 1: axe-core DOM analizi
  // ════════════════════════════════════════════════════════════════════════
  if (puppeteer && axeSource && htmlFiles.length > 0) {
    safeLog(`\n── AXE-CORE DOM ANALİZİ (${htmlFiles.length} HTML dosyası) ──`, "info");

    try {
      // İptal kontrolü — browser açmadan önce
      throwIfAborted(signal);

      browser = await launchBrowserWithFallbacks(puppeteer, signal, safeLog);
      // ★ main.js'e browser referansını bildir — anlık kapatma için
      if (typeof onBrowserOpen === "function") onBrowserOpen(browser);

      const mapAndEmitAxeResults = async (axeResults, rel, pageState) => {
        // Violations → issues
        for (const v of axeResults.violations || []) {
          if (signal.aborted) break;

          const wcag     = extractWcag(v.tags);
          const severity = mapSeverity(v.impact);

          for (const node of v.nodes || []) {
            if (signal.aborted) break;
            const evidence = await buildNodeEvidence(activePage, node, pageState, signal);

            const failureSummary = (node.failureSummary || "")
              .replace(/^Fix any of the following:\s*/i, "")
              .replace(/^Fix all of the following:\s*/i, "");

            emit({
              severity, wcag,
              rule       : v.id,
              title      : v.help || v.id,
              desc       : v.description + (failureSummary ? `\n\nDetay: ${failureSummary}` : ""),
              file       : rel,
              line       : 0,
              lineContent: evidence.snippet,
              fix        : failureSummary || v.helpUrl || "",
              fixNote    : v.helpUrl ? `Detaylı bilgi: ${v.helpUrl}` : "",
              source     : "axe-core",
              selector   : evidence.selector,
              evidence,
              pageState,
              timestamp  : evidence.timestamp,
              url        : evidence.url,
              domPath    : evidence.context.domPath,
              ancestorSummary: evidence.context.ancestorSummary,
            });

            if (severity === "critical") safeLog(`  ✗ [${wcag}] ${v.help} → ${evidence.selector}`, "error");
            else if (severity === "warning") safeLog(`  ⚠ [${wcag}] ${v.help} → ${evidence.selector}`, "warn");
          }
        }

        // Incomplete → review
        for (const inc of (axeResults.incomplete || []).slice(0, 20)) {
          if (signal.aborted) break;

          const wcag = extractWcag(inc.tags);
          for (const node of (inc.nodes || []).slice(0, 3)) {
            if (signal.aborted) break;
            const evidence = await buildNodeEvidence(activePage, node, pageState, signal);
            emit({
              severity   : "review",
              wcag,
              rule       : inc.id + "-review",
              title      : `[İnceleme gerekli] ${inc.help || inc.id}`,
              desc       : inc.description + "\n\nBu kontrol otomatik olarak tamamlanamadı — manuel inceleme gerekli.",
              file       : rel,
              line       : 0,
              lineContent: evidence.snippet,
              fix        : inc.helpUrl || "",
              fixNote    : "Manuel inceleme gerekli.",
              source     : "axe-core",
              selector   : evidence.selector,
              evidence,
              pageState,
              timestamp  : evidence.timestamp,
              url        : evidence.url,
              domPath    : evidence.context.domPath,
              ancestorSummary: evidence.context.ancestorSummary,
            });
          }
        }

        const passCount      = (axeResults.passes || []).length;
        const violationCount = (axeResults.violations || []).length;
        safeLog(
          `  ${rel} [${pageState.scenario}]: ${violationCount} ihlal, ${passCount} başarılı kural`,
          violationCount > 0 ? "warn" : "info"
        );
      };

      // ── HTML dosyalarını sırayla tara ──────────────────────────────────
      while (scenarioQueue.length > 0) {
        const htmlFile = scenarioQueue.shift();
        // ★ İPTAL NOKTASI 1: Her dosya öncesi kontrol
        if (signal.aborted) {
          safeLog("⚑ axe-core döngüsü iptal ile durduruldu", "warn");
          break;
        }

        const rel = path.relative(folderPath, htmlFile).replace(/\\/g, "/");
        if (incrementalEnabled && incrementalPrev && !anyScriptChanged && !changedRelSet.has(rel)) {
          // HTML dosyası değişmemişse ve script tarafında değişiklik yoksa axe tekrarı atlanabilir.
          processedUnits++;
          safeProgress(rel);
          safeLog(`i incremental: DOM analizi atlandı (değişmedi) ${rel}`, "info");
          continue;
        }
        processedUnits++;
        safeProgress(rel);
        safeLog(`axe-core taraması: ${rel}`, "info");

        try {
          activePage = await browser.newPage();

          // ★ İPTAL NOKTASI 2: Sayfa açıldıktan hemen sonra
          if (signal.aborted) {
            await activePage.close().catch(() => {});
            activePage = null;
            break;
          }

          const fileUrl = "file:///" + htmlFile.replace(/\\/g, "/");
          const runStateAxe = async (stateName, stepId, stateSelector) => {
            const pageState = { scenario: stateName, stepId };
            const axeResults = await runAxeWithAbort(activePage, axeSource, signal);
            if (signal.aborted) return;
            await mapAndEmitAxeResults(axeResults, rel, pageState);
            if (stateSelector) {
              safeLog(`  ✓ state=${stateName}, step=${stepId}, selector=${stateSelector}`, "info");
            }
          };

          // Initial state
          await Promise.race([
            activePage.goto(fileUrl, { waitUntil: "load", timeout: PAGE_TIMEOUT }),
            onceAbort(signal),
          ]);
          await waitForPageStable(activePage, signal);
          await runStateAxe("initial-load", "initial.ready", "");

          // Scenario-driven states
          const scenarioNames = [
            "modal-open-state",
            "dropdown-expanded-state",
            "form-invalid-state",
            "toast-status-visible-state",
            "focus-order-state",
            "skip-link-activation-state",
            "loading-announcement-state",
            "route-change-state",
          ];

          for (const scenarioName of scenarioNames) {
            if (signal.aborted) break;

            // State sıfırlama: goto yerine scroll to top + DOM reset
            await Promise.race([
              activePage.evaluate(() => {
                window.scrollTo(0, 0);
                // Açık modalları kapat
                document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach((el) => {
                  el.setAttribute("aria-hidden", "true");
                  el.style.display = "none";
                });
                // Açık dropdown'ları kapat
                document.querySelectorAll('[aria-expanded="true"]').forEach((el) => {
                  el.setAttribute("aria-expanded", "false");
                });
              }),
              onceAbort(signal),
            ]);

            const result = await runScenarioState(activePage, signal, scenarioName);

            if (result.status === "ok") {
              // axe inject durumu korunmuş, sadece run et
              await runStateAxe(scenarioName, result.stepId || "scenario.ok", result.selector || "");
              continue;
            }

            if (result.status === "failed") {
              safeLog(`  ⚠ Scenario failed: ${scenarioName} step=${result.stepId} reason=${result.reason}`, "warn");
              emit(buildScenarioFailureIssue(rel, scenarioName, result.stepId, result.reason, result.selector, activePage.url()));
              continue;
            }

            safeLog(`  i Scenario skipped: ${scenarioName} reason=${result.reason}`, "info");
          }
        } catch (pageErr) {
          if (pageErr.code === "SCAN_CANCELLED") {
            safeLog("⚑ Sayfa taraması iptal edildi", "warn");
          } else {
            if (
              pageErr.name === "TimeoutError" ||
              /timeout/i.test(pageErr.message || "")
            ) {
              emit(buildScenarioFailureIssue(
                rel,
                "initial-load",
                "page.load",
                "timeout",
                "",
                activePage ? activePage.url() : ""
              ));
            }
            safeLog(`  ⚠ ${rel} yüklenemedi: ${pageErr.message}`, "warn");
          }
        } finally {
          if (activePage) {
            await activePage.close().catch(() => {});
            activePage = null;
          }
        }
      } // for htmlFiles

    } catch (browserErr) {
      if (browserErr.code !== "SCAN_CANCELLED") {
        safeLog(`⚠ Tarayıcı hatası: ${browserErr.message}`, "warn");
        safeLog("  Statik analiz ile devam ediliyor...", "warn");
      }
    } finally {
      // ★ BROWSER KAPAT — token iptal edilmiş olsa bile
      if (browser || activePage) {
        await teardownResources();
        safeLog("✓ Tarayıcı kapatıldı", "info");
      }
    }

    if (!signal.aborted) {
      safeLog("✓ axe-core DOM analizi tamamlandı\n", "info");
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // KATMAN 2: Statik kaynak kodu analizi
  // ════════════════════════════════════════════════════════════════════════

  // ★ İPTAL NOKTASI 5: Statik aşamaya geçmeden önce
  if (signal.aborted) {
    signal.removeEventListener("abort", onAbort);
    return _buildResult(issues, processedStaticFiles, {}, true);
  }

  safeLog(`── STATİK KOD ANALİZİ (${files.length} dosya) ──`, "info");

  // Proje geneli bağlam
  const projectCtx = {
    hasSkipLink  : false,
    htmlLangFound: false,
    hasVideo     : false,
    hasAudio     : false,
    hasCaptcha   : false,
    hasCanvas    : false,
  };

  // İki geçiş: (a) bağlam toplama, (b) kural uygulama
  // Bağlam toplama ayrı tutulur ki proje geneli kurallar doğru çalışsın.

  const allContents = [];

  // Geçiş (a) — bağlam toplama
  for (const file of files) {
    if (signal.aborted) break;

    const rel = path.relative(folderPath, file).replace(/\\/g, "/");
    const ext = path.extname(file).toLowerCase();
    let content;
    try { content = fs.readFileSync(file, "utf-8"); } catch { continue; }

    allContents.push({ rel, content, ext });

    const isPage = isPageRoot(rel, ext, content);
    if (isPage && detectSkipLinkInContent(content))
      projectCtx.hasSkipLink = true;

    if (/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(content))
      projectCtx.htmlLangFound = true;

    if (/<video[\s>]/i.test(content))           projectCtx.hasVideo    = true;
    if (/<audio[\s>]/i.test(content))           projectCtx.hasAudio    = true;
    if (/<canvas[\s>]/i.test(content))          projectCtx.hasCanvas   = true;
    if (/captcha|recaptcha|hcaptcha|cf-turnstile/i.test(content)) projectCtx.hasCaptcha = true;
  }

  // Geçiş (b) — kural uygulama
  for (const { rel, content, ext } of allContents) {
    // ★ İPTAL NOKTASI 6: Her dosya başında
    if (signal.aborted) {
      safeLog("⚑ Statik analiz döngüsü iptal ile durduruldu", "warn");
      break;
    }

    processedStaticFiles++;
    processedUnits++;
    safeProgress(rel);

    if (incrementalEnabled && incrementalPrev && !changedRelSet.has(rel)) {
      staticSkippedByIncremental++;
      continue;
    }

    const isHTML     = [".html", ".htm"].includes(ext);
    const isJSX      = [".jsx", ".tsx"].includes(ext);
    const isJS       = [".js", ".ts", ".jsx", ".tsx"].includes(ext);
    const isVue      = ext === ".vue";
    const isCSS      = [".css", ".scss", ".sass"].includes(ext);
    const isTemplate = isHTML || isJSX || isVue || ext === ".svelte";

    if (isTemplate) {
      const isPage = isPageRoot(rel, ext, content);

      staticCheckKeyboard(content, rel, emit, isJSX);
      staticCheckLiveRegions(content, rel, emit);
      staticCheckModals(content, rel, emit);
      staticCheckDropdowns(content, rel, emit);
      staticCheckMediaAccessibility(content, rel, emit);
      staticCheckLinks(content, rel, emit);
      staticCheckColorInfo(content, rel, emit);
      staticCheckFormErrors(content, rel, emit);

      // Sayfa-düzeyinde kontroller sadece sayfa köklerine uygulanır
      if (isPage) {
        staticCheckHeadingHierarchy(content, rel, emit);
      }
    }

    if (isJS || isVue) staticCheckJSBehavior(content, rel, emit, safeLog);
    if (isCSS)         staticCheckCSS(content, rel, emit, safeLog);
  }

  // Medya bağlam logları
  if (!signal.aborted) {
    if (projectCtx.hasVideo)   safeLog("  📹 Video içeriği tespit edildi → WCAG 1.2.2 kontrol listesi aktif", "info");
    if (projectCtx.hasAudio)   safeLog("  🔊 Ses içeriği tespit edildi → WCAG 1.2.1 kontrol listesi aktif", "info");
    if (projectCtx.hasCaptcha) safeLog("  🤖 CAPTCHA tespit edildi → WCAG 1.1.1 alternatif kontrol aktif", "warn");
    if (projectCtx.hasCanvas)  safeLog("  🎨 Canvas içeriği tespit edildi → WCAG 4.1.2 canvas kontrol aktif", "info");
  }

  // Zorunlu custom kurallar (axe/statik varsayılanlarının önünde birincil sözleşme seti)
  if (!signal.aborted) {
    evaluateMandatoryCustomRules(allContents, emit);
  }

  // Proje geneli kurallar
  if (!signal.aborted) {
    if (!projectCtx.hasSkipLink) {
      emit({
        severity: "critical", wcag: "2.4.1", rule: "skip-link-missing",
        title: "Projede skip link (ana içeriğe atla) bulunamadı",
        desc: "Hiçbir dosyada skip link tespit edilemedi. Klavye kullanıcıları tekrarlanan blokları atlayamaz.",
        file: "(proje geneli)", line: 0, lineContent: "",
        fix: '<a className="skip-link" href="#main">Ana İçeriğe Atla</a>',
        fixNote: "Ana layout bileşeninin en üstüne skip link ekleyin.",
        source: "static",
      });
    }

    if (!projectCtx.htmlLangFound) {
      emit({
        severity: "critical", wcag: "3.1.1", rule: "html-lang-missing",
        title: "Projede html lang niteliği bulunamadı",
        desc: 'Hiçbir HTML dosyasında <html lang="..."> tespit edilemedi.',
        file: "(proje geneli)", line: 0, lineContent: "",
        fix: '<html lang="tr">',
        fixNote: 'index.html veya ana template\'de <html lang="tr"> kullanın.',
        source: "static",
      });
    }

    if (projectCtx.hasCaptcha) {
      emit({
        severity: "review", wcag: "1.1.1", rule: "captcha-detected",
        title: "CAPTCHA tespit edildi — alternatif erişim manuel kontrol edilmeli",
        desc: "Projede CAPTCHA kullanımı tespit edildi. Görsel CAPTCHA için sesli alternatif sunulması WCAG 1.1.1 gereğidir.",
        file: "(proje geneli)", line: 0, lineContent: "",
        fix: "Sesli CAPTCHA alternatifi ekleyin veya daha erişilebilir bir doğrulama yöntemi kullanın.",
        fixNote: "CAPTCHA erişilebilirliği manuel doğrulama gerektirir.",
        source: "static",
      });
    }
  }

  signal.removeEventListener("abort", onAbort);
  if (incrementalEnabled && !signal.aborted) {
    saveIncrementalCache(folderPath, currentSignatures);
    if (staticSkippedByIncremental > 0) {
      safeLog(`i incremental: ${staticSkippedByIncremental} dosyada statik kontrol atlandı (değişmedi).`, "info");
    }
  }
  return _buildResult(issues, processedStaticFiles, projectCtx, signal.aborted, {
    scanDurationMs: Date.now() - scanStartTime,
    axeCoreVersion: (() => { try { return require("axe-core/package.json").version; } catch { return "unknown"; } })(),
    wcagLevel: "A",
    wcagVersion: "2.2",
    totalHtmlFiles: htmlFiles.length,
    totalStaticFiles: files.length,
    incrementalEnabled,
    incrementalChangedFiles: changedRelSet.size,
    incrementalSkippedStaticFiles: staticSkippedByIncremental,
  });
}

// ── Sonuç nesnesi ────────────────────────────────────────────────────────────

function _buildResult(issues, totalFiles, mediaCtx, cancelled, scanMeta) {
  const visibleFindings = issues.filter((i) => !i.hidden);
  const infraLogs = issues.filter((i) => i.hidden);
  return {
    technicalFindings: visibleFindings,
    issues: visibleFindings, // backward-compat
    infraLogs,
    totalFiles,
    mediaCtx,
    cancelled: !!cancelled,
    scanMeta: scanMeta || {},
  };
}

// ── Dosya toplama ────────────────────────────────────────────────────────────

/**
 * Dosyanın sayfa kökü mü yoksa yeniden kullanılabilir bileşen mi olduğunu tahmin eder.
 *
 * Sayfa kökü işaretleri:
 * - HTML dosyaları her zaman sayfa köküdür
 * - JSX/TSX dosyaları şu koşullardan en az birini sağlıyorsa sayfa köküdür:
 *   a) Dosya adı: index, page, Page, app, App, layout, Layout, Home, home içeriyor
 *   b) Dosya yolu: /pages/, /app/, /views/, /screens/, /routes/ içeriyor
 *   c) İçeriği: <html, <body, <main içeriyor
 *   d) İçeriği: export default function App, export default function Page, useRouter, useNavigate içeriyor
 */
function isPageRoot(rel, ext, content) {
  if ([".html", ".htm"].includes(ext)) return true;
  if (![".jsx", ".tsx", ".vue", ".svelte"].includes(ext)) return false;

  const fileName = path.basename(rel, ext).toLowerCase();
  const pageNameHints = ["index", "page", "app", "layout", "home", "root", "main", "dashboard", "portal"];
  if (pageNameHints.some((hint) => fileName === hint || fileName.startsWith(hint + "-") || fileName.endsWith("-" + hint))) return true;

  const pathLower = rel.toLowerCase();
  const pagePathHints = ["/pages/", "/app/", "/views/", "/screens/", "/routes/", "\\pages\\", "\\app\\", "\\views\\"];
  if (pagePathHints.some((hint) => pathLower.includes(hint))) return true;

  if (/<html\b|<body\b|<main\b/i.test(content)) return true;
  if (/export\s+default\s+function\s+(App|Page|Layout|Home|Root|Dashboard)\b/i.test(content)) return true;
  if (/useRouter|useNavigate|createBrowserRouter|createRoot|ReactDOM\.render/i.test(content)) return true;

  return false;
}

function collectFiles(dir) {
  const r = [];
  (function walk(d) {
    try {
      for (const item of fs.readdirSync(d)) {
        if (SKIP_DIRS.includes(item) || item.startsWith(".")) continue;
        const full = path.join(d, item);
        try {
          const s = fs.statSync(full);
          if (s.isDirectory()) {
            walk(full);
          } else if (
            s.size <= MAX_FILE_SIZE &&
            SCAN_EXTS.includes(path.extname(item).toLowerCase())
          ) {
            r.push(full);
          }
        } catch {}
      }
    } catch {}
  })(dir);
  return r;
}

// ── Satır yardımcıları ───────────────────────────────────────────────────────

function ln(c, i) { return c.substring(0, i).split("\n").length; }
function lc(c, n) { return (c.split("\n")[n - 1] || "").trim(); }
function stripTags(s) { return (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function snip(s, n = 220) { return (s || "").trim().slice(0, n); }
function normalizeLang(v) { return (v || "").trim().toLowerCase(); }
function statusSeverity(status) {
  if (status === "FAIL") return "critical";
  if (status === "WARNING") return "warning";
  return "review";
}
function toFindingStatus(status) {
  if (status === "PASS" || status === "FAIL" || status === "WARNING" || status === "N/A" || status === "MANUAL") return status;
  return "WARNING";
}
function hasAriaLiveOrStatus(s) {
  return /aria-live\s*=\s*["'](polite|assertive)["']|role\s*=\s*["'](status|alert|log)["']/i.test(s || "");
}

function emitCustomRule(emit, data) {
  emit({
    severity: statusSeverity(data.status),
    status: toFindingStatus(data.status),
    wcag: data.wcag || "",
    rule: data.rule,
    title: data.title,
    desc: data.desc,
    reason: data.reason || data.desc,
    confidence: data.confidence || "high",
    file: data.file || "(proje geneli)",
    line: data.line || 0,
    lineContent: data.lineContent || "",
    fix: data.fix || "",
    fixNote: data.fixNote || "",
    source: "custom-rule",
    selector: data.selector || "",
    evidence: data.evidence || {
      selector: data.selector || "",
      snippet: data.lineContent || "",
      context: { domPath: "", ancestorSummary: "" },
      pageState: { scenario: "static-source", stepId: data.rule },
      timestamp: new Date().toISOString(),
      url: "",
    },
  });
}

function evaluateMandatoryCustomRules(allContents, emit) {
  const templateFiles = allContents.filter((x) => [".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte"].includes(x.ext));
  const anchorInFile = (f, patterns) => {
    const list = Array.isArray(patterns) ? patterns : [patterns];
    for (const p of list) {
      const re = p instanceof RegExp ? p : new RegExp(String(p), "i");
      const m = re.exec(f.content || "");
      if (m) {
        const line = ln(f.content, m.index);
        return { line, lineContent: lc(f.content, line) || snip(m[0], 220) };
      }
    }
    return { line: 1, lineContent: snip(f.content, 220) };
  };

  // 1) IMG alt mandatory non-empty
  {
    const imgIssues = [];
    let imgCount = 0;
    for (const f of templateFiles) {
      let m;
      const re = /<img\b([^>]*?)>/gi;
      while ((m = re.exec(f.content)) !== null) {
        imgCount++;
        const attrs = m[1] || "";
        const altMatch = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i);
        const line = ln(f.content, m.index);
        if (!altMatch) {
          imgIssues.push({ f, line, snippet: snip(m[0]), reason: "alt niteliği eksik" });
        } else if (!altMatch[1].trim()) {
          // Boş alt: dekoratif ise geçerli, değilse FAIL
          const isDecorative =
            /role\s*=\s*["'](presentation|none)["']/i.test(attrs) ||
            /aria-hidden\s*=\s*["']true["']/i.test(attrs);
          if (!isDecorative) {
            imgIssues.push({
              f, line, snippet: snip(m[0]),
              reason: "alt boş ve dekoratif işaretlenmemiş (role=\"presentation\" veya aria-hidden=\"true\" eksik)"
            });
          }
        }
      }
    }
    if (imgCount === 0) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "1.1.1", rule: "custom-img-alt-nonempty",
        title: "IMG alt kontrolü uygulanamaz", desc: "Projede <img> etiketi bulunamadı.",
      });
    } else if (imgIssues.length > 0) {
      const x = imgIssues[0];
      emitCustomRule(emit, {
        status: "FAIL", wcag: "1.1.1", rule: "custom-img-alt-nonempty",
        title: "IMG alt zorunluluğu sağlanmadı",
        desc: `Her <img> için non-empty alt zorunludur. Sorun: ${x.reason}.`,
        reason: `IMG alt kuralı ihlali: ${x.reason}`,
        file: x.f.rel, line: x.line, lineContent: x.snippet,
        fix: '<img src=\"...\" alt=\"Açıklayıcı metin\">',
      });
    } else {
      emitCustomRule(emit, {
        status: "PASS", wcag: "1.1.1", rule: "custom-img-alt-nonempty",
        title: "IMG alt zorunluluğu sağlandı",
        desc: `Tüm ${imgCount} <img> etiketi non-empty alt ile bulundu.`,
      });
    }
  }

  // 2) html lang exact mandatory
  {
    const htmlFiles = allContents.filter((x) => [".html", ".htm"].includes(x.ext));
    const langFindings = [];
    for (const f of htmlFiles) {
      const m = f.content.match(/<html\b([^>]*)>/i);
      if (!m) continue;
      const attrs = m[1] || "";
      const l = attrs.match(/\blang\s*=\s*["']([^"']+)["']/i);
      langFindings.push({ f, value: l ? normalizeLang(l[1]) : null, snippet: snip(m[0]) });
    }
    if (langFindings.length === 0) {
      emitCustomRule(emit, {
        status: "FAIL", wcag: "3.1.1", rule: "custom-html-lang-tr",
        title: "html lang zorunluluğu sağlanmadı",
        desc: "<html lang=\"tr\"> zorunlu; HTML dosyalarında html lang tespit edilmedi.",
        fix: `<html lang=\"${REQUIRED_HTML_LANG}\">`,
      });
    } else {
      const invalid = langFindings.find((x) => {
        if (!x.value) return true;
        if (ALLOW_LANG_PREFIX) return !(x.value === REQUIRED_HTML_LANG || x.value.startsWith(REQUIRED_HTML_LANG + "-"));
        return x.value !== REQUIRED_HTML_LANG;
      });
      if (invalid) {
        emitCustomRule(emit, {
          status: "FAIL", wcag: "3.1.1", rule: "custom-html-lang-tr",
          title: "html lang zorunluluğu sağlanmadı",
          desc: `Beklenen: <html lang=\"${REQUIRED_HTML_LANG}\"> (varsayılan strict).`,
          reason: `Geçersiz/missing lang: ${invalid.value || "missing"}`,
          file: invalid.f.rel, line: 1, lineContent: invalid.snippet,
          fix: `<html lang=\"${REQUIRED_HTML_LANG}\">`,
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "3.1.1", rule: "custom-html-lang-tr",
          title: "html lang zorunluluğu sağlandı",
          desc: `Tüm HTML dosyalarında lang=${REQUIRED_HTML_LANG} doğrulandı.`,
        });
      }
    }
  }

  // 3) Modal close label Turkish meaningful
  {
    const modalFiles = templateFiles.filter((f) => /modal|role\s*=\s*["']dialog["']|aria-modal/i.test(f.content));
    if (!modalFiles.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "4.1.2", rule: "custom-modal-close-label-tr",
        title: "Modal close label kontrolü uygulanamaz", desc: "Modal/dialog bileşeni tespit edilmedi.",
      });
    } else {
      let bad = null;
      let foundCandidate = 0;
      for (const f of modalFiles) {
        let m;
        const re = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
        while ((m = re.exec(f.content)) !== null) {
          const tag = m[0];
          if (!/close|kapat|dismiss|×|x/i.test(tag)) continue;
          foundCandidate++;
          const attrs = m[2] || "";
          const bodyText = stripTags(m[3] || "");
          const aria = (attrs.match(/\baria-label\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
          const title = (attrs.match(/\btitle\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
          const name = (aria || title || bodyText || "").trim().toLowerCase();
          const line = ln(f.content, m.index);
          const disallowed = !name || name === "close" || name === "x" || name === "×";
          const allowed = ALLOWED_MODAL_CLOSE_LABELS.has(name);
          if (disallowed || !allowed) {
            bad = { f, line, snippet: snip(tag), name };
            break;
          }
        }
        if (bad) break;
      }
      if (foundCandidate === 0) {
        emitCustomRule(emit, {
          status: "WARNING", wcag: "4.1.2", rule: "custom-modal-close-label-tr",
          title: "Modal close label doğrulanamadı",
          desc: "Modal var ancak close kontrolü için aday buton bulunamadı.",
        });
      } else if (bad) {
        emitCustomRule(emit, {
          status: "FAIL", wcag: "4.1.2", rule: "custom-modal-close-label-tr",
          title: "Modal kapatma etiketi Türkçe/anlamlı değil",
          desc: `Kapatma adı geçersiz: \"${bad.name || "empty"}\".`,
          file: bad.f.rel, line: bad.line, lineContent: bad.snippet,
          fix: 'aria-label=\"Kapat\"',
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "4.1.2", rule: "custom-modal-close-label-tr",
          title: "Modal kapatma etiketi doğrulandı",
          desc: "Modal close adları Türkçe ve anlamlı bulundu.",
        });
      }
    }
  }

  // 4) Icon-only button naming + decorative icon aria-hidden
  {
    let iconOnlyCount = 0;
    let bad = null;
    for (const f of templateFiles) {
      let m;
      const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
      while ((m = re.exec(f.content)) !== null) {
        const attrs = m[1] || "";
        const inner = m[2] || "";
        const visibleText = stripTags(inner.replace(/<span\b[^>]*class=["'][^"']*(sr-only|visually-hidden)[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ""));
        const hasIcon = /<(svg|i)\b/i.test(inner);
        if (!hasIcon || visibleText.length > 0) continue;
        iconOnlyCount++;

        const hasHiddenReadable = /<span\b[^>]*class=["'][^"']*(sr-only|visually-hidden)[^"']*["'][^>]*>\s*[^<\s][\s\S]*?<\/span>/i.test(inner);
        const decorativeIconsHidden = !/<(svg|i)\b(?![^>]*\baria-hidden\s*=\s*["']true["'])/i.test(inner);
        if (!hasHiddenReadable || !decorativeIconsHidden) {
          bad = { f, line: ln(f.content, m.index), snippet: snip(m[0]), hasHiddenReadable, decorativeIconsHidden };
          break;
        }
      }
      if (bad) break;
    }
    if (iconOnlyCount === 0) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "4.1.2", rule: "custom-icon-only-button-name",
        title: "Icon-only button kontrolü uygulanamaz", desc: "Icon-only buton tespit edilmedi.",
      });
    } else if (bad) {
      emitCustomRule(emit, {
        status: "FAIL", wcag: "4.1.2", rule: "custom-icon-only-button-name",
        title: "Icon-only button erişilebilir adı eksik",
        desc: "Icon-only butonlarda hidden readable text ve decorative icon aria-hidden=\"true\" zorunludur.",
        file: bad.f.rel, line: bad.line, lineContent: bad.snippet,
        fix: '<button><span class=\"sr-only\">Kapat</span><svg aria-hidden=\"true\" ...></svg></button>',
      });
    } else {
      emitCustomRule(emit, {
        status: "PASS", wcag: "4.1.2", rule: "custom-icon-only-button-name",
        title: "Icon-only button kuralı sağlandı",
        desc: `Tespit edilen ${iconOnlyCount} icon-only buton için adlandırma/dekoratif ikon kuralları sağlandı.`,
      });
    }
  }

  // 5) Non-semantic interactives strict fallback
  {
    const nonSem = [];
    for (const f of templateFiles) {
      let m;
      const re = /<(div|span|li|p|section|article)\b([^>]*)>/gi;
      while ((m = re.exec(f.content)) !== null) {
        const attrs = m[2] || "";
        if (!/\bonclick\b|\bonClick\b/i.test(attrs)) continue;
        const roleOk = /\brole\s*=\s*["'](button|link|menuitem|tab|option)["']/i.test(attrs);
        const focusable = /\btabindex\s*=\s*["']?0["']?|\btabIndex\s*=\s*\{?0\}?/i.test(attrs);
        const keyboard = /\bonkey(down|up|press)\b|\bonKey(Down|Up|Press)\b/i.test(attrs);
        const nameOk = /\baria-label\b|\baria-labelledby\b/i.test(attrs) || stripTags(m[0]).length > 0;
        nonSem.push({ f, line: ln(f.content, m.index), snippet: snip(m[0]), roleOk, focusable, keyboard, nameOk });
      }
    }
    if (!nonSem.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "2.1.1", rule: "custom-nonsemantic-interactive-fallback",
        title: "Non-semantic interactive kontrolü uygulanamaz", desc: "Non-semantic onClick bileşeni tespit edilmedi.",
      });
    } else {
      const bad = nonSem.find((x) => !(x.roleOk && x.focusable && x.keyboard && x.nameOk));
      if (bad) {
        emitCustomRule(emit, {
          status: "FAIL", wcag: "2.1.1", rule: "custom-nonsemantic-interactive-fallback",
          title: "Non-semantic interactive fallback eksik",
          desc: "role + focusability + keyboard + accessible name zorunludur.",
          file: bad.f.rel, line: bad.line, lineContent: bad.snippet,
          fix: '<div role=\"button\" tabIndex={0} aria-label=\"...\" onClick={fn} onKeyDown={fn}>',
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "2.1.1", rule: "custom-nonsemantic-interactive-fallback",
          title: "Non-semantic interactive fallback doğrulandı",
          desc: `Tespit edilen ${nonSem.length} non-semantic interactive için strict fallback doğrulandı.`,
        });
      }
    }
  }

  // 6) Menus pattern
  {
    const filesWithMenu = templateFiles.filter((f) => /menu|menubar|nav|role\s*=\s*["']menu/i.test(f.content));
    if (!filesWithMenu.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "4.1.2", rule: "custom-menu-pattern",
        title: "Menu pattern kontrolü uygulanamaz", desc: "Menu/nav bileşeni tespit edilmedi.",
      });
    } else {
      let bad = null;
      for (const f of filesWithMenu) {
        const semanticOk = /<nav[\s>][\s\S]*?<ul[\s>][\s\S]*?<li[\s>]/i.test(f.content);
        const customMenu = /role\s*=\s*["'](menu|menubar)["']|class(?:Name)?\s*=\s*["'][^"']*menu/i.test(f.content);
        if (!customMenu && semanticOk) continue;
        const ariaOk = /role\s*=\s*["'](menu|menubar)["']/i.test(f.content) && /role\s*=\s*["']menuitem["']/i.test(f.content);
        const keyboardOk = /ArrowDown|ArrowUp|Home|End|Escape|onKeyDown|onkeydown/.test(f.content);
        if (!(semanticOk || (ariaOk && keyboardOk))) {
          bad = f;
          break;
        }
      }
      if (bad) {
        const anchor = anchorInFile(bad, [/role\s*=\s*["'](menu|menubar|menuitem)["']/i, /<nav\b/i, /class(?:Name)?\s*=\s*["'][^"']*menu/i]);
        emitCustomRule(emit, {
          status: "FAIL", wcag: "4.1.2", rule: "custom-menu-pattern",
          title: "Menu pattern eksik/incomplete",
          desc: "Custom menu için tam ARIA pattern + keyboard davranışı zorunlu; eksik pattern FAIL.",
          file: bad.rel, line: anchor.line, lineContent: anchor.lineContent,
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "4.1.2", rule: "custom-menu-pattern",
          title: "Menu pattern doğrulandı", desc: "Semantic nav+ul/li veya complete custom ARIA menu pattern doğrulandı.",
        });
      }
    }
  }

  // 7) Dropdown validation
  {
    const ddFiles = templateFiles.filter((f) => /dropdown|combobox|aria-haspopup/i.test(f.content));
    if (!ddFiles.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "4.1.2", rule: "custom-dropdown-a11y",
        title: "Dropdown kontrolü uygulanamaz", desc: "Dropdown benzeri bileşen tespit edilmedi.",
      });
    } else {
      let bad = null;
      for (const f of ddFiles) {
        const must = /aria-expanded/i.test(f.content) && /aria-controls/i.test(f.content) &&
          /aria-haspopup/i.test(f.content) && (/aria-label|aria-labelledby/i.test(f.content));
        const keyboard = /ArrowDown|ArrowUp|Enter|Escape|onKeyDown|onkeydown/.test(f.content);
        const helperExists = /helper|hint|yardım|aciklama|açıklama|desc/i.test(f.content);
        const helperLinked = !helperExists || /aria-describedby/i.test(f.content);
        if (!(must && keyboard && helperLinked)) { bad = f; break; }
      }
      if (bad) {
        const anchor = anchorInFile(bad, [/dropdown|combobox|aria-haspopup/i, /aria-expanded/i, /aria-controls/i]);
        emitCustomRule(emit, {
          status: "FAIL", wcag: "4.1.2", rule: "custom-dropdown-a11y",
          title: "Dropdown erişilebilirlik koşulları eksik",
          desc: "aria-expanded/controls/haspopup/name, helper-describedby ve keyboard interaction zorunludur.",
          file: bad.rel, line: anchor.line, lineContent: anchor.lineContent,
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "4.1.2", rule: "custom-dropdown-a11y",
          title: "Dropdown erişilebilirlik koşulları sağlandı",
          desc: "Zorunlu ARIA, helper linkage ve keyboard davranışı doğrulandı.",
        });
      }
    }
  }

  // 8) Modal focus management
  {
    const modalFiles = templateFiles.filter((f) => /modal|role\s*=\s*["']dialog["']|aria-modal/i.test(f.content));
    if (!modalFiles.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "2.1.2", rule: "custom-modal-focus-management",
        title: "Modal focus yönetimi uygulanamaz", desc: "Modal/dialog tespit edilmedi.",
      });
    } else {
      let bad = null;
      for (const f of modalFiles) {
        const focusInto = /focus\(\)|autoFocus|initialFocus|focusFirst/i.test(f.content);
        const trap = /focus.?trap|trapTabKey|FocusTrap|focus-lock/i.test(f.content);
        const returnTrigger = /return.*focus|trigger.*focus|previous.*focus|lastActiveElement.*focus/i.test(f.content);
        if (!(focusInto && trap && returnTrigger)) {
          bad = { f, focusInto, trap, returnTrigger };
          break;
        }
      }
      if (bad) {
        const anchor = anchorInFile(bad.f, [/role\s*=\s*["']dialog["']/i, /aria-modal/i, /focus|FocusTrap|focus-lock|lastActiveElement/i]);
        emitCustomRule(emit, {
          status: "FAIL", wcag: "2.1.2", rule: "custom-modal-focus-management",
          title: "Modal focus yönetimi eksik",
          desc: "Open->focus-in, trap ve close->trigger'e focus return zorunludur. Return-to-trigger eksikliği FAIL.",
          file: bad.f.rel, line: anchor.line, lineContent: anchor.lineContent,
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "2.1.2", rule: "custom-modal-focus-management",
          title: "Modal focus yönetimi doğrulandı",
          desc: "Focus-in, trap ve return-to-trigger davranışı için sinyaller bulundu.",
        });
      }
    }
  }

  // 9) Tabs ARIA model
  {
    const tabFiles = templateFiles.filter((f) => /tablist|tabpanel|role\s*=\s*["']tab["']/i.test(f.content));
    if (!tabFiles.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "4.1.2", rule: "custom-tabs-pattern",
        title: "Tabs pattern kontrolü uygulanamaz", desc: "Tabs bileşeni tespit edilmedi.",
      });
    } else {
      let bad = null;
      for (const f of tabFiles) {
        const ok = /role\s*=\s*["']tablist["']/i.test(f.content) &&
          /role\s*=\s*["']tab["']/i.test(f.content) &&
          /role\s*=\s*["']tabpanel["']/i.test(f.content) &&
          /aria-selected/i.test(f.content);
        const wrong = /role\s*=\s*["']tab["'][^>]*aria-pressed/i.test(f.content);
        if (!ok || wrong) { bad = { f, wrong }; break; }
      }
      if (bad) {
        const anchor = anchorInFile(bad.f, [/role\s*=\s*["']tablist["']/i, /role\s*=\s*["']tab["']/i, /role\s*=\s*["']tabpanel["']/i, /aria-selected/i]);
        emitCustomRule(emit, {
          status: "FAIL", wcag: "4.1.2", rule: "custom-tabs-pattern",
          title: "Tabs ARIA modeli hatalı",
          desc: "tablist/tab/tabpanel + aria-selected zorunlu; aria-pressed tab seçimi için kullanılamaz.",
          file: bad.f.rel, line: anchor.line, lineContent: anchor.lineContent,
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "4.1.2", rule: "custom-tabs-pattern",
          title: "Tabs ARIA modeli doğrulandı", desc: "tablist/tab/tabpanel ve aria-selected kullanımı doğrulandı.",
        });
      }
    }
  }

  // 10) Headings mandatory + skip warning
  {
    const allText = templateFiles.map((f) => f.content).join("\n");
    const h1Count = (allText.match(/<h1\b/gi) || []).length;
    if (h1Count < 1) {
      emitCustomRule(emit, {
        status: "FAIL", wcag: "2.4.2", rule: "custom-headings-structure",
        title: "En az bir H1 zorunluluğu sağlanmadı",
        desc: "Proje genelinde en az bir <h1> bulunmalıdır (missing H1 = FAIL).",
      });
    } else {
      emitCustomRule(emit, {
        status: "PASS", wcag: "2.4.2", rule: "custom-headings-structure",
        title: "H1 zorunluluğu doğrulandı", desc: `Proje genelinde ${h1Count} adet H1 bulundu.`,
      });
    }

    // Proje ölçeğinde heading skip özeti (satır bilgisiyle birlikte)
    let skipSummary = null;
    for (const f of templateFiles) {
      const headingRe = /<(h[1-6])\b[^>]*>/gi;
      const seq = [];
      let m;
      while ((m = headingRe.exec(f.content)) !== null) {
        seq.push({ level: Number(m[1][1]), index: m.index });
      }
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1];
        const curr = seq[i];
        if (curr.level > prev.level + 1) {
          const line = ln(f.content, curr.index);
          skipSummary = {
            f,
            line,
            lineContent: lc(f.content, line) || snip(f.content.substring(curr.index, curr.index + 200), 200),
            from: prev.level,
            to: curr.level,
          };
          break;
        }
      }
      if (skipSummary) break;
    }

    if (skipSummary) {
      emitCustomRule(emit, {
        status: "WARNING", wcag: "1.3.1", rule: "custom-headings-skip-warning",
        title: "Heading skip tespit edildi",
        desc: `Heading seviyesinde atlama var (H${skipSummary.from}->H${skipSummary.to}).`,
        file: skipSummary.f.rel,
        line: skipSummary.line,
        lineContent: skipSummary.lineContent,
      });
    }
  }

  // 11) Form validation + announcements
  {
    const formFiles = templateFiles.filter((f) => /<form\b|<input\b|<textarea\b|<select\b/i.test(f.content));
    if (!formFiles.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "3.3.1", rule: "custom-form-validation-announcement",
        title: "Form doğrulama kontrolü uygulanamaz", desc: "Form bileşeni tespit edilmedi.",
      });
    } else {
      let bad = null;
      for (const f of formFiles) {
        const invalid = /aria-invalid/i.test(f.content);
        const link = /aria-errormessage|aria-describedby/i.test(f.content);
        const announced = hasAriaLiveOrStatus(f.content);
        if (!(invalid && link && announced)) { bad = f; break; }
      }
      if (bad) {
        const anchor = anchorInFile(bad, [/<form\b/i, /aria-invalid/i, /aria-errormessage|aria-describedby/i, /role\s*=\s*["']alert["']|aria-live/i]);
        emitCustomRule(emit, {
          status: "FAIL", wcag: "3.3.1", rule: "custom-form-validation-announcement",
          title: "Form doğrulama/anons koşulları eksik",
          desc: "aria-invalid + error linkage + SR anons (live region) zorunludur.",
          file: bad.rel, line: anchor.line, lineContent: anchor.lineContent,
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "3.3.1", rule: "custom-form-validation-announcement",
          title: "Form doğrulama/anons koşulları doğrulandı",
          desc: "Form hata/başarı/durum anonsları için erişilebilirlik sinyalleri doğrulandı.",
        });
      }
    }
  }

  // 12) Runtime status + toast announcements
  {
    let foundDynamicStatus = false;
    let bad = null;
    for (const f of templateFiles) {
      if (!/Yükleniyor|Yukleniyor|Sonuç bulunamadı|Sonuc bulunamadi|toast|status|notification/i.test(f.content)) continue;
      foundDynamicStatus = true;
      if (!hasAriaLiveOrStatus(f.content)) {
        bad = f;
        break;
      }
    }
    if (!foundDynamicStatus) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "4.1.2", rule: "custom-runtime-status-toast-live",
        title: "Runtime status/toast kontrolü uygulanamaz", desc: "Dinamik durum/toast metni tespit edilmedi.",
      });
    } else if (bad) {
      const anchor = anchorInFile(bad, [/Yükleniyor|Yukleniyor|Sonuç bulunamadı|Sonuc bulunamadi|toast|status|notification/i, /aria-live|role\s*=\s*["'](status|alert|log)["']/i]);
      emitCustomRule(emit, {
        status: "FAIL", wcag: "4.1.2", rule: "custom-runtime-status-toast-live",
        title: "Dinamik durum/toast live region anonsu eksik",
        desc: "\"Yükleniyor\", \"Sonuç bulunamadı\" ve toast/status içerikleri uygun politeness ile live region üzerinden anons edilmelidir.",
        file: bad.rel, line: anchor.line, lineContent: anchor.lineContent,
      });
    } else {
      emitCustomRule(emit, {
        status: "PASS", wcag: "4.1.2", rule: "custom-runtime-status-toast-live",
        title: "Dinamik durum/toast anonsu doğrulandı",
        desc: "Dinamik status/toast içerikleri için live region sinyalleri doğrulandı.",
      });
    }
  }

  // 13) Component-level a11y gate (frontend bileşen kapısı)
  {
    const strictComponentGate = process.env.A11Y_COMPONENT_GATE === "1";
    const componentFiles = templateFiles.filter((f) =>
      /(^|\/)(components?|ui|widgets?)\//i.test(f.rel) ||
      /\/[A-Z][A-Za-z0-9_-]*\.(jsx|tsx|vue|svelte)$/i.test(f.rel)
    );

    if (!componentFiles.length) {
      emitCustomRule(emit, {
        status: strictComponentGate ? "FAIL" : "N/A",
        wcag: "4.1.2",
        rule: "custom-component-a11y-gate",
        title: strictComponentGate ? "Bileşen erişilebilirlik kapısı ihlali" : "Bileşen erişilebilirlik kapısı uygulanamaz",
        desc: strictComponentGate
          ? "Strict gate etkin fakat bileşen klasörü veya bileşen adı desenine uyan dosya bulunamadı."
          : "Bileşen klasörü veya bileşen adı desenine uyan dosya bulunamadı.",
      });
    } else {
      let bad = null;
      let checkedInteractiveCount = 0;
      const nativeInteractiveTags = new Set(["button", "a", "input", "select", "textarea", "summary", "option"]);

      function hasTextContentNear(content, openTagIndex, tagName) {
        const openEnd = content.indexOf(">", openTagIndex);
        if (openEnd < 0) return false;
        const closeTag = `</${String(tagName || "").toLowerCase()}>`;
        const closeIdx = content.toLowerCase().indexOf(closeTag, openEnd + 1);
        if (closeIdx < 0) return false;
        const inner = content.substring(openEnd + 1, Math.min(closeIdx, openEnd + 600));
        return stripTags(inner).length > 0;
      }

      for (const f of componentFiles) {
        // Non-semantic interactive: onClick var ise role+tabIndex+keyboard+name zorunlu.
        let m;
        const nonSemRe = /<(div|span|li|p|section|article)\b([^>]*\bon(?:Click|click)\b[^>]*)>/gi;
        while ((m = nonSemRe.exec(f.content)) !== null) {
          checkedInteractiveCount++;
          const attrs = m[2] || "";
          const hasRole = /\brole\s*=\s*["'](button|link|menuitem|tab|option|switch|checkbox|radio)["']/i.test(attrs);
          const hasTab = /\btabindex\s*=\s*["']?0["']?|\btabIndex\s*=\s*\{?0\}?/i.test(attrs);
          const hasKeyboard = /\bonkey(down|up|press)\b|\bonKey(Down|Up|Press)\b/i.test(attrs);
          const hasName = /\baria-label\s*=|\baria-labelledby\s*=/i.test(attrs) || hasTextContentNear(f.content, m.index, m[1]);
          if (!(hasRole && hasTab && hasKeyboard && hasName)) {
            const missing = [
              hasRole ? null : "role",
              hasTab ? null : "tabIndex",
              hasKeyboard ? null : "keyboard",
              hasName ? null : "erişilebilir isim",
            ].filter(Boolean).join(", ");
            bad = {
              f,
              line: ln(f.content, m.index),
              lineContent: snip(m[0], 220),
              missing,
            };
            break;
          }
        }
        if (bad) break;

        // Custom role interactive: native olmayan tag'lerde keyboard + name kontrolü.
        const customRoleRe = /<([a-z0-9:_-]+)\b([^>]*\brole\s*=\s*["'](button|menuitem|tab|option|switch|checkbox|radio|slider)["'][^>]*)>/gi;
        while ((m = customRoleRe.exec(f.content)) !== null) {
          const tagName = String(m[1] || "").toLowerCase();
          if (nativeInteractiveTags.has(tagName)) continue;
          checkedInteractiveCount++;
          const attrs = m[2] || "";
          const hasTab = /\btabindex\s*=\s*["']?0["']?|\btabIndex\s*=\s*\{?0\}?/i.test(attrs);
          const hasKeyboard = /\bonkey(down|up|press)\b|\bonKey(Down|Up|Press)\b/i.test(attrs) ||
            /ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Enter|Space|Escape/.test(f.content.substring(Math.max(0, m.index - 250), Math.min(f.content.length, m.index + 450)));
          const hasName = /\baria-label\s*=|\baria-labelledby\s*=/i.test(attrs) || hasTextContentNear(f.content, m.index, tagName);
          if (!(hasTab && hasKeyboard && hasName)) {
            const missing = [
              hasTab ? null : "tabIndex",
              hasKeyboard ? null : "keyboard",
              hasName ? null : "erişilebilir isim",
            ].filter(Boolean).join(", ");
            bad = {
              f,
              line: ln(f.content, m.index),
              lineContent: snip(m[0], 220),
              missing,
            };
            break;
          }
        }
        if (bad) break;
      }

      if (bad) {
        emitCustomRule(emit, {
          status: "FAIL", wcag: "4.1.2", rule: "custom-component-a11y-gate",
          title: "Bileşen erişilebilirlik kapısı ihlali",
          desc: `Etkileşim içeren bileşende erişilebilirlik sözleşmesi eksik: ${bad.missing}.`,
          file: bad.f.rel,
          line: bad.line || 1,
          lineContent: bad.lineContent || "",
          fix: "Etkileşimli bileşene role/aria niteliği ve klavye olay desteği ekleyin.",
          fixNote: "Component-level gate: interaktif bileşenler erişilebilirlik sözleşmesini sağlamalı.",
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "4.1.2", rule: "custom-component-a11y-gate",
          title: "Bileşen erişilebilirlik kapısı doğrulandı",
          desc: `Kontrol edilen ${componentFiles.length} bileşen dosyasında ${checkedInteractiveCount} interaktif örnek doğrulandı.`,
        });
      }
    }
  }

  // 14) Table semantics (caption + th + scope)
  {
    const tableFiles = templateFiles.filter((f) => /<table\b|role\s*=\s*["']grid["']/i.test(f.content));
    if (!tableFiles.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "1.3.1", rule: "custom-table-a11y",
        title: "Tablo erişilebilirlik kontrolü uygulanamaz", desc: "Projede tablo/grid bileşeni tespit edilmedi.",
      });
    } else {
      let bad = null;
      let tableCount = 0;
      for (const f of tableFiles) {
        let m;
        const re = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
        while ((m = re.exec(f.content)) !== null) {
          tableCount++;
          const block = m[0] || "";
          const openTag = (block.match(/<table\b([^>]*)>/i) || [])[1] || "";
          const isPresentational = /role\s*=\s*["'](presentation|none)["']/i.test(openTag);
          if (isPresentational) continue;

          const hasCaption = /<caption\b/i.test(block);
          const hasTh = /<th\b/i.test(block);
          const hasScope = /<th\b[^>]*\bscope\s*=\s*["'](col|row|colgroup|rowgroup)["']/i.test(block);
          if (!(hasCaption && hasTh && hasScope)) {
            bad = {
              f,
              line: ln(f.content, m.index),
              snippet: snip(block, 220),
              missing: [
                hasCaption ? null : "caption",
                hasTh ? null : "th",
                hasScope ? null : "scope",
              ].filter(Boolean).join(", "),
            };
            break;
          }
        }
        if (bad) break;
      }

      if (bad) {
        emitCustomRule(emit, {
          status: "FAIL", wcag: "1.3.1", rule: "custom-table-a11y",
          title: "Tablo erişilebilirlik koşulları eksik",
          desc: `Tabloda zorunlu semantik alanlar eksik: ${bad.missing}.`,
          file: bad.f.rel, line: bad.line, lineContent: bad.snippet,
          fix: "<table><caption>Tablo başlığı</caption><thead><tr><th scope=\"col\">...</th></tr></thead></table>",
          fixNote: "Veri tablolarında caption + th + scope birlikte kullanılmalı.",
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "1.3.1", rule: "custom-table-a11y",
          title: "Tablo erişilebilirlik koşulları doğrulandı",
          desc: `Kontrol edilen ${tableCount} tablo/grid için caption + th + scope sinyalleri bulundu.`,
        });
      }
    }
  }

  // 15) Slider/range accessibility (name + value semantics + keyboard)
  {
    const sliderFiles = templateFiles.filter((f) =>
      /type\s*=\s*["']range["']|role\s*=\s*["']slider["']/i.test(f.content)
    );
    if (!sliderFiles.length) {
      emitCustomRule(emit, {
        status: "N/A", wcag: "4.1.2", rule: "custom-slider-a11y",
        title: "Slider erişilebilirlik kontrolü uygulanamaz", desc: "Projede slider/range bileşeni tespit edilmedi.",
      });
    } else {
      let bad = null;
      let sliderCount = 0;
      for (const f of sliderFiles) {
        let m;
        const inputRangeRe = /<input\b([^>]*\btype\s*=\s*["']range["'][^>]*)>/gi;
        while ((m = inputRangeRe.exec(f.content)) !== null) {
          sliderCount++;
          const attrs = m[1] || "";
          const id = (attrs.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
          const hasLabelById = id && new RegExp(`<label[^>]*for\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(f.content);
          const hasName = /\baria-label\s*=|\baria-labelledby\s*=/.test(attrs) || hasLabelById;
          if (!hasName) {
            bad = { f, line: ln(f.content, m.index), snippet: snip(m[0]), missing: "erişilebilir isim" };
            break;
          }
        }
        if (bad) break;

        const customSliderRe = /<([a-z0-9:_-]+)\b([^>]*\brole\s*=\s*["']slider["'][^>]*)>/gi;
        while ((m = customSliderRe.exec(f.content)) !== null) {
          sliderCount++;
          const attrs = m[2] || "";
          const hasName = /\baria-label\s*=|\baria-labelledby\s*=/i.test(attrs);
          const hasValueModel = /\baria-valuemin\s*=\s*["']-?\d+/i.test(attrs) &&
            /\baria-valuemax\s*=\s*["']-?\d+/i.test(attrs) &&
            /\baria-valuenow\s*=\s*["']-?\d+/i.test(attrs);
          const focusable = /\btabindex\s*=\s*["']?0["']?|\btabIndex\s*=\s*\{?0\}?/i.test(attrs);
          const around = f.content.substring(Math.max(0, m.index - 500), Math.min(f.content.length, m.index + 900));
          const keyboard = /ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|onKeyDown|onkeydown/.test(around);
          if (!(hasName && hasValueModel && focusable && keyboard)) {
            const missing = [
              hasName ? null : "erişilebilir isim",
              hasValueModel ? null : "aria-valuemin/max/now",
              focusable ? null : "tabindex",
              keyboard ? null : "klavye davranışı",
            ].filter(Boolean).join(", ");
            bad = { f, line: ln(f.content, m.index), snippet: snip(m[0]), missing };
            break;
          }
        }
        if (bad) break;
      }

      if (bad) {
        emitCustomRule(emit, {
          status: "FAIL", wcag: "4.1.2", rule: "custom-slider-a11y",
          title: "Slider erişilebilirlik koşulları eksik",
          desc: `Slider/range bileşeninde eksik alanlar: ${bad.missing}.`,
          file: bad.f.rel, line: bad.line, lineContent: bad.snippet,
          fix: "<div role=\"slider\" aria-label=\"Ses\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"40\" tabIndex=\"0\"></div>",
          fixNote: "Slider için isim, değer modeli ve klavye desteği zorunludur.",
        });
      } else {
        emitCustomRule(emit, {
          status: "PASS", wcag: "4.1.2", rule: "custom-slider-a11y",
          title: "Slider erişilebilirlik koşulları doğrulandı",
          desc: `Kontrol edilen ${sliderCount} slider/range bileşeninde zorunlu a11y sinyalleri bulundu.`,
        });
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STATİK KONTROL FONKSİYONLARI
// (Değişiklik yok — token burada kullanılmaz; üst döngü zaten kontrol eder)
// ════════════════════════════════════════════════════════════════════════════

function staticCheckKeyboard(content, file, emit, isJSX) {
  let m;
  const pat = isJSX
    ? /<(div|span|li|td|tr|section|article|p)\b[^>]*\bonClick\s*[={][^>]*>/gi
    : /<(div|span|li|td|tr|section|article|p)\b[^>]*\bonclick\s*=\s*["'][^>]*>/gi;

  while ((m = pat.exec(content)) !== null) {
    const endIdx = content.indexOf(">", m.index + m[0].length - 1);
    const tag    = content.substring(m.index, endIdx + 1);
    const elem   = m[1];
    const line   = ln(content, m.index);

    if (!/\brole\s*[={]/i.test(tag)) {
      emit({
        severity: "critical", wcag: "4.1.2", rule: "interactive-role-missing",
        title: `Tıklanabilir <${elem}> için role eksik`,
        desc: `<${elem}> üzerinde onClick var ama ARIA role atanmamış.`,
        file, line, lineContent: lc(content, line),
        fix: `<${elem} role="button" tabIndex={0} onClick={fn} onKeyDown={fn}>`,
        fixNote: 'role="button" ekleyin veya doğrudan <button> kullanın.',
        source: "static",
      });
    }

    const tabPat = isJSX ? /tabIndex/i : /tabindex/i;
    if (!tabPat.test(tag)) {
      emit({
        severity: "critical", wcag: "2.1.1", rule: "keyboard-focus-missing",
        title: `Tıklanabilir <${elem}> klavye ile odaklanamıyor`,
        desc: `onClick olan <${elem}>'da tabIndex yok.`,
        file, line, lineContent: lc(content, line),
        fix: isJSX ? "tabIndex={0}" : 'tabindex="0"',
        fixNote: "tabIndex={0} ekleyin veya <button> kullanın.",
        source: "static",
      });
    }

    const keyPat = isJSX ? /onKey(Down|Press|Up)\s*[={]/i : /onkey(down|press|up)\s*=/i;
    if (!keyPat.test(tag)) {
      emit({
        severity: "critical", wcag: "2.1.1", rule: "keyboard-handler-missing",
        title: `Tıklanabilir <${elem}> için klavye olayı eksik`,
        desc: "onClick var ama onKeyDown yok.",
        file, line, lineContent: lc(content, line),
        fix: "onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handler(e); }}",
        fixNote: "Enter ve Space desteği için onKeyDown ekleyin.",
        source: "static",
      });
    }
  }
}

function staticCheckLiveRegions(content, file, emit) {
  let m;
  const patterns = [
    /class(?:Name)?\s*=\s*["'][^"']*(toast|snackbar|notification|alert-message|success-message|error-message|info-message|warning-message|bildirim|uyari|uyarı|hata-mesaj|basari-mesaj|başarı)[^"']*["']/gi,
    /class(?:Name)?\s*=\s*\{[^}]*(toast|snackbar|notification|alertMessage|successMessage|errorMessage)[^}]*\}/gi,
    /(?:Toast|Snackbar|Notification|AlertMessage)\s*[({<]/gi,
  ];

  const checked = new Set();
  for (const pat of patterns) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checked.has(line)) continue;
      checked.add(line);
      const around   = content.substring(Math.max(0, m.index - 150), Math.min(content.length, m.index + 400));
      const hasLive  = /aria-live\s*=\s*["'](polite|assertive)["']/i.test(around);
      const hasRole  = /role\s*=\s*["'](alert|status|log)["']/i.test(around);
      if (!hasLive && !hasRole) {
        emit({
          severity: "critical", wcag: "4.1.2", rule: "live-region-missing",
          title: "Bildirim bileşeninde aria-live veya role='alert' eksik",
          desc: "Toast/bildirim/mesaj bileşeni ekran okuyuculara duyurulmuyor.",
          file, line, lineContent: lc(content, line),
          fix: 'Hata: role="alert" aria-live="assertive"\nBilgi: role="status" aria-live="polite"',
          fixNote: "Kritik mesajlara role='alert', bilgi mesajlarına role='status' ekleyin.",
          source: "static",
        });
      }
    }
  }

  const loadPats = [
    /class(?:Name)?\s*=\s*["'][^"']*(loading|spinner|loader|skeleton|yükleniyor|yukleniyor|progress-indicator)[^"']*["']/gi,
  ];
  const checkedLoad = new Set();
  for (const pat of loadPats) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checkedLoad.has(line)) continue;
      checkedLoad.add(line);
      const around = content.substring(Math.max(0, m.index - 150), Math.min(content.length, m.index + 400));
      if (!/aria-live|role\s*=\s*["'](status|progressbar|alert)["']|aria-busy/i.test(around)) {
        emit({
          severity: "warning", wcag: "4.1.2", rule: "loading-not-announced",
          title: "Yükleme göstergesi ekran okuyuculara bildirilmiyor",
          desc: "Loading/spinner bileşeninde aria-live, role='status' veya aria-busy yok.",
          file, line, lineContent: lc(content, line),
          fix: '<div role="status" aria-live="polite" aria-busy="true">Yükleniyor...</div>',
          fixNote: "role='status' + aria-live='polite' ekleyin.",
          source: "static",
        });
      }
    }
  }

  const errPats = [
    /class(?:Name)?\s*=\s*["'][^"']*(error-?msg|form-?error|field-?error|validation-?error|invalid-?feedback|hata-?mesaj|error-?text|help-?text-?error)[^"']*["']/gi,
  ];
  const checkedErr = new Set();
  for (const pat of errPats) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checkedErr.has(line)) continue;
      checkedErr.add(line);
      const around = content.substring(Math.max(0, m.index - 100), Math.min(content.length, m.index + 300));
      if (!/role\s*=\s*["']alert["']/i.test(around) && !/aria-live/i.test(around)) {
        emit({
          severity: "critical", wcag: "3.3.1", rule: "error-not-announced",
          title: "Form hata mesajı ekran okuyuculara bildirilmiyor",
          desc: "Hata mesajı bileşeninde role='alert' veya aria-live yok.",
          file, line, lineContent: lc(content, line),
          fix: '<span role="alert" aria-live="assertive">Bu alan zorunludur</span>',
          fixNote: "Hata mesajlarına role='alert' ekleyin.",
          source: "static",
        });
      }
    }
  }
}

function staticCheckModals(content, file, emit) {
  let m;
  const modalPats = [
    /class(?:Name)?\s*=\s*["'][^"']*(modal|dialog(?!ue)|popup|lightbox|drawer|overlay-content|modal-content|sidebar-open)[^"']*["']/gi,
    /(?:Modal|Dialog|Drawer|Lightbox|Popup)\s*[({<]/g,
  ];
  const checkedLines = new Set();

  for (const pat of modalPats) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checkedLines.has(line)) continue;
      checkedLines.add(line);
      const block = content.substring(Math.max(0, m.index - 300), Math.min(content.length, m.index + 1500));

      if (!/role\s*=\s*["'](dialog|alertdialog)["']/i.test(block)) {
        emit({
          severity: "critical", wcag: "4.1.2", rule: "modal-role-missing",
          title: "Modal/dialog bileşeninde role='dialog' eksik",
          desc: "Modal bileşenine role='dialog' atanmamış.",
          file, line, lineContent: lc(content, line),
          fix: '<div role="dialog" aria-modal="true" aria-labelledby="modal-title">',
          fixNote: 'role="dialog" ve aria-modal="true" ekleyin.',
          source: "static",
        });
      }
      if (!/aria-modal\s*=\s*["']true["']/i.test(block)) {
        emit({
          severity: "warning", wcag: "4.1.2", rule: "modal-aria-modal-missing",
          title: "Modal'da aria-modal='true' eksik",
          desc: "Ekran okuyucu arka plan içeriğine erişmeye devam eder.",
          file, line, lineContent: lc(content, line),
          fix: 'aria-modal="true"', fixNote: 'aria-modal="true" ekleyin.',
          source: "static",
        });
      }
      if (!/aria-label(ledby)?\s*[={]/i.test(block)) {
        emit({
          severity: "warning", wcag: "4.1.2", rule: "modal-label-missing",
          title: "Modal başlığı erişilebilir isim olarak bağlanmamış",
          desc: "Modal'da aria-labelledby veya aria-label yok.",
          file, line, lineContent: lc(content, line),
          fix: '<div role="dialog" aria-labelledby="modal-title">\n  <h2 id="modal-title">Başlık</h2>',
          fixNote: "Modal başlığını aria-labelledby ile bağlayın.",
          source: "static",
        });
      }
      if (!/Escape|Esc|keyCode\s*===?\s*27|key\s*===?\s*['"]Escape['"]/i.test(content)) {
        emit({
          severity: "critical", wcag: "2.1.2", rule: "modal-escape-missing",
          title: "Modal Escape tuşuyla kapatılamıyor",
          desc: "Dosyada Escape tuş dinleyicisi bulunamadı.",
          file, line, lineContent: lc(content, line),
          fix: 'const handleEsc = (e) => { if (e.key === "Escape") closeModal(); };\ndocument.addEventListener("keydown", handleEsc);',
          fixNote: "Escape tuşuyla modal'ı kapatın.",
          source: "static",
        });
      }
      if (!/focus.?trap|createFocusTrap|useFocusTrap|FocusTrap|focus.?lock|trapTabKey/i.test(content)) {
        emit({
          severity: "warning", wcag: "2.1.2", rule: "modal-focus-trap-missing",
          title: "Modal'da focus trap mekanizması eksik",
          desc: "Modal içinde Tab ile odağın sınırlandırılması tespit edilemedi.",
          file, line, lineContent: lc(content, line),
          fix: "focus-trap-react veya custom Tab/Shift+Tab döngüsü kullanın.",
          fixNote: "Modal açıkken Tab yalnızca modal içinde dönmeli.",
          source: "static",
        });
      }
    }
  }
}

function staticCheckDropdowns(content, file, emit) {
  let m;
  const ddPats = [
    /class(?:Name)?\s*=\s*["'][^"']*(dropdown(?!-item)|drop-down|combobox|combo-box|custom-select|autocomplete|açılır|acilir|select-menu)[^"']*["']/gi,
  ];
  const checked = new Set();

  for (const pat of ddPats) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checked.has(line)) continue;
      checked.add(line);
      const block = content.substring(Math.max(0, m.index - 200), Math.min(content.length, m.index + 1000));

      if (!/role\s*=\s*["'](listbox|menu|menubar|combobox|tree)["']/i.test(block)) {
        emit({
          severity: "critical", wcag: "4.1.2", rule: "dropdown-role-missing",
          title: "Dropdown bileşeninde ARIA rolü eksik",
          desc: "Özel dropdown'a role='listbox' veya role='combobox' atanmamış.",
          file, line, lineContent: lc(content, line),
          fix: '<div role="combobox" aria-expanded="false" aria-haspopup="listbox">',
          fixNote: "Dropdown'a uygun ARIA rolü ekleyin.",
          source: "static",
        });
      }
      if (!/aria-expanded/i.test(block)) {
        emit({
          severity: "warning", wcag: "4.1.2", rule: "dropdown-expanded-missing",
          title: "Dropdown'da aria-expanded durumu eksik",
          desc: "Açık/kapalı durumu ekran okuyuculara bildirilmiyor.",
          file, line, lineContent: lc(content, line),
          fix: 'aria-expanded="false"',
          fixNote: "Tetikleyiciye aria-expanded ekleyin.",
          source: "static",
        });
      }
      if (!/aria-haspopup/i.test(block)) {
        emit({
          severity: "warning", wcag: "4.1.2", rule: "dropdown-haspopup-missing",
          title: "Dropdown'da aria-haspopup eksik",
          desc: "Tetikleyicide alt menü açılacağı bildirilmiyor.",
          file, line, lineContent: lc(content, line),
          fix: 'aria-haspopup="listbox"',
          fixNote: "Tetikleyiciye aria-haspopup ekleyin.",
          source: "static",
        });
      }
    }
  }

  const accPats = [
    /class(?:Name)?\s*=\s*["'][^"']*(accordion|collapse|collapsible|expandable|akordiyon)[^"']*["']/gi,
  ];
  const checkedAcc = new Set();
  for (const pat of accPats) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checkedAcc.has(line)) continue;
      checkedAcc.add(line);
      const block = content.substring(Math.max(0, m.index - 100), Math.min(content.length, m.index + 500));
      if (!/aria-expanded/i.test(block)) {
        emit({
          severity: "warning", wcag: "4.1.2", rule: "accordion-expanded-missing",
          title: "Accordion'da aria-expanded eksik",
          desc: "Accordion tetikleyicisinde açık/kapalı durumu bildirilmiyor.",
          file, line, lineContent: lc(content, line),
          fix: '<button aria-expanded="false" aria-controls="panel-1">Bölüm</button>',
          fixNote: "aria-expanded ve aria-controls ekleyin.",
          source: "static",
        });
      }
    }
  }

  const tabPats = [
    /class(?:Name)?\s*=\s*["'][^"']*(tab-?list|tabs-?header|tab-?nav|tab-?container)[^"']*["']/gi,
    /role\s*=\s*["']tablist["']/gi,
  ];
  const checkedTab = new Set();
  for (const pat of tabPats) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checkedTab.has(line)) continue;
      checkedTab.add(line);
      const block = content.substring(m.index, Math.min(content.length, m.index + 1200));
      if (!/role\s*=\s*["']tab["']/i.test(block)) {
        emit({
          severity: "warning", wcag: "4.1.2", rule: "tab-roles-missing",
          title: "Tab bileşeninde ARIA rolleri eksik",
          desc: "Tab listesinde role='tab', role='tabpanel', aria-selected bulunamadı.",
          file, line, lineContent: lc(content, line),
          fix: '<div role="tablist">\n  <button role="tab" aria-selected="true">Tab 1</button>\n</div>',
          fixNote: "tablist, tab, tabpanel rollerini ekleyin.",
          source: "static",
        });
      }
    }
  }
}

function staticCheckJSBehavior(content, file, emit, safeLog) {
  let m;

  const mdRe = /\.addEventListener\s*\(\s*["']mousedown["']/gi;
  while ((m = mdRe.exec(content)) !== null) {
    const surr = content.substring(m.index, Math.min(content.length, m.index + 300));
    if (/submit|send|delete|remove|save|confirm|post|kaydet|sil|gönder/i.test(surr)) {
      emit({
        severity: "warning", wcag: "2.5.2", rule: "pointer-down-action",
        title: "Kritik işlev mousedown olayına bağlı",
        desc: "İşlev basış anında tetikleniyor — kullanıcı yanlış tıklamayı iptal edemez.",
        file, line: ln(content, m.index), lineContent: lc(content, ln(content, m.index)),
        fix: 'element.addEventListener("click", handler);',
        fixNote: "mousedown yerine click kullanın.",
        source: "static",
      });
    }
  }

  const focusRe = /(onfocus|addEventListener\s*\(\s*["']focus["'])[^;]{0,100}?(location|navigate|redirect|window\.open|router\.push)/gi;
  while ((m = focusRe.exec(content)) !== null) {
    emit({
      severity: "warning", wcag: "3.2.1", rule: "focus-context-change",
      title: "Odaklanmada sayfa yönlendirmesi var",
      desc: "Focus olayında yönlendirme yapılıyor — beklenmedik bağlam değişikliği.",
      file, line: ln(content, m.index), lineContent: lc(content, ln(content, m.index)),
      fix: "Odaklanma ile değil, kullanıcı eylemiyle yönlendirin.",
      fixNote: "Açık buton/Enter ile yönlendirin.",
      source: "static",
    });
  }

  const intRe = /setInterval\s*\(/gi;
  while ((m = intRe.exec(content)) !== null) {
    const surr = content.substring(m.index, Math.min(content.length, m.index + 250));
    if (/animate|slide|scroll|rotate|fade|marquee|carousel|slider|kaydır|döndür/i.test(surr)) {
      emit({
        severity: "review", wcag: "2.2.2", rule: "auto-animation-no-pause",
        title: "Otomatik animasyon — duraklat/durdur mekanizması kontrol edin",
        desc: "setInterval ile sürekli animasyon çalışıyor.",
        file, line: ln(content, m.index), lineContent: lc(content, ln(content, m.index)),
        fix: "Duraklat/durdur butonu ekleyin. prefers-reduced-motion desteği verin.",
        fixNote: "Otomatik hareketli içerik kullanıcı tarafından durdurulabilmeli.",
        source: "static",
      });
    }
  }

  if (/devicemotion|deviceorientation/i.test(content)) {
    const motRe = /(devicemotion|deviceorientation)/gi;
    while ((m = motRe.exec(content)) !== null) {
      emit({
        severity: "review", wcag: "2.5.4", rule: "motion-actuation",
        title: "Cihaz hareketi ile tetiklenen işlev tespit edildi",
        desc: "Hareket ile çalışan işlev için UI alternatifi sunulmalı.",
        file, line: ln(content, m.index), lineContent: lc(content, ln(content, m.index)),
        fix: "Buton alternatifi ekleyin. Hareketi kapatma seçeneği sunun.",
        fixNote: "WCAG 2.5.4 gereksinimi.",
        source: "static",
      });
    }
  }
}

function staticCheckCSS(content, file, emit, safeLog) {
  let m;

  const outRe = /(:focus\s*\{[^}]*)?outline\s*:\s*(none|0)\s*[;!}]/gi;
  while ((m = outRe.exec(content)) !== null) {
    const around = content.substring(Math.max(0, m.index - 300), Math.min(content.length, m.index + 300));
    if (!/focus-visible|box-shadow.*focus|border.*focus|outline.*2px/i.test(around)) {
      emit({
        severity: "critical", wcag: "2.4.3", rule: "focus-outline-removed",
        title: "Odak göstergesi (outline) kaldırılmış",
        desc: "outline: none/0 ile odak göstergesi kaldırılmış ama alternatif stil yok.",
        file, line: ln(content, m.index), lineContent: lc(content, ln(content, m.index)),
        fix: ":focus-visible { outline: 2px solid #4A90D9; outline-offset: 2px; }",
        fixNote: "outline kaldırıyorsanız :focus-visible ile alternatif odak stili ekleyin.",
        source: "static",
      });
    }
  }

  if (/animation|transition|@keyframes/i.test(content) && content.length > 300) {
    if (!/prefers-reduced-motion/i.test(content)) {
      emit({
        severity: "review", wcag: "2.3.1", rule: "reduced-motion-missing",
        title: "prefers-reduced-motion desteği eksik",
        desc: "CSS'te animasyon/transition var ama prefers-reduced-motion medya sorgusu yok.",
        file, line: 1, lineContent: "",
        fix: "@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }",
        fixNote: "Hareket hassasiyeti olan kullanıcılar için desteği ekleyin.",
        source: "static",
      });
    }
  }

  const animRe = /animation(?:-duration)?\s*:[^;]*?(\d*\.?\d+)(ms|s)/gi;
  while ((m = animRe.exec(content)) !== null) {
    const val = parseFloat(m[1]);
    const ms  = m[2] === "s" ? val * 1000 : val;
    if (ms > 0 && ms < 333) {
      emit({
        severity: "warning", wcag: "2.3.1", rule: "fast-animation",
        title: `Çok hızlı animasyon (${ms}ms)`,
        desc: `${ms}ms süreli animasyon epilepsi riski taşıyabilir.`,
        file, line: ln(content, m.index), lineContent: lc(content, ln(content, m.index)),
        fix: "animation-duration: 0.5s;",
        fixNote: "Minimum 333ms (tercihen 500ms+) kullanın.",
        source: "static",
      });
    }
  }
}

function staticCheckMediaAccessibility(content, file, emit) {
  let m;

  const videoRe = /<video\b[^>]*>(.*?)<\/video>/gis;
  while ((m = videoRe.exec(content)) !== null) {
    const videoBlock = m[0];
    const line = ln(content, m.index);
    if (!/autoplay/i.test(videoBlock)) continue;
    if (!/<track[^>]*kind\s*=\s*["']captions["']/i.test(videoBlock)) {
      emit({
        severity: "critical", wcag: "1.2.2", rule: "media-captions-missing",
        title: "Video için kapalı altyazı (track kind=captions) eksik",
        desc: "<video> elemanında altyazı track'i bulunamadı.",
        file, line, lineContent: lc(content, line),
        fix: '<track kind="captions" src="altyazi.vtt" srclang="tr" label="Türkçe" default>',
        fixNote: "<video> içine kind='captions' olan <track> ekleyin.",
        source: "static",
      });
    }
  }

  const audioRe = /<audio\b[^>]*>/gi;
  while ((m = audioRe.exec(content)) !== null) {
    const line   = ln(content, m.index);
    const around = content.substring(Math.max(0, m.index - 100), Math.min(content.length, m.index + 600));
    if (!/transkript|transcript|metin.alt|text.alt|a\s+href/i.test(around)) {
      emit({
        severity: "warning", wcag: "1.2.1", rule: "media-transcript-missing",
        title: "Ses içeriği için transkript bağlantısı bulunamadı",
        desc: "<audio> yakınında metin transkripti veya bağlantısı tespit edilemedi.",
        file, line, lineContent: lc(content, line),
        fix: '<a href="transkript.html">Transkripti Oku</a>',
        fixNote: "Ses içeriğinin hemen yakınına transkript bağlantısı ekleyin.",
        source: "static",
      });
    }
  }

  const canvasRe = /<canvas\b([^>]*)>/gi;
  while ((m = canvasRe.exec(content)) !== null) {
    const attrs = m[1];
    const line  = ln(content, m.index);
    if (!/aria-label|aria-labelledby|role\s*=/i.test(attrs)) {
      emit({
        severity: "warning", wcag: "4.1.2", rule: "canvas-aria-missing",
        title: "<canvas> için aria-label veya açıklama eksik",
        desc: "Canvas elemanında erişilebilir isim (aria-label) bulunamadı.",
        file, line, lineContent: lc(content, line),
        fix: '<canvas aria-label="Satış grafiği" role="img">Alternatif metin</canvas>',
        fixNote: "Canvas için aria-label ekleyin.",
        source: "static",
      });
    }
  }

  const autoAudioRe = /<audio\b[^>]*\bautoplay\b[^>]*>/gi;
  while ((m = autoAudioRe.exec(content)) !== null) {
    const tag    = m[0];
    const line   = ln(content, m.index);
    const around = content.substring(Math.max(0, m.index - 50), Math.min(content.length, m.index + 400));
    if (!/muted/i.test(tag) && !/kapatma|durdur|pause|stop|controls/i.test(around)) {
      emit({
        severity: "critical", wcag: "1.4.2", rule: "1.4.2-audio-control",
        title: "Otomatik çalan ses için kullanıcı kontrolü eksik",
        desc: "autoplay özellikli ses içeriği var ama kapatma/durdurma kontrolü tespit edilemedi.",
        file, line, lineContent: lc(content, line),
        fix: "<audio autoplay muted controls> veya sayfanın en başına durdurma butonu",
        fixNote: "Otomatik ses sessiz başlamalı veya kullanıcı kontrolü sağlanmalı.",
        source: "static",
      });
    }
  }
}

function staticCheckLinks(content, file, emit) {
  let m;
  const ambiguousTexts = [
    "tıklayınız", "tıklayın", "buraya tıklayın", "buraya", "devamı",
    "devam et", "daha fazla", "daha fazlası", "okuyun", "görüntüle",
    "click here", "here", "more", "read more", "continue", "link",
  ];

  const linkTextRe = /<a\b[^>]*>([^<]{1,60})<\/a>/gi;
  while ((m = linkTextRe.exec(content)) !== null) {
    const linkText   = m[1].trim().toLowerCase();
    const line       = ln(content, m.index);
    const isAmbiguous = ambiguousTexts.some(t => linkText === t || linkText.startsWith(t + " "));
    if (!isAmbiguous) continue;
    if (/aria-label|aria-labelledby|title\s*=/i.test(m[0])) continue;
    emit({
      severity: "critical", wcag: "2.4.4", rule: "ambiguous-link-text",
      title: `Belirsiz bağlantı metni: "${m[1].trim()}"`,
      desc: `Bağlantı metni "${m[1].trim()}" amacını açıklamıyor.`,
      file, line, lineContent: lc(content, line),
      fix: '<a href="/haber/123" aria-label="WCAG Rehberi - Detaylı bilgi">Devamı</a>',
      fixNote: "Bağlantı metnini açıklayıcı yapın veya aria-label ile zenginleştirin.",
      source: "static",
    });
  }

  const jsxLinkRe  = /<(?:Link|a)\b[^>]*>([^<]{1,60})<\/(?:Link|a)>/gi;
  const checkedJsx = new Set();
  while ((m = jsxLinkRe.exec(content)) !== null) {
    const linkText    = m[1].trim().toLowerCase();
    const line        = ln(content, m.index);
    if (checkedJsx.has(line)) continue;
    const isAmbiguous = ambiguousTexts.some(t => linkText === t || linkText.startsWith(t + " "));
    if (!isAmbiguous) continue;
    if (/aria-label|ariaLabel/i.test(m[0])) continue;
    checkedJsx.add(line);
    emit({
      severity: "critical", wcag: "2.4.4", rule: "ambiguous-link-text",
      title: `Belirsiz bağlantı metni: "${m[1].trim()}"`,
      desc: `JSX Link/a bileşeninde "${m[1].trim()}" metni amacını açıklamıyor.`,
      file, line, lineContent: lc(content, line),
      fix: '<Link href="/" aria-label="Ana sayfaya dön">Devamı</Link>',
      fixNote: "aria-label ekleyin veya bağlantı metnini açıklayıcı yapın.",
      source: "static",
    });
  }
}

function staticCheckColorInfo(content, file, emit) {
  let m;
  const colorRefPatterns = [
    /kırmızı[\s\w]{0,20}(alan|yer|bölüm|bölge|kutu|button|buton|düğme|link|bağlantı)/gi,
    /(alan|yer|bölüm|bölge|kutu|buton|düğme)[\s\w]{0,20}kırmızı/gi,
    /yeşil[\s\w]{0,20}(onay|başarı|tik|check|alan)/gi,
    /kırmızıyla[\s\w]{0,30}(belirtilen|gösterilen|işaretlenen)/gi,
    /sarı[\s\w]{0,20}(uyarı|alert|bildirim)/gi,
    /red[\s\w]{0,20}(field|area|box|button|link|section)/gi,
    /(field|area|box|button|link)[\s\w]{0,20}in red/gi,
    /highlighted in (red|green|yellow|blue)/gi,
    /shown in (red|orange|yellow)/gi,
  ];
  const checked = new Set();
  for (const pat of colorRefPatterns) {
    while ((m = pat.exec(content)) !== null) {
      const line = ln(content, m.index);
      if (checked.has(line)) continue;
      checked.add(line);
      emit({
        severity: "warning", wcag: "1.4.1", rule: "color-info-only-pattern",
        title: "Bilgi yalnızca renkle aktarılıyor olabilir",
        desc: `"${m[0].trim()}" kalıbı renk bağımlı bilgi aktarımına işaret edebilir.`,
        file, line, lineContent: lc(content, line),
        fix: "Renk yanında ikon (⚠ ✓ ✕) veya metin etiketi de kullanın.",
        fixNote: "WCAG 1.4.1: Bilgi aktarımı yalnızca renge bağlı olmamalı.",
        source: "static",
      });
    }
  }
}

function staticCheckHeadingHierarchy(content, file, emit) {
  const headingRe = /<(h[1-6])\b[^>]*>(.*?)<\/h[1-6]>/gi;
  const headings  = [];
  let m;

  while ((m = headingRe.exec(content)) !== null) {
    const level = parseInt(m[1][1]);
    const text  = m[2].replace(/<[^>]+>/g, "").trim();
    const line  = ln(content, m.index);
    headings.push({ level, text, line });
  }

  const jsxHeadingRe = /<(h[1-6])\b[^>]*>/gi;
  while ((m = jsxHeadingRe.exec(content)) !== null) {
    const level = parseInt(m[1][1]);
    const line  = ln(content, m.index);
    if (!headings.find(h => h.line === line)) {
      headings.push({ level, text: "(JSX başlık)", line });
    }
  }

  if (headings.length === 0) return;

  const h1Count = headings.filter(h => h.level === 1).length;
  if (h1Count === 0) {
    emit({
      severity: "critical", wcag: "2.4.2", rule: "heading-hierarchy-h1-missing",
      title: "Sayfada <h1> başlığı eksik",
      desc: "Her sayfada ana içeriği tanımlayan bir <h1> başlığı olmalıdır.",
      file, line: 1, lineContent: "",
      fix: "<h1>Sayfa Başlığı</h1>",
      fixNote: "Sayfanın ana konusunu açıklayan bir H1 ekleyin.",
      source: "static",
    });
  } else if (h1Count > 1) {
    const secondH1 = headings.filter(h => h.level === 1)[1];
    emit({
      severity: "warning", wcag: "2.4.2", rule: "heading-hierarchy-multiple-h1",
      title: `Sayfada birden fazla <h1> var (${h1Count} adet)`,
      desc: "Sayfada yalnızca bir H1 olması önerilir.",
      file, line: secondH1?.line || 1, lineContent: lc(content, secondH1?.line || 1),
      fix: "Diğer H1'leri H2 veya H3 olarak yeniden düzenleyin.",
      fixNote: "Her sayfada yalnızca bir H1 kullanılmalı.",
      source: "static",
    });
  }

  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];
    if (curr.level > prev.level + 1) {
      emit({
        severity: "warning", wcag: "1.3.1", rule: "heading-hierarchy-skip",
        title: `Başlık seviyesi atlandı: H${prev.level} → H${curr.level}`,
        desc: `H${prev.level}'den H${curr.level}'ye atlama yapılmış.`,
        file, line: curr.line, lineContent: lc(content, curr.line),
        fix: `H${curr.level} yerine H${prev.level + 1} kullanın.`,
        fixNote: "Başlık seviyeleri ardışık olmalı.",
        source: "static",
      });
    }
  }

  for (const h of headings) {
    if (!h.text || h.text.trim() === "" || h.text.trim() === "(JSX başlık)") continue;
    if (h.text.length < 2) {
      emit({
        severity: "warning", wcag: "2.4.2", rule: "heading-hierarchy-empty",
        title: `Boş veya çok kısa <h${h.level}> başlığı`,
        desc: "Başlık içeriği yok veya çok kısa.",
        file, line: h.line, lineContent: lc(content, h.line),
        fix: `<h${h.level}>Anlamlı bir başlık metni</h${h.level}>`,
        fixNote: "Başlıklar açıklayıcı metin içermeli.",
        source: "static",
      });
    }
  }
}

function staticCheckFormErrors(content, file, emit) {
  let m;
  if (!/<form\b|<input\b|<select\b|<textarea\b/i.test(content)) return;

  const hasAriaInvalid = /aria-invalid/i.test(content);
  const hasFormError   = /(error|hata|yanlis|invalid|geçersiz)/i.test(content);

  if (hasFormError && !hasAriaInvalid) {
    const formRe = /<form\b/gi;
    while ((m = formRe.exec(content)) !== null) {
      const line = ln(content, m.index);
      emit({
        severity: "warning", wcag: "3.3.1", rule: "3.3.1-error-message",
        title: "Form'da aria-invalid kullanımı tespit edilemedi",
        desc: "Formda hata state'i göründüğü halde aria-invalid niteliği bulunamadı.",
        file, line, lineContent: lc(content, line),
        fix: '<input aria-invalid="true" aria-errormessage="email-error" />',
        fixNote: "Hatalı alana aria-invalid='true' ve aria-errormessage ekleyin.",
        source: "static",
      });
      break;
    }
  }

  const submitFocusRe = /onSubmit|handleSubmit|form\.submit/gi;
  while ((m = submitFocusRe.exec(content)) !== null) {
    const surr = content.substring(m.index, Math.min(content.length, m.index + 500));
    if (!/\.focus\s*\(|scrollIntoView|focusFirstError|scrollToError/i.test(surr)) {
      const line = ln(content, m.index);
      emit({
        severity: "review", wcag: "3.3.1", rule: "3.3.1-error-focus-missing",
        title: "Form gönderimi sonrası hatalı alana odak taşıma tespit edilemedi",
        desc: "Submit handler'ında hata sonrası ilk hatalı alana .focus() çağrısı görünmüyor.",
        file, line, lineContent: lc(content, line),
        fix: "errorFields[0]?.focus(); // veya scrollIntoView",
        fixNote: "Hata durumunda ilk hatalı alana programatik olarak odak taşıyın.",
        source: "static",
      });
      break;
    }
  }

  const hasErrorSummary  = /error[.-_]?summary|hata[.-_]?özet|FormError|errorList|error-?list|alert.*error|errors\.map/i.test(content);
  const hasMultipleErrors = (content.match(/(error|hata)/gi) || []).length > 3;

  if (hasMultipleErrors && !hasErrorSummary) {
    const formRe2 = /<form\b/gi;
    while ((m = formRe2.exec(content)) !== null) {
      const line = ln(content, m.index);
      emit({
        severity: "review", wcag: "3.3.1", rule: "3.3.1-error-list-missing",
        title: "Çok hatalı formda hata özet listesi tespit edilemedi",
        desc: "Hata özet listesi (ErrorSummary) tespit edilemedi.",
        file, line, lineContent: lc(content, line),
        fix: '<div role="alert" aria-live="assertive"><h2>Hatalar:</h2><ul>...</ul></div>',
        fixNote: "Sayfa üstüne tüm hataları listeleyen bir özet bölümü ekleyin.",
        source: "static",
      });
      break;
    }
  }
}

// ── Dışa aktar ───────────────────────────────────────────────────────────────

module.exports = { scanProject, CancelToken };
