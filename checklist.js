"use strict";

const { QUESTION_DEFINITIONS } = require("./officialChecklistSchema");


const CHECKLIST = Object.freeze(
  QUESTION_DEFINITIONS.map((q) => {
    // Resmi kontrol listesi mantığına hizalama:
    // Yalnızca Q095 sorusu çift yıldız ve beklenen cevap "Hayır"dır.
    const baseStar = q.id === "Q095" ? "**" : "*";
    const baseExpected = q.id === "Q095" ? "No" : "Yes";
    const merged = {
      auto: true,
      nextOnNo: null,
      trigger: null,
      mappedRules: [],
      ...q,
      // Son söz: resmi yıldız/beklenen cevap şemasını zorunlu uygula.
      star: baseStar,
      expectedAnswer: baseExpected,
    };
    return {
      ...merged,
      resmiSoruNo: Number(merged.id.slice(1)),
      zorunluMu: !merged.nextOnNo,
      degerlendirmeSinifi: merged.nextOnNo ? "ön-koşul" : "zorunlu",
      hint: `Beklenen cevap ${merged.expectedAnswer === "No" ? "Hayır" : "Evet"}. Kural eşleşmeleri: ${(merged.mappedRules || []).join(", ")}`,
    };
  })
);

const QUESTION_RULE_MAPPING = Object.freeze(
  Object.fromEntries(CHECKLIST.map((q) => [q.id, [...q.mappedRules]]))
);

function normalizeRule(rule) {
  return (rule || "").toLowerCase().trim();
}

function findMatchedFindings(question, technicalFindings) {
  const rules = new Set((question.mappedRules || []).map(normalizeRule));
  const qWcag = String(question.wcag || "").trim();
  return technicalFindings.filter((f) => {
    if (!rules.has(normalizeRule(f.rule))) return false;
    if (String(f.status || "").toUpperCase() === "N/A") return false;
    // Soru-bulgu eşleşmesinde alakasız WCAG karışmasını engelle.
    if (qWcag && String(f.wcag || "").trim() && String(f.wcag).trim() !== qWcag) return false;
    return true;
  });
}

function maxConfidence(findings) {
  const rank = { high: 3, medium: 2, low: 1 };
  let best = "low";
  for (const f of findings) {
    const c = (f.confidence || "").toLowerCase();
    if (rank[c] && rank[c] > rank[best]) best = c;
  }
  return best;
}

function aggregateCompliance(findings) {
  if (!findings.length) {
    return { compliance: "PASS", rationale: "Eşleşen teknik bulgu yok." };
  }
  if (findings.some((f) => f.status === "FAIL")) {
    return { compliance: "FAIL", rationale: "En az bir teknik kural FAIL sonucu üretti." };
  }
  if (findings.some((f) => f.status === "WARNING")) {
    return { compliance: "WARNING", rationale: "FAIL yok ancak WARNING seviyesinde teknik sinyal var." };
  }
  if (findings.some((f) => f.status === "MANUAL")) {
    return { compliance: "MANUAL", rationale: "Teknik bulgular manuel doğrulama gerektiriyor." };
  }
  if (findings.some((f) => f.status === "N/A")) {
    return { compliance: "N/A", rationale: "İlgili teknik bulgular uygulanamaz olarak işaretli." };
  }
  return { compliance: "PASS", rationale: "Teknik bulgular ihlal üretmedi." };
}

function computeAnswer(expectedAnswer, compliance) {
  if (compliance === "MANUAL") return "MANUAL";
  if (compliance === "N/A") return "N/A";

  if (expectedAnswer === "Yes") {
    return compliance === "PASS" ? "Yes" : "No";
  }
  return compliance === "PASS" ? "No" : "Yes";
}

