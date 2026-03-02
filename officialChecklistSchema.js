"use strict";

// Resmi kontrol listesi soru şeması (tek kaynak)
const { OFFICIAL_CHECKLIST_METADATA } = require("./officialChecklistMetadata");

const BASE_QUESTION_DEFINITIONS = Object.freeze([
  { id: "Q001", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Sayfada görsel (img/svg/figure) var mı?", nextOnNo: "Q014", mappedRules: ["image-alt", "input-image-alt", "area-alt"] },
  { id: "Q002", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Görseller için alt niteliği kullanılmış mı?", mappedRules: ["image-alt", "input-image-alt", "area-alt"] },
  { id: "Q003", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Alt metinleri açıklayıcı mı? (boş veya anlamsız değil mi?)", auto: false, mappedRules: ["image-alt"] },
  { id: "Q004", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Dekoratif görseller alt=\"\" veya role=\"presentation\" ile işaretlenmiş mi?", mappedRules: ["image-alt"] },
  { id: "Q005", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Bağlantı görevi gören görsellerin alt metni bağlantı amacını açıklıyor mu?", mappedRules: ["link-name", "image-alt"] },
  { id: "Q006", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Sayfada CAPTCHA var mı?", nextOnNo: "Q010", mappedRules: ["captcha-detected"] },
  { id: "Q007", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "CAPTCHA için görsel alternatif sunuluyor mu?", trigger: "captcha", mappedRules: ["captcha-detected"] },
  { id: "Q008", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "CAPTCHA için sesli alternatif sunuluyor mu?", trigger: "captcha", mappedRules: ["captcha-detected"] },
  { id: "Q009", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "CAPTCHA yerine daha erişilebilir bir yöntem kullanılıyor mu?", trigger: "captcha", mappedRules: ["captcha-detected"] },
  { id: "Q010", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Sayfada grafik/infografik var mı?", nextOnNo: "Q014", mappedRules: ["canvas-aria-missing"] },
  { id: "Q011", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Grafiklerin uzun açıklaması (longdesc/aria-describedby) sağlanmış mı?", auto: false, mappedRules: ["canvas-aria-missing"] },
  { id: "Q012", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Veri grafikleri metin alternatifi içeriyor mu?", auto: false, mappedRules: ["canvas-aria-missing", "image-alt"] },
  { id: "Q013", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Harita/diyagram gibi karmaşık görsellerin açıklaması var mı?", auto: false, mappedRules: ["canvas-aria-missing", "image-alt"] },
  { id: "Q014", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Sayfada video var mı?", nextOnNo: "Q019", trigger: "video", mappedRules: ["media-transcript-missing", "media-captions-missing"] },
  { id: "Q015", wcag: "1.1.1", criterion: "Metin Dışı İçerik", question: "Videolar için metin transkripti sunuluyor mu?", trigger: "video", mappedRules: ["media-transcript-missing"] },

  { id: "Q016", wcag: "1.2.1", criterion: "Zaman Tabanlı Medya", question: "Önceden kaydedilmiş ses içeriği için transkript var mı?", trigger: "audio", mappedRules: ["media-transcript-missing"] },
  { id: "Q017", wcag: "1.2.2", criterion: "Zaman Tabanlı Medya", question: "Önceden kaydedilmiş video+ses için altyazı (kapalı yazı) var mı?", trigger: "video", mappedRules: ["media-captions-missing"] },
  { id: "Q018", wcag: "1.2.3", criterion: "Zaman Tabanlı Medya", question: "Video için sesli betimleme (audio description) sunuluyor mu?", auto: false, trigger: "video", mappedRules: ["media-captions-missing"] },
  { id: "Q019", wcag: "1.2.2", criterion: "Zaman Tabanlı Medya", question: "Canlı yayın varsa altyazı sunuluyor mu?", trigger: "video", mappedRules: ["media-captions-missing"] },
  { id: "Q020", wcag: "1.2.2", criterion: "Zaman Tabanlı Medya", question: "Medya içeriği otomatik oynatılıyor mu?", trigger: "video", mappedRules: ["1.4.2-audio-control", "auto-animation-no-pause"] },
  { id: "Q021", wcag: "1.2.2", criterion: "Zaman Tabanlı Medya", question: "Otomatik oynatmayı durdurmak için kontrol var mı?", trigger: "video", mappedRules: ["1.4.2-audio-control", "auto-animation-no-pause"] },
  { id: "Q022", wcag: "1.2.1", criterion: "Zaman Tabanlı Medya", question: "Ses içeriği için yeterli ses seviyesi kontrolü var mı?", trigger: "audio", mappedRules: ["1.4.2-audio-control"] },

  { id: "Q023", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "Sayfa yapısı anlamsal HTML ile oluşturulmuş mu? (header/main/nav/footer)", mappedRules: ["custom-headings-structure", "interactive-role-missing"] },
  { id: "Q024", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "Başlık hiyerarşisi doğru sırada mı? (H1 → H2 → H3)", mappedRules: ["custom-headings-structure", "heading-hierarchy-h1-missing", "heading-hierarchy-multiple-h1", "heading-hierarchy-skip"] },
  { id: "Q025", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "Formlar için label etiketleri kullanılmış mı?", mappedRules: ["label"] },
  { id: "Q026", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "Label'lar doğru input'a bağlanmış mı? (for/id eşleşmesi)", mappedRules: ["label"] },
  { id: "Q027", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "Tablo başlıkları (th) scope niteliğiyle işaretlenmiş mi?", mappedRules: ["custom-table-a11y", "interactive-role-missing"] },
  { id: "Q028", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "Listeler semantik ul/ol/li ile oluşturulmuş mu?", mappedRules: ["interactive-role-missing"] },
  { id: "Q029", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "Özel bileşenler için ARIA roller doğru kullanılmış mı?", mappedRules: ["interactive-role-missing", "modal-role-missing", "dropdown-role-missing", "tab-roles-missing", "custom-slider-a11y"] },
  { id: "Q030", wcag: "1.3.1", criterion: "Uyarlanabilir Sunum", question: "aria-label veya aria-labelledby ile erişilebilir isimler verilmiş mi?", mappedRules: ["button-name", "link-name", "custom-icon-only-button-name"] },
  { id: "Q031", wcag: "1.3.2", criterion: "Uyarlanabilir Sunum", question: "Sayfadaki okuma sırası mantıklı mı? (CSS kaldırıldığında bile)", mappedRules: ["custom-headings-structure"] },
  { id: "Q032", wcag: "1.3.2", criterion: "Uyarlanabilir Sunum", question: "Tab sırası içeriğin görsel sırasıyla uyumlu mu?", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q033", wcag: "1.3.2", criterion: "Uyarlanabilir Sunum", question: "Pozitif tabindex değerleri var mı? (kaçınılmalı)", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q034", wcag: "1.3.2", criterion: "Uyarlanabilir Sunum", question: "tabindex değerleri mantıksal sırayı bozuyor mu?", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q035", wcag: "1.3.3", criterion: "Uyarlanabilir Sunum", question: "Bilgi iletmek için yalnızca şekil/boyut/konum kullanılıyor mu?", auto: false, mappedRules: ["color-info-only-pattern"] },
  { id: "Q036", wcag: "1.3.3", criterion: "Uyarlanabilir Sunum", question: "\"Sağdaki buton\" gibi konum tabanlı talimatlar var mı?", auto: false, mappedRules: ["color-info-only-pattern"] },
  { id: "Q037", wcag: "1.3.3", criterion: "Uyarlanabilir Sunum", question: "\"Yuvarlak ikon\" gibi şekil tabanlı talimatlar var mı?", auto: false, mappedRules: ["color-info-only-pattern"] },
  { id: "Q038", wcag: "1.4.1", criterion: "Ayırt Edilebilirlik", question: "Sayfada bilgi aktarmak için sadece renk kullanılıyor mu?", mappedRules: ["color-info-only-pattern"] },
  { id: "Q039", wcag: "1.4.1", criterion: "Ayırt Edilebilirlik", question: "Hata durumları sadece renkle mi gösteriliyor?", mappedRules: ["color-info-only-pattern", "3.3.1-error-message"] },
  { id: "Q040", wcag: "1.4.1", criterion: "Ayırt Edilebilirlik", question: "Grafiklerde veri yalnızca renkle mi ayrılıyor?", mappedRules: ["color-info-only-pattern"] },
  { id: "Q041", wcag: "1.4.1", criterion: "Ayırt Edilebilirlik", question: "Formda zorunlu alanlar sadece renkle mi belirtiliyor?", mappedRules: ["color-info-only-pattern", "label"] },
  { id: "Q042", wcag: "1.4.2", criterion: "Ayırt Edilebilirlik", question: "Sayfada ses otomatik çalıyor mu? (3 saniyeden uzun)", trigger: "audio", mappedRules: ["1.4.2-audio-control"] },
  { id: "Q043", wcag: "1.4.2", criterion: "Ayırt Edilebilirlik", question: "Otomatik sesi durdurmak/kapatmak için kontrol var mı?", mappedRules: ["1.4.2-audio-control"] },
  { id: "Q044", wcag: "1.4.2", criterion: "Ayırt Edilebilirlik", question: "Ses seviyesini ayarlamak için bağımsız kontrol var mı?", mappedRules: ["1.4.2-audio-control"] },

  { id: "Q045", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Tüm işlevler klavyeyle erişilebilir mi?", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q046", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Klavye ile odak tüm interaktif elementlere ulaşabiliyor mu?", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q047", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Özel bileşenler (dropdown/modal/tab) klavyeyle tam çalışıyor mu?", mappedRules: ["custom-dropdown-a11y", "custom-modal-focus-management", "custom-tabs-pattern", "custom-menu-pattern", "custom-slider-a11y"] },
  { id: "Q048", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Klavye kısayolları var mı?", nextOnNo: "Q052", mappedRules: ["keyboard-handler-missing"] },
  { id: "Q049", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Tek karakter klavye kısayolları kapatılabiliyor mu?", auto: false, mappedRules: ["keyboard-handler-missing"] },
  { id: "Q050", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Kısayollar yeniden atanabiliyor mu?", auto: false, mappedRules: ["keyboard-handler-missing"] },
  { id: "Q051", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Kısayollar odak durumuna göre aktif hale getirilebiliyor mu?", auto: false, mappedRules: ["keyboard-handler-missing"] },
  { id: "Q052", wcag: "2.1.2", criterion: "Klavye Erişimi", question: "Klavye odağı modalda hapsolabiliyor mu? (focus trap doğru çalışıyor)", auto: false, mappedRules: ["modal-focus-trap-missing", "custom-modal-focus-management"] },
  { id: "Q053", wcag: "2.1.2", criterion: "Klavye Erişimi", question: "Tab ile modal dışına çıkılabiliyor mu? (çıkılamamalı)", auto: false, mappedRules: ["modal-focus-trap-missing"] },
  { id: "Q054", wcag: "2.1.2", criterion: "Klavye Erişimi", question: "Modal kapatıldığında odak tetikleyiciye dönüyor mu?", mappedRules: ["custom-modal-focus-management"] },
  { id: "Q055", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Tüm interaktif elementler tabindex ile odaklanabilir mi?", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q056", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Gizli (display:none) elementler tab sırasında mı? (olmamalı)", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q057", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Tıklanabilir div/span elementleri role ve tabindex içeriyor mu?", mappedRules: ["custom-nonsemantic-interactive-fallback", "interactive-role-missing"] },
  { id: "Q058", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "onKeyDown handler'lar Enter ve Space tuşlarını destekliyor mu?", auto: false, mappedRules: ["keyboard-handler-missing"] },
  { id: "Q059", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Dropdown'lar Arrow tuşlarıyla gezinilebiliyor mu?", auto: false, mappedRules: ["custom-dropdown-a11y", "keyboard-handler-missing"] },
  { id: "Q060", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Menüler Escape tuşuyla kapatılabiliyor mu?", auto: false, mappedRules: ["custom-menu-pattern", "modal-escape-missing"] },
  { id: "Q061", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Dialog/modal Escape tuşuyla kapatılabiliyor mu?", auto: false, mappedRules: ["modal-escape-missing"] },
  { id: "Q062", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Accordion başlıkları Space ile açılıp kapanıyor mu?", auto: false, mappedRules: ["accordion-expanded-missing", "keyboard-handler-missing"] },
  { id: "Q063", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Tab bileşenlerinde Arrow tuşu navigasyonu var mı?", auto: false, mappedRules: ["tab-roles-missing", "keyboard-handler-missing"] },
  { id: "Q064", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Grid/tablo hücrelerinde Arrow tuşu navigasyonu var mı?", auto: false, mappedRules: ["keyboard-handler-missing"] },
  { id: "Q065", wcag: "2.1.1", criterion: "Klavye Erişimi", question: "Odak hiçbir zaman görünmez hale gelmiyor mu?", auto: false, mappedRules: ["focus-outline-removed", "keyboard-focus-missing"] },

  { id: "Q066", wcag: "2.2.1", criterion: "Zaman Sınırları", question: "Sayfada zaman sınırlı içerik var mı?", nextOnNo: "Q070", mappedRules: ["auto-animation-no-pause"] },
  { id: "Q067", wcag: "2.2.1", criterion: "Zaman Sınırları", question: "Kullanıcı zaman sınırını uzatabilir mi?", mappedRules: ["auto-animation-no-pause"] },
  { id: "Q068", wcag: "2.2.1", criterion: "Zaman Sınırları", question: "Zaman sınırı en az 20 kat uzatılabiliyor mu?", mappedRules: ["auto-animation-no-pause"] },
  { id: "Q069", wcag: "2.2.1", criterion: "Zaman Sınırları", question: "Zaman dolmadan önce uyarı veriliyor mu?", mappedRules: ["auto-animation-no-pause"] },
  { id: "Q070", wcag: "2.2.2", criterion: "Zaman Sınırları", question: "Sayfada otomatik hareket eden içerik var mı?", nextOnNo: "Q075", mappedRules: ["auto-animation-no-pause"] },
  { id: "Q071", wcag: "2.2.2", criterion: "Zaman Sınırları", question: "Kullanıcı hareketi duraklatabilir mi?", auto: false, mappedRules: ["auto-animation-no-pause"] },
  { id: "Q072", wcag: "2.2.2", criterion: "Zaman Sınırları", question: "Kullanıcı hareketi durdurabilir mi?", auto: false, mappedRules: ["auto-animation-no-pause"] },
  { id: "Q073", wcag: "2.2.2", criterion: "Zaman Sınırları", question: "Kullanıcı hareketi gizleyebilir mi?", auto: false, mappedRules: ["auto-animation-no-pause"] },
  { id: "Q074", wcag: "2.2.2", criterion: "Zaman Sınırları", question: "5 saniyeden uzun otomatik hareket/kaydırma var mı?", auto: false, mappedRules: ["auto-animation-no-pause"] },
  { id: "Q075", wcag: "2.2.2", criterion: "Zaman Sınırları", question: "Sayfada otomatik güncellenen içerik var mı?", mappedRules: ["auto-animation-no-pause"] },

  { id: "Q076", wcag: "2.3.1", criterion: "Nöbet ve Fiziksel Tepkiler", question: "Saniyede 3'ten fazla yanıp sönen içerik var mı?", mappedRules: ["fast-animation"] },
  { id: "Q077", wcag: "2.3.1", criterion: "Nöbet ve Fiziksel Tepkiler", question: "Yanıp sönen içerik ekranın %25'inden büyük mü?", mappedRules: ["fast-animation"] },
  { id: "Q078", wcag: "2.3.1", criterion: "Nöbet ve Fiziksel Tepkiler", question: "Hızlı CSS animasyonları (333ms altı) var mı?", mappedRules: ["fast-animation"] },
  { id: "Q079", wcag: "2.3.1", criterion: "Nöbet ve Fiziksel Tepkiler", question: "prefers-reduced-motion medya sorgusu kullanılıyor mu?", mappedRules: ["reduced-motion-missing"] },
  { id: "Q080", wcag: "2.3.1", criterion: "Nöbet ve Fiziksel Tepkiler", question: "Paralaks veya büyük hareket animasyonları için kapatma seçeneği var mı?", auto: false, mappedRules: ["motion-actuation", "reduced-motion-missing"] },

  { id: "Q081", wcag: "2.4.1", criterion: "Gezinme", question: "Ana içeriğe atlama (skip link) mevcut mu?", mappedRules: ["skip-link-missing", "keyboard-focus-missing"] },
  { id: "Q082", wcag: "2.4.1", criterion: "Gezinme", question: "Skip link klavyeyle erişilebilir mi?", auto: false, mappedRules: ["keyboard-focus-missing"] },
  { id: "Q083", wcag: "2.4.1", criterion: "Gezinme", question: "Skip link tıklandığında ana içeriğe geçiyor mu?", auto: false, mappedRules: ["keyboard-focus-missing"] },
  { id: "Q084", wcag: "2.4.2", criterion: "Gezinme", question: "Her sayfanın anlamlı bir başlığı (title) var mı?", mappedRules: ["document-title"] },
  { id: "Q085", wcag: "2.4.2", criterion: "Gezinme", question: "Sayfa başlıkları içeriği açıklayıcı mı?", auto: false, mappedRules: ["document-title"] },
  { id: "Q086", wcag: "2.4.3", criterion: "Gezinme", question: "Tab sırası anlamlı mı? (mantıksal akış)", mappedRules: ["keyboard-focus-missing"] },
  { id: "Q087", wcag: "2.4.3", criterion: "Gezinme", question: "Odak sırası içeriğin yapısıyla uyumlu mu?", auto: false, mappedRules: ["keyboard-focus-missing"] },
  { id: "Q088", wcag: "2.4.4", criterion: "Gezinme", question: "Tüm bağlantılar amacını açıklayan metne sahip mi?", mappedRules: ["link-name", "ambiguous-link-text"] },
  { id: "Q089", wcag: "2.4.4", criterion: "Gezinme", question: "\"Tıklayınız\", \"Buraya\", \"Devamı\" gibi belirsiz linkler var mı?", mappedRules: ["ambiguous-link-text"] },
  { id: "Q090", wcag: "2.4.4", criterion: "Gezinme", question: "Bağlantı amacı bağlam içinde anlaşılıyor mu?", auto: false, mappedRules: ["link-name", "ambiguous-link-text"] },
  { id: "Q091", wcag: "2.4.4", criterion: "Gezinme", question: "İkon-only bağlantılarda aria-label var mı?", mappedRules: ["custom-icon-only-button-name", "link-name"] },
  { id: "Q092", wcag: "2.4.3", criterion: "Gezinme", question: "Görsel odak göstergesi (focus indicator) görünür mü?", mappedRules: ["focus-outline-removed"] },
  { id: "Q093", wcag: "2.4.3", criterion: "Gezinme", question: "outline:none ile odak göstergesi kaldırılmış mı?", mappedRules: ["focus-outline-removed"] },
  { id: "Q094", wcag: "2.4.3", criterion: "Gezinme", question: ":focus-visible stili tanımlanmış mı?", mappedRules: ["focus-outline-removed"] },
  { id: "Q095", wcag: "3.2.1", criterion: "Gezinme", question: "Odaklanma anında sayfa yönlendirmesi oluyor mu?", mappedRules: ["focus-context-change"] },

  { id: "Q096", wcag: "2.5.1", criterion: "Giriş Yardımı", question: "Çok noktalı dokunma hareketleri tek nokta alternatifiyle de çalışıyor mu?", mappedRules: ["pointer-down-action"] },
  { id: "Q097", wcag: "2.5.1", criterion: "Giriş Yardımı", question: "Swipe/pinch gerektiren işlemlerin klavye alternatifi var mı?", mappedRules: ["motion-actuation", "keyboard-handler-missing"] },
  { id: "Q098", wcag: "2.5.2", criterion: "Giriş Yardımı", question: "Tıklama işlemleri mousedown değil click ile tetikleniyor mu?", mappedRules: ["pointer-down-action"] },
  { id: "Q099", wcag: "2.5.2", criterion: "Giriş Yardımı", question: "Yanlış tıklamayı iptal etme imkânı var mı?", mappedRules: ["pointer-down-action"] },
  { id: "Q100", wcag: "2.5.3", criterion: "Giriş Yardımı", question: "Aria-label ile görünür metin uyumlu mu? (label-in-name)", auto: false, mappedRules: ["button-name", "link-name", "custom-icon-only-button-name"] },
  { id: "Q101", wcag: "2.5.3", criterion: "Giriş Yardımı", question: "Sesli komutla tetiklenebilir buton/link isimleri var mı?", auto: false, mappedRules: ["button-name", "link-name"] },
  { id: "Q102", wcag: "2.5.4", criterion: "Giriş Yardımı", question: "Cihaz hareketi ile tetiklenen işlevler için UI alternatifi var mı?", mappedRules: ["motion-actuation"] },

  { id: "Q103", wcag: "3.1.1", criterion: "Okunabilirlik", question: "html elementinde lang niteliği var mı?", mappedRules: ["html-lang-missing"] },
  { id: "Q104", wcag: "3.1.1", criterion: "Okunabilirlik", question: "lang değeri \"tr\" mi?", mappedRules: ["custom-html-lang-tr"] },
  { id: "Q105", wcag: "3.1.1", criterion: "Okunabilirlik", question: "Farklı dil içeren kısımlar işaretlenmiş mi?", auto: false, mappedRules: ["html-lang-missing", "custom-html-lang-tr"] },

  { id: "Q106", wcag: "3.2.1", criterion: "Tahmin Edilebilirlik", question: "Odaklanma anında bağlam değişikliği oluyor mu?", mappedRules: ["focus-context-change"] },
  { id: "Q107", wcag: "3.2.2", criterion: "Tahmin Edilebilirlik", question: "Dropdown/select değiştirince sayfa yönleniyor mu?", mappedRules: ["focus-context-change"] },
  { id: "Q108", wcag: "3.2.2", criterion: "Tahmin Edilebilirlik", question: "Checkbox/radio değişince otomatik işlem başlıyor mu?", mappedRules: ["focus-context-change"] },
  { id: "Q109", wcag: "3.2.2", criterion: "Tahmin Edilebilirlik", question: "Form gönderimi için açık kullanıcı eylemi gerekiyor mu?", auto: false, mappedRules: ["focus-context-change"] },
  { id: "Q110", wcag: "3.2.2", criterion: "Tahmin Edilebilirlik", question: "Onay gerektiren işlemler için açık buton/link var mı?", auto: false, mappedRules: ["focus-context-change"] },

  { id: "Q111", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Sayfada form var mı?", nextOnNo: "Q120", mappedRules: ["3.3.1-error-message", "label"] },
  { id: "Q112", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Hata durumunda hata mesajı gösteriliyor mu?", mappedRules: ["3.3.1-error-message"] },
  { id: "Q113", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Hata mesajı hangi alanın hatalı olduğunu belirtiyor mu?", mappedRules: ["3.3.1-error-message"] },
  { id: "Q114", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Hata mesajı aria-invalid ile işaretlenmiş mi?", mappedRules: ["3.3.1-error-message"] },
  { id: "Q115", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Hata mesajı live region veya role=\"alert\" ile duyuruluyor mu?", mappedRules: ["live-region-missing", "error-not-announced"] },
  { id: "Q116", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Hata mesajı aria-errormessage veya aria-describedby ile alanda bağlı mı?", mappedRules: ["3.3.1-error-message"] },
  { id: "Q117", wcag: "3.3.2", criterion: "Hata Yardımı", question: "Zorunlu alanlar yalnızca * simgesiyle mi belirtiliyor?", mappedRules: ["label"] },
  { id: "Q118", wcag: "3.3.2", criterion: "Hata Yardımı", question: "Zorunlu alanlar metin ile de belirtiliyor mu?", auto: false, mappedRules: ["label"] },
  { id: "Q119", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Form gönderimi sonrası ilk hatalı alana odak taşınıyor mu?", mappedRules: ["3.3.1-error-focus-missing"] },
  { id: "Q120", wcag: "3.3.1", criterion: "Hata Yardımı", question: "Çok hatalı formda hata özeti (error summary) gösteriliyor mu?", mappedRules: ["3.3.1-error-list-missing"] },

  { id: "Q121", wcag: "4.1.2", criterion: "Uyumluluk", question: "Tüm interaktif elementlerin erişilebilir ismi (accessible name) var mı?", mappedRules: ["button-name", "link-name", "custom-icon-only-button-name"] },
  { id: "Q122", wcag: "4.1.2", criterion: "Uyumluluk", question: "Tüm durum değişiklikleri (expanded/selected/checked) ARIA ile bildiriliyor mu?", mappedRules: ["dropdown-expanded-missing", "accordion-expanded-missing", "tab-roles-missing", "custom-slider-a11y"] },
]);

function inferNextOnNoFromQuestion(question) {
  const text = String(question || "");
  const m = text.match(/Soru\s*(\d{1,3})['’]?[a-zçğıöşü]*\s+geçiniz/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 122) return null;
  return `Q${String(n).padStart(3, "0")}`;
}

const QUESTION_DEFINITIONS = Object.freeze(
  BASE_QUESTION_DEFINITIONS.map((q) => {
    const official = OFFICIAL_CHECKLIST_METADATA[q.id] || {};
    const question = official.question || q.question;
    const nextOnNo = official.nextOnNo || inferNextOnNoFromQuestion(question);
    return {
      ...q,
      question,
      wcag: official.wcag || q.wcag,
      criterion: official.criterion || q.criterion,
      nextOnNo,
    };
  })
);

module.exports = { QUESTION_DEFINITIONS };