function applyBranching(resultsById, orderedIds) {
  for (let idx = 0; idx < orderedIds.length; idx++) {
    const qid = orderedIds[idx];
    const q = resultsById[qid];
    if (!q.nextOnNo || q.computedAnswer !== "No") continue;

    const targetIdx = orderedIds.indexOf(q.nextOnNo);
    if (targetIdx <= idx + 1) continue;

    for (let j = idx + 1; j < targetIdx; j++) {
      const sid = orderedIds[j];
      const sq = resultsById[sid];
      if (!sq) continue;
      sq.computedOutcome = "N/A";
      sq.computedAnswer = "N/A";
      sq.status = "na";
      sq.rationale = `Koşullu atlama: ${qid} cevabı Hayır olduğu için ${qid} -> ${q.nextOnNo} atlaması uygulandı.`;
      sq.branchSkippedBy = qid;
    }
  }
}

function inferKontrolTuru(q) {
  if (!q.auto) return "manuel";
  if (q.trigger) return "hibrit";
  return "otomatik";
}

function inferKanitDuzeyi(findings) {
  const items = Array.isArray(findings) ? findings : [];
  if (!items.length) return "kanıt yok";

  let hasLine = false;
  let hasSelector = false;
  let hasSnippet = false;
  for (const f of items) {
    if ((f.line || 0) > 0) hasLine = true;
    if ((f.selector || "").trim()) hasSelector = true;
    if ((f.lineContent || "").trim()) hasSnippet = true;
  }

  if (hasLine && hasSelector && hasSnippet) return "yüksek";
  if ((hasLine && hasSnippet) || (hasLine && hasSelector)) return "orta";
  if (hasLine || hasSelector || hasSnippet) return "düşük";
  return "proje geneli";
}

function buildFixRecipe(q) {
  const wcag = q.wcag || "";
  const base = "Önce ilgili bileşenin semantik yapısını doğrulayın, ardından yardımcı teknoloji ile yeniden test edin.";
  const map = {
    "1.1.1": "Metin dışı içerikler için alternatif metin sağlayın; dekoratif içerikleri yardımcı teknolojiden gizleyin.",
    "1.2.1": "Yalnız ses/video içerikleri için eşdeğer metin veya altyazı alternatifi ekleyin.",
    "1.2.2": "Önceden kaydedilmiş sesli videolara altyazı ekleyin ve medya oynatıcıda erişilebilir kontrol sunun.",
    "1.2.3": "Video içeriği için sesli betimleme veya ayrıntılı metinsel betimleme sağlayın.",
    "1.3.1": "Başlık, liste, tablo ve form ilişkilerini semantik etiketlerle programatik olarak belirtin.",
    "1.3.2": "DOM sırası ile görsel sıralamayı uyumlu hale getirerek anlamlı okuma/odak sırası sağlayın.",
    "1.3.3": "Talimatlarda yalnızca renk/şekil/konum/ses kullanmayın; metinsel alternatif ekleyin.",
    "1.4.1": "Bilgi iletiminde yalnızca renge bağımlılığı kaldırın; ikon, desen veya metin ekleyin.",
    "1.4.2": "3 saniyeyi aşan otomatik ses için durdurma/kapatma/ses denetimi sunun.",
    "2.1.1": "Tüm etkileşimli bileşenleri klavye ile erişilebilir ve etkinleştirilebilir yapın.",
    "2.1.2": "Klavye tuzağını kaldırın; kullanıcının bileşenden güvenli biçimde çıkmasını sağlayın.",
    "2.1.4": "Tek karakterli kısayolları kapatılabilir/değiştirilebilir yapın veya odağa bağlı etkinleştirin.",
    "2.2.1": "Zaman sınırı olan süreçlerde durdurma/uzatma/önceden uyarı mekanizması sağlayın.",
    "2.2.2": "Hareketli ya da otomatik güncellenen içerikler için duraklatma/durdurma/gizleme sunun.",
    "2.3.1": "Yanıp sönme sıklığını saniyede 3 altında tutun, parlak flaşlardan kaçının.",
    "2.4.1": "Tekrarlayan blokları atlamak için 'ana içeriğe atla' bağlantısı ve anlamlı bölgeler ekleyin.",
    "2.4.2": "Her sayfaya içeriği açıklayan anlamlı bir başlık tanımlayın.",
    "2.4.3": "Odak sırasını mantıksal akışla uyumlu olacak şekilde düzenleyin.",
    "2.4.4": "Bağlantı metinlerini hedefi açıkça anlatacak şekilde adlandırın.",
    "2.5.1": "Çok parmaklı/sürüklemeli işlemler için tek dokunuşlu alternatif sağlayın.",
    "2.5.2": "İşlemi basış anında değil bırakışta tetikleyin; iptal edilebilir etkileşim sunun.",
    "2.5.3": "Görünür etiket ile erişilebilir adın uyumlu olmasını sağlayın.",
    "2.5.4": "Hareketle tetiklenen işlevler için ekran üstü alternatif ve kapatma seçeneği sunun.",
    "3.1.1": "Sayfa dilini kodda doğru belirtin; çok dilli parçalarda yerel dil işaretlemeleri kullanın.",
    "3.2.1": "Odak alma olayında beklenmeyen bağlam değişikliklerini kaldırın.",
    "3.2.2": "Girdi değişimlerinde otomatik yönlendirme yerine açık kullanıcı onayı kullanın.",
    "3.2.6": "Yardım bileşenlerini sayfalar arasında konum ve sıra olarak tutarlı tutun.",
    "3.3.1": "Hata alanını ve hata türünü metinsel, görünür ve yardımcı teknolojiye uygun biçimde bildirin.",
    "3.3.2": "Form alanlarında etiket/talimat sağlayın; format beklentilerini açıkça belirtin.",
    "3.3.7": "Tekrarlanan veri girişini azaltın; önceki veriyi yeniden kullanma imkanı verin.",
    "4.1.2": "Özel bileşenlerde ad, rol, durum/değer bilgisini yardımcı teknolojilerin okuyacağı şekilde tanımlayın.",
  };
  return map[wcag] || base;
}

function buildChecklistResults(technicalFindings, mediaCtx = {}) {
  const findings = Array.isArray(technicalFindings) ? technicalFindings : [];
  const orderedIds = CHECKLIST.map((q) => q.id);
  const resultsById = {};

  for (const q of CHECKLIST) {
    const triggerActive = !q.trigger || (
      (q.trigger === "video" && mediaCtx.hasVideo) ||
      (q.trigger === "audio" && mediaCtx.hasAudio) ||
      (q.trigger === "captcha" && mediaCtx.hasCaptcha) ||
      (q.trigger === "canvas" && mediaCtx.hasCanvas)
    );

    if (!triggerActive) {
      resultsById[q.id] = {
        ...q,
        computedOutcome: "N/A",
        computedAnswer: "N/A",
        rationale: `Trigger aktif değil: ${q.trigger}`,
        confidence: "low",
        status: "na",
        findings: [],
        autoOrManual: q.auto ? "auto" : "manual",
        kontrolTuru: inferKontrolTuru(q),
        kanitDuzeyi: "kanıt yok",
        duzeltmeOnerisi: buildFixRecipe(q),
        resmiSoruNo: q.resmiSoruNo,
        zorunluMu: q.zorunluMu,
        degerlendirmeSinifi: q.degerlendirmeSinifi,
        triggeredRuleStatuses: [],
      };
      continue;
    }

    if (!q.auto) {
      resultsById[q.id] = {
        ...q,
        computedOutcome: "MANUAL",
        computedAnswer: "MANUAL",
        rationale: "Bu soru otomatikleştirilemez; manuel doğrulama gerekir.",
        confidence: "low",
        status: "manual",
        findings: [],
        autoOrManual: "manual",
        kontrolTuru: inferKontrolTuru(q),
        kanitDuzeyi: "manuel",
        duzeltmeOnerisi: buildFixRecipe(q),
        resmiSoruNo: q.resmiSoruNo,
        zorunluMu: q.zorunluMu,
        degerlendirmeSinifi: q.degerlendirmeSinifi,
        triggeredRuleStatuses: [],
        manualAnswer: null,
        manualNote: "",
      };
      continue;
    }

    const matchedFindings = findMatchedFindings(q, findings);
    const { compliance, rationale } = aggregateCompliance(matchedFindings);
    const computedAnswer = computeAnswer(q.expectedAnswer, compliance);

    const status = compliance === "PASS" ? "pass"
      : compliance === "N/A" ? "na"
        : compliance === "MANUAL" ? "manual"
          : "fail";

    resultsById[q.id] = {
      ...q,
      computedOutcome: compliance,
      computedAnswer,
      rationale,
      confidence: maxConfidence(matchedFindings),
      status,
      findings: matchedFindings,
      autoOrManual: "auto",
      kontrolTuru: inferKontrolTuru(q),
      kanitDuzeyi: inferKanitDuzeyi(matchedFindings),
      duzeltmeOnerisi: buildFixRecipe(q),
      resmiSoruNo: q.resmiSoruNo,
      zorunluMu: q.zorunluMu,
      degerlendirmeSinifi: q.degerlendirmeSinifi,
      triggeredRuleStatuses: [...new Set(matchedFindings.map((f) => f.status).filter(Boolean))],
      manualAnswer: null,
      manualNote: "",
    };
  }

  applyBranching(resultsById, orderedIds);

  return orderedIds.map((id) => resultsById[id]);
}

function validateOfficialChecklistSchema(checklist) {
  const errors = [];
  const list = Array.isArray(checklist) ? checklist : [];

  if (list.length !== 122) {
    errors.push(`Soru sayısı 122 olmalı, bulundu: ${list.length}`);
  }

  for (let i = 1; i <= 122; i++) {
    const id = `Q${String(i).padStart(3, "0")}`;
    const q = list[i - 1];
    if (!q || q.id !== id) {
      errors.push(`Sıra hatası: ${i}. öğe ${id} olmalı.`);
      continue;
    }

    if (q.id === "Q095") {
      if (q.star !== "**") errors.push("Q095 yıldız tipi '**' olmalı.");
      if (q.expectedAnswer !== "No") errors.push("Q095 beklenen cevap 'No' olmalı.");
    } else {
      if (q.star !== "*") errors.push(`${q.id} yıldız tipi '*' olmalı.`);
      if (q.expectedAnswer !== "Yes") errors.push(`${q.id} beklenen cevap 'Yes' olmalı.`);
    }

    if (!q.wcag || !q.criterion || !q.question) {
      errors.push(`${q.id} için wcag/criterion/question zorunlu alanları eksik.`);
    }

    if (q.nextOnNo) {
      const current = Number(q.id.slice(1));
      const target = Number(String(q.nextOnNo).slice(1));
      if (!Number.isFinite(target) || target <= current || target > 122) {
        errors.push(`${q.id} nextOnNo değeri ileri yönde geçerli bir soru kimliği olmalı.`);
      }
    }

    if (q.auto && (!Array.isArray(q.mappedRules) || q.mappedRules.length === 0)) {
      errors.push(`${q.id} otomatik sorusunda en az bir mappedRules kaydı olmalı.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function statusLabel(status) {
  switch (status) {
    case "pass": return "Geçti ✓";
    case "fail": return "Kaldı ✗";
    case "manual": return "Manuel İnceleme";
    case "na": return "Uygulanamaz";
    default: return "Bilinmiyor";
  }
}

function confidenceLabel(confidence) {
  switch ((confidence || "").toLowerCase()) {
    case "high": return "Yüksek Güven";
    case "medium": return "Orta Güven";
    case "low": return "Düşük Güven";
    default: return "";
  }
}

module.exports = {
  CHECKLIST,
  QUESTION_RULE_MAPPING,
  buildChecklistResults,
  validateOfficialChecklistSchema,
  statusLabel,
  confidenceLabel,
};
