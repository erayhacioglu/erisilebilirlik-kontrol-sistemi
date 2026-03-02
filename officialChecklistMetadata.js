"use strict";

const OFFICIAL_CHECKLIST_METADATA = Object.freeze({
  "Q001": {
    "question": "Sayfada görsel (resim, grafik, captcha vb.) yer alıyor mu? (Cevabınız hayırsa Soru 14'e geçiniz.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": "Q014"
  },
  "Q002": {
    "question": "Sayfada yer alan dekoratif amaçlı görseller hariç bütün resim, grafik vb. görseller için kodlamada alternatif metin (HTML'de <alt> etiketi gibi) kullanıldı mı? (NOT: Dekoratif amaçlı kullanılan görsellerin alternatif metin etiketinin sağlanmasına gerek yoktur.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q003": {
    "question": "Sayfada metin ile sunulması halinde test (örneğin işitme testi gibi) veya alıştırmayı geçersiz kılacak metinsel olmayan içerik var mı? (Cevabınız hayırsa Soru 5'e geçiniz.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": "Q005"
  },
  "Q004": {
    "question": "Test (örneğin işitme testi gibi) veya alıştırmanın metin alternatifi, içeriğin açıklayıcı tanımlaması olarak sunuldu mu?",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q005": {
    "question": "Sayfa içerisinde belli bir duyusal deneyim için metinsel olmayan içerik eklendi mi? (Örneğin; sanat eseri, senfoni dinletisi, sonraki sayfaya geç ikonu gibi) (Cevabınız hayırsa Soru 7'ye geçiniz.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q006": {
    "question": "Metinsel olmayan içerik için açıklayıcı alternatif metin etiketi kullanıldı mı?",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q007": {
    "question": "Sayfada CAPTCHA var mı? (Cevabınız hayırsa Soru 10'a geçiniz.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q008": {
    "question": "CAPTCHA için metin ile açıklama sağlandı mı?",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q009": {
    "question": "CAPTCHA için alternatif yöntemler (sesli CAPTCHA vb.) sunuldu mu?",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q010": {
    "question": "Sayfada zamana dayalı medya (video, film, slayt, ses vb.) var mı? (Cevabınız hayırsa Soru 12'ye geçiniz.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q011": {
    "question": "Zamana dayalı medya içeriğinin tamamının veya özetinin metinsel alternatifi var mı? (NOT: Zamana dayalı medya var olan yazıya alternatif ise alternatif olduğu belirtilip, tekrar alternatif konmasına gerek yoktur.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q012": {
    "question": "Kullanıcı ara yüzünde form öğeleri (örneğin düğme), diğer form elemanları veya kodlama ile yaratılmış görsel öğeler kullanıldı mı? (Cevabınız hayırsa Soru 14'e geçiniz.)",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": "Q014"
  },
  "Q013": {
    "question": "Sayfada kullanılan form öğelerinden düğme veya benzeri form elemanlarının amaçlarını açıklayıcı etiketler (HTML'de <name> / <role> etiketleri gibi) kullanıldı mı?",
    "wcag": "1.1.1",
    "criterion": "METİNSEL OLMAYAN İÇERİK",
    "nextOnNo": null
  },
  "Q014": {
    "question": "Sayfada önceden kaydedilmiş yalnızca ses (podcast vb) veya yalnızca görselin bulunduğu sesin olmadığı video öğesi var mı? (Cevabınız hayırsa Soru 16'ya geçiniz.)",
    "wcag": "1.2.1",
    "criterion": "SADECE SES VE SADECE VİDEO ORTAMLARI",
    "nextOnNo": null
  },
  "Q015": {
    "question": "Yalnızca ses veya yalnızca video öğesi için eş değerli bilgiler sunan alternatif (altyazı, işaret dili tercümesi, transkript vb.) kullanıldı mı?",
    "wcag": "1.2.1",
    "criterion": "SADECE SES VE SADECE VİDEO ORTAMLARI",
    "nextOnNo": null
  },
  "Q016": {
    "question": "Önceden kaydedilmiş sesli içerik (podcast, ses ve görüntüyü bir arada sunan video vb.) var mı? (Cevabınız hayırsa Soru 19'a geçiniz.)",
    "wcag": "1.2.2",
    "criterion": "ALTYAZILAR",
    "nextOnNo": null
  },
  "Q017": {
    "question": "Önceden kaydedilmiş sesli içerik için sesli içeriğin alternatifi yoksa altyazı sunuldu mu? (Önceden kaydedilmiş sesli içerik metin içeriğinin alternatifiyse, altyazıya ihtiyaç yoktur. Sesli içeriğin alternatif olduğunun belirtilmesi yeterlidir.)",
    "wcag": "1.2.2",
    "criterion": "ALTYAZILAR",
    "nextOnNo": null
  },
  "Q018": {
    "question": "Önceden kaydedilmiş sesli içerik için sunulan seslendirme ya da metinsel alternatiflerde kullanıcılara içeriğin anlaşılmasını kolaylaştıracak betimleme içeren ek bilgiler sunuldu mu? (Örneğin video görüntüsünü anlatırken \"ekranın sağında genç bir erkek yer alıyor\" şeklinde betimleme yapmak.) (NOT: Sese dayalı videolarda (örneğin röportaj gibi) sesli betimleme yapılmasına gerek yoktur.) (NOT: Önceden kaydedilmiş sesli içerik metin içeriğinin alternatifiyse, altyazıya ihtiyaç yoktur. Sesli içeriğin alternatif olduğunun belirtilmesi yeterlidir.)",
    "wcag": "1.2.3",
    "criterion": "SESLİ AÇIKLAMA VE ORTAM ALTERNATİFİ",
    "nextOnNo": null
  },
  "Q019": {
    "question": "Sitede yer alan gezinim öğeleri ve bağlantılar birbirinden ayırt edilebilecek şekilde gruplandırıldı mı? (Örneğin: Radyo düğmeleri veya onay kutuları gibi bir grup form öğesini işaretlemek için gruplama yapılması gibi)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q020": {
    "question": "Sayfa içerisinde başlık var mı? (Cevabınız hayırsa Soru 23'e geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": "Q023"
  },
  "Q021": {
    "question": "Sayfa içerikleri anlaşılır olacak şekilde başlıklandırıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q022": {
    "question": "Kodlamada sayfa başlıklarında başlık etiketi (HTML'de <h1>...<h6> etiketleri gibi) sırasıyla kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q023": {
    "question": "Sayfada paragraf var mı? (Cevabınız hayırsa Soru 25'e geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": "Q025"
  },
  "Q024": {
    "question": "Kodlamada paragraf etiketi (HTML'de <p> etiketi gibi) kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q025": {
    "question": "Sayfada liste var mı? (Cevabınız hayırsa Soru 27'ye geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q026": {
    "question": "Kodlamada listeler için (HTML'de <ol> veya <ul> veya <dl> etiketleri gibi) liste etiketleri kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q027": {
    "question": "Sayfada tablo var mı? (Cevabınız hayırsa Soru 32'ye geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q028": {
    "question": "Kullanılan tablo veri tablosu mu? (NOT: Kullanılmak istenen tablo veri tablosu değilse ve görsel için kullanılıyorsa CSS kullanılması gerekmektedir.) (Cevabınız hayırsa Soru 32'ye geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q029": {
    "question": "Tablo için tablo etiketi (HTML'de <table> etiketi gibi) kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q030": {
    "question": "Tabloda genel başlık için tablo başlık etiketi (HTML'de <caption> etiketi gibi) kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q031": {
    "question": "Tabloda satırlar veya sütunlar için başlık hücresi etiketi (HTML'de <th> etiketi gibi) kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q032": {
    "question": "Sayfada gezinti (navigasyon) linklerinin bulunduğu bölüm var mı? (Cevabınız hayırsa Soru 34'e geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": "Q034"
  },
  "Q033": {
    "question": "Kodlamada gezinti (navigasyon) linkleri için navigasyon rolü (HTML'de \"role=navigation\" gibi) kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q034": {
    "question": "Sayfada form elemanları var mı? (Cevabınız hayırsa Soru 36'ya geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q035": {
    "question": "Form elemanlarının etiketleri (HTML'de <label> etiketi gibi) doğru şekilde kullanıldı mı?",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q036": {
    "question": "Sayfada önemli bilgiler renkli, kalın veya italik metinler şeklinde kullanıldı mı? (Cevabınız hayırsa Soru 38'e geçiniz.)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": "Q038"
  },
  "Q037": {
    "question": "Kodlamada metinler için semantik etiketler kullanıldı mı? (Örneğin, HTML'de kalın metin için <strong>, italik metin için <em> kullanımı gibi)",
    "wcag": "1.3.1",
    "criterion": "BİLGİ VE İLİŞKİLER",
    "nextOnNo": null
  },
  "Q038": {
    "question": "İçeriklerin belli bir sırayla okunması isteniyor mu? (Cevabınız hayırsa Soru 41'e geçiniz.)",
    "wcag": "1.3.2",
    "criterion": "ANLAMLI SIRALAMA",
    "nextOnNo": "Q041"
  },
  "Q039": {
    "question": "Kodlamada odaklama etiketi (HTML'de <tabindex> etiketi gibi) doğru sıralama ile kullanıldı mı?",
    "wcag": "1.3.2",
    "criterion": "ANLAMLI SIRALAMA",
    "nextOnNo": null
  },
  "Q040": {
    "question": "HTML'de CSS kaldırıldığı zaman sayfa içeriği düzgün okunabiliyor mu?",
    "wcag": "1.3.2",
    "criterion": "ANLAMLI SIRALAMA",
    "nextOnNo": null
  },
  "Q041": {
    "question": "Sayfa içerisinde boşluk kullanılarak tablo oluşturuldu mu? (Cevabınız hayırsa Soru 43'e geçiniz.)",
    "wcag": "1.3.2",
    "criterion": "ANLAMLI SIRALAMA",
    "nextOnNo": "Q043"
  },
  "Q042": {
    "question": "Boşluk kaldırıldığı zaman sayfanın içeriği anlamını koruyor mu?",
    "wcag": "1.3.2",
    "criterion": "ANLAMLI SIRALAMA",
    "nextOnNo": null
  },
  "Q043": {
    "question": "Sayfada içerik ya da işlemler açıklanırken şekil, renk, boyut, görsel konum, yön ve ses gibi duyusal özellikler kullanıldı mı? (Cevabınız hayırsa Soru 45'e geçiniz.)",
    "wcag": "1.3.3",
    "criterion": "DUYUSAL KARAKTERİSTİKLER",
    "nextOnNo": "Q045"
  },
  "Q044": {
    "question": "Örneğin şekil, renk, boyut, görsel konum, yön ve ses gibi duyusal özellikler bilgi vermek için kullanılıyorsa bu bilgi için alternatif erişilebilir talimatlar sağlandı mı? (- Şekil veya görsel konumu kullanırken, kontrollere görünür etiketler sağlanmalıdır, - Renk ve şekil/boyut/konum/yönlendirmeyi birleştirirken, ekran okuyucu kullanıcıları için ekran dışı metin alternatifi sağlanmalıdır, - Sesi ipucu olarak kullanırken, onu metin/renk tabanlı ipuçlarıyla birleştirilmelidir.)",
    "wcag": "1.3.3",
    "criterion": "DUYUSAL KARAKTERİSTİKLER",
    "nextOnNo": null
  },
  "Q045": {
    "question": "Sayfada bilgi, görsel bir öğe, bir yanıt veya bir eylem var mı? (Bilgiye örnek: formlarda zorunlu alanların renk ile gösterilmesi, hataların kırmızı renk ile gösterilmesi gibi. Görsel öğeye örnek: grafiklerde Ayşe’nin satışları kırmızı, Mehmet’in satışları mavi gibi. Yanıta örnek: form alanlarında boş bırakılan alanın renkle vurgulanması gibi. Eyleme örnek: veri tabanının başarılı bir şekilde güncellenmesinin renkle ifade edilmesi gibi.) (Cevabınız hayırsa Soru 48'e geçiniz.)",
    "wcag": "1.4.1",
    "criterion": "RENK KULLANIMI",
    "nextOnNo": "Q048"
  },
  "Q046": {
    "question": "Sayfadaki bilgi, görsel bir öğe, bir yanıt veya bir eylem sadece renk kullanılarak anlatıldı mı? (Cevabınız hayırsa Soru 48'e geçiniz.)",
    "wcag": "1.4.1",
    "criterion": "RENK KULLANIMI",
    "nextOnNo": "Q048"
  },
  "Q047": {
    "question": "Sadece renk ile ifade edilen bilgiye, görsel öğeye, yanıta veya eyleme alternatif metin sunuldu mu?",
    "wcag": "1.4.1",
    "criterion": "RENK KULLANIMI",
    "nextOnNo": null
  },
  "Q048": {
    "question": "Sayfada ses öğesi (ses, video, müzik vb.) var mı? (Cevabınız hayırsa Soru 51'e geçiniz.)",
    "wcag": "1.4.2",
    "criterion": "SES DENETİMİ",
    "nextOnNo": "Q051"
  },
  "Q049": {
    "question": "Otomatik olarak çalınan ses öğesi 3 saniyeden daha uzun sürüyor mu? (Cevabınız hayırsa Soru 51'e geçiniz.)",
    "wcag": "1.4.2",
    "criterion": "SES DENETİMİ",
    "nextOnNo": "Q051"
  },
  "Q050": {
    "question": "Ses öğesi kullanıcı tarafından klavye veya başka bir mekanizma üzerinden de durdurulabiliyor, kapatılabiliyor veya yönetilebiliyor mu?",
    "wcag": "1.4.2",
    "criterion": "SES DENETİMİ",
    "nextOnNo": null
  },
  "Q051": {
    "question": "Sayfadaki bütün içerik ve işlemlere klavye ile kontrol sağlanıyor mu? (Cevabınız evetse Soru 62'ye geçiniz.)",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q052": {
    "question": "Sayfada medya oynatıcısı var mı? (Cevabınız hayırsa Soru 54'e geçiniz.)",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": "Q054"
  },
  "Q053": {
    "question": "Medya oynatıcısında yapılan işlemler klavyeden yapılabiliyor mu?",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q054": {
    "question": "Sayfada açılır menü var mı? (Cevabınız hayırsa Soru 56'ya geçiniz.)",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q055": {
    "question": "Açılır menü klavye ile açılabiliyor mu?",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q056": {
    "question": "Sayfada diyalog kutusu veya otomatik açılır pencere var mı? (Cevabınız hayırsa Soru 58'e geçiniz.)",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": "Q058"
  },
  "Q057": {
    "question": "Diyalog kutusu veya otomatik açılır pencere klavye ile kontrol edilebiliyor veya kapatılabiliyor mu?",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q058": {
    "question": "Sayfada üzerine gelindiği zaman rengi değişen bağlantı var mı? (Cevabınız hayırsa Soru 60'a geçiniz.)",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q059": {
    "question": "Rengi değişen bağlantı klavye ile de renk değiştirebiliyor mu? (Örneğin, bağlantının üzerine fare ile gelindiğinde rengi değişiyorsa, klavye ile de bağlantıya gelindiğinde rengi değişmeli)",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q060": {
    "question": "Sayfada sürükle/bırak fonksiyonu var mıdır? (Cevabınız hayırsa Soru 62'ye geçiniz.)",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q061": {
    "question": "Sürükle bırak fonksiyonu klavyeden yapılabiliyor mu?",
    "wcag": "2.1.1",
    "criterion": "KLAVYE",
    "nextOnNo": null
  },
  "Q062": {
    "question": "Kontrol sağlanan içerik ve işlemler (örneğin uyarı/bilgilendirme mesajı, otomatik açılır pencere vb.) sayfada var mı? (Cevabınız hayırsa Soru 64'e geçiniz.)",
    "wcag": "2.1.2",
    "criterion": "KLAVYE KİLİTLENMESİNİN OLMAMASI",
    "nextOnNo": "Q064"
  },
  "Q063": {
    "question": "Kontrol sağlanan içerik ve işlemlerden klavye kullanılarak çıkış yapılabiliyor mu?",
    "wcag": "2.1.2",
    "criterion": "KLAVYE KİLİTLENMESİNİN OLMAMASI",
    "nextOnNo": null
  },
  "Q064": {
    "question": "Site tasarlanırken büyük ve küçük harf, noktalama işaretleri, sayı veya sembol karakterleri kullanılarak klavye kısayolları oluşturuldu mu? (Cevabınız hayırsa Soru 66'ya geçiniz.)",
    "wcag": "2.1.4",
    "criterion": "KLAVYE KISAYOLLARI",
    "nextOnNo": null
  },
  "Q065": {
    "question": "Aşağıdakilerden herhangi bir tanesi sağlanıyor mu? a) Klavye kısayolları devre dışı bırakılabiliyor olmalı. b) Klavye kısayolları ekrana yazdırılamayan tuşlarla (Ctrl, Alt gibi) değiştirilebiliyor olmalı. c) Arayüz bileşenine odaklanıldığı zaman sadece bu bileşenle ilgili klavye kısayolları aktif olmalı.",
    "wcag": "2.1.4",
    "criterion": "KLAVYE KISAYOLLARI",
    "nextOnNo": null
  },
  "Q066": {
    "question": "Sayfada yapılan işlemlerde zaman sınırlaması var mı? (Cevabınız hayırsa Soru 68'e geçiniz.) İstisna: Zaman sınırlaması gerçek zamanlı etkinliğin parçasıysa ve alternatifi yoksa, uzatma faaliyeti geçersiz kılıyorsa (ör. biletleme), veya zaman sınırı 20 saatten uzunsa.",
    "wcag": "2.2.1",
    "criterion": "AYARLANABİLİR ZAMAN",
    "nextOnNo": "Q068"
  },
  "Q067": {
    "question": "Aşağıdakilerden herhangi bir tanesi sağlanıyor mu? a) Kullanıcı zaman sınırlamasını durdurabiliyor olmalı. b) Kullanıcı varsayılan değerin en az on katına kadar zaman sınırlamasını uzatabiliyor olmalı. c) Kullanıcı, zaman sınırlaması sona ermeden önce uyarılıyor ve basit bir işlemle zaman sınırını uzatması için en az 20 saniye veriliyor, zaman sınırını en az 10 kez uzatabiliyor olmalı.",
    "wcag": "2.2.1",
    "criterion": "AYARLANABİLİR ZAMAN",
    "nextOnNo": null
  },
  "Q068": {
    "question": "Sayfada otomatik olarak güncellenen bilgi (animasyon, oyunlar, sayfa içerisindeki reklamlar gibi) otomatik olarak başlıyor ve başka bir içerikle paralel olarak sunuluyor mu? (Cevabınız hayırsa Soru 76'ya geçiniz.)",
    "wcag": "2.2.2",
    "criterion": "DURAKLATMA, DURDURMA, GİZLEME",
    "nextOnNo": null
  },
  "Q069": {
    "question": "Otomatik yenilenme çok önemli bir aktivitenin bir parçası değilse kullanıcı tarafından duraklatılabiliyor, durdurulabiliyor, gizlenebiliyor veya otomatik güncellemenin frekansı kontrol edilebiliyor mu?",
    "wcag": "2.2.2",
    "criterion": "DURAKLATMA, DURDURMA, GİZLEME",
    "nextOnNo": null
  },
  "Q070": {
    "question": "Sayfada hareket eden, yanıp sönen veya kayan içerik var mıdır? (Cevabınız hayırsa Soru 76'ya geçiniz.)",
    "wcag": "2.2.2",
    "criterion": "DURAKLATMA, DURDURMA, GİZLEME",
    "nextOnNo": null
  },
  "Q071": {
    "question": "Sayfada hareket eden, yanıp sönen veya kayan içerik otomatik olarak başlıyor, 5 saniyeden fazla sürüyor ve başka bir içerikle paralel olarak sunuluyor mu? (Cevabınız hayırsa Soru 73'e geçiniz.)",
    "wcag": "2.2.2",
    "criterion": "DURAKLATMA, DURDURMA, GİZLEME",
    "nextOnNo": "Q073"
  },
  "Q072": {
    "question": "Sayfada hareket eden, yanıp sönen veya kayan içerik çok önemli bir aktivitenin bir parçası değilse kullanıcı tarafından duraklatılabiliyor, durdurulabiliyor veya gizlenebiliyor mu?",
    "wcag": "2.2.2",
    "criterion": "DURAKLATMA, DURDURMA, GİZLEME",
    "nextOnNo": null
  },
  "Q073": {
    "question": "Sayfada yanıp sönen veya parlayan içerik var mı? (Cevabınız hayırsa Soru 76'ya geçiniz.)",
    "wcag": "2.3.1",
    "criterion": "ÜÇ KERE YA DA AŞAĞISI YANIP SÖNME EŞİĞİ",
    "nextOnNo": null
  },
  "Q074": {
    "question": "İçerik saniyede 3 kereden az yanıp sönüyor mu?",
    "wcag": "2.3.1",
    "criterion": "ÜÇ KERE YA DA AŞAĞISI YANIP SÖNME EŞİĞİ",
    "nextOnNo": null
  },
  "Q075": {
    "question": "İçerik ekran boyutunun %25'inden daha küçük mü?",
    "wcag": "2.3.1",
    "criterion": "ÜÇ KERE YA DA AŞAĞISI YANIP SÖNME EŞİĞİ",
    "nextOnNo": null
  },
  "Q076": {
    "question": "Sitenin farklı sayfalarında tekrar eden içerik var mı? (Cevabınız hayırsa Soru 78'e geçiniz.)",
    "wcag": "2.4.1",
    "criterion": "BLOKLARIN PAS GEÇİLMESİ",
    "nextOnNo": "Q078"
  },
  "Q077": {
    "question": "Kullanıcı tekrar eden içeriği pas geçebiliyor mu veya atlayabilmek için link verildi mi?",
    "wcag": "2.4.1",
    "criterion": "BLOKLARIN PAS GEÇİLMESİ",
    "nextOnNo": null
  },
  "Q078": {
    "question": "Sitenin her bir sayfa başlığı başlık çubuğunda (title) yer alıyor mu? (Cevabınız hayırsa Soru 80'e geçiniz.)",
    "wcag": "2.4.2",
    "criterion": "KONU BAŞLIKLI SAYFA",
    "nextOnNo": "Q080"
  },
  "Q079": {
    "question": "Sayfa başlıkları sayfa içeriğini açıklayan, anlaşılır ve bilgi verici şekilde oluşturuldu mu?",
    "wcag": "2.4.2",
    "criterion": "KONU BAŞLIKLI SAYFA",
    "nextOnNo": null
  },
  "Q080": {
    "question": "Sayfanın içeriği sıralı olarak gezilebiliyor ve bu gezinti sırası eylem açısından bir anlam ifade ediyor mu?",
    "wcag": "2.4.3",
    "criterion": "ODAKLAMA SIRASI",
    "nextOnNo": null
  },
  "Q081": {
    "question": "Kullanıcı sayfa elemanlarını (form elemanları, bağlantılar vb.) Tab veya Shift+Tab ile doğru sırayla okuyabiliyor mu?",
    "wcag": "2.4.3",
    "criterion": "ODAKLAMA SIRASI",
    "nextOnNo": null
  },
  "Q082": {
    "question": "Sayfa üzerindeki etiketlerin birbiriyle hiyerarşik bir yapı oluşturması yani DOM (Belge Nesne Modeli) yapısıyla görsel arayüzü uyumlu mu?",
    "wcag": "2.4.3",
    "criterion": "ODAKLAMA SIRASI",
    "nextOnNo": null
  },
  "Q083": {
    "question": "Sayfada iç sayfalara ya da başka sitelere bağlantı (link) var mı? (Cevabınız hayırsa Soru 85'e geçiniz.)",
    "wcag": "2.4.4",
    "criterion": "BAĞLANTININ MAKSADI",
    "nextOnNo": "Q085"
  },
  "Q084": {
    "question": "Bütün bağlantılar içeriği tanımlayacak şekilde açık ve anlaşılır olarak isimlendirilmiş mi? (NOT: \"Tıklayınız\" gibi belirsiz bağlantılardan kaçınınız.Örneğin; \"Soru ve öneriler için tıklayınız\" gibi anlaşılır bağlantılar kullanınız.)",
    "wcag": "2.4.4",
    "criterion": "BAĞLANTININ MAKSADI",
    "nextOnNo": null
  },
  "Q085": {
    "question": "Sayfada çok noktalı dokunma veya imleci/parmağı kaydırma hareketi ile gerçekleştirilen bir içerik var mı? (Örneğin Google Maps'i kullanmak için çok noktalı dokunma ve kaydırma hareketi yapılması gibi) (Cevabınız hayırsa Soru 87'ye geçiniz.)",
    "wcag": "2.5.1",
    "criterion": "İŞARETÇİ HAREKETLERİ",
    "nextOnNo": null
  },
  "Q086": {
    "question": "Kullanıcı bu içeriğe alternatif bir yöntemle erişebiliyor mu? (Örneğin, büyütmek için artı/eksi düğmeleri koymak, sürükle bırak yerine yön tuşları kullanmak gibi.)",
    "wcag": "2.5.1",
    "criterion": "İŞARETÇİ HAREKETLERİ",
    "nextOnNo": null
  },
  "Q087": {
    "question": "Sayfada tek işaretçi kullanılarak yani tek dokunma ile işlem yapılıyor mu? (Örneğin, tek veya çift vurma ve tıklama, uzun basma veya yola dayalı hareketler gibi.) (Cevabınız hayırsa Soru 89'a geçiniz.)",
    "wcag": "2.5.2",
    "criterion": "İŞARETÇİ İPTALİ",
    "nextOnNo": null
  },
  "Q088": {
    "question": "Sayfada yapılan işlem esnasında aşağıdakilerden herhangi bir tanesi sağlanıyor mu? a) Kullanıcı işaretçiyi veya eylemi bıraktığı esnada işlem iptal olmalı. b) Kullanıcı hedefin üzerinde olmadığında parmağını veya işaretçiyi bıraktığında eylem iptal olmalı veya kullanıcıya geri alma seçeneği sağlanmalı. c) Kullanıcı yanlış yere dokunursa, parmağını veya işaretçisini kaldırmadan önce bu konumdan kaydırdığında eylem iptal olmalı.",
    "wcag": "2.5.2",
    "criterion": "İŞARETÇİ İPTALİ",
    "nextOnNo": null
  },
  "Q089": {
    "question": "Arayüz bileşeninin erişilebilir ismi görünür etiket ismi ile aynı mı veya arayüz bileşeninin erişilebilir ismi görünür etiket ismi ile başlıyor mu?",
    "wcag": "2.5.3",
    "criterion": "İSİMLERİN KULLANILAN ETİKETİ İÇERMESİ",
    "nextOnNo": null
  },
  "Q090": {
    "question": "Site tasarlanırken cihazın (telefon, tablet gibi) hareket ettirilmesine bağlı olarak (sallama, döndürme vb.) herhangi bir işlem gerçekleştiriliyor mu? (Cevabınız hayırsa Soru 93'e geçiniz.)",
    "wcag": "2.5.4",
    "criterion": "HAREKET İLE ÇALIŞTIRMA",
    "nextOnNo": "Q093"
  },
  "Q091": {
    "question": "Bu işlemi gerçekleştirecek ek yöntem sunuldu mu? (Örneğin kullanıcı bir sonraki veya önceki sayfaya ilerlemek için cihazı eğebilir fakat aynı işlem için düğme (button) de sağlanabilir.)",
    "wcag": "2.5.4",
    "criterion": "HAREKET İLE ÇALIŞTIRMA",
    "nextOnNo": null
  },
  "Q092": {
    "question": "Harekete bağlı işlev kapatılabiliyor mu?",
    "wcag": "2.5.4",
    "criterion": "HAREKET İLE ÇALIŞTIRMA",
    "nextOnNo": null
  },
  "Q093": {
    "question": "HTML kodunda sayfanın dili belirtilmiş mi?",
    "wcag": "3.1.1",
    "criterion": "SAYFANIN DİLİ",
    "nextOnNo": null
  },
  "Q094": {
    "question": "Sayfada arayüz bileşeni (user interface component) var mı? (Örneğin, metin kutusu, seçenek düğmesi, arama alanı, site içi gezinme bağlantısı, sayfalama, bildirim menüsü, menüler gibi.) (Cevabınız hayırsa Soru 98'e geçiniz.)",
    "wcag": "3.2.1",
    "criterion": "ODAKLAMADA",
    "nextOnNo": "Q098"
  },
  "Q095": {
    "question": "Sayfada arayüz bileşenine odaklanıldığında bağlam değişikliği (yeni bir sayfaya yönlendirme, otomatik açılır pencere (pop-up vb.) açılması gibi) oluyor mu? ( NOT: Arayüz bileşenine odaklandığında bağlam değişikliğinin olmaması gerekmektedir.) (NOT: Bu sorunun cevabının hayır olması bu kriterin erişilebilir olduğunu gösterir)",
    "wcag": "3.2.1",
    "criterion": "ODAKLAMADA",
    "nextOnNo": null
  },
  "Q096": {
    "question": "Arayüz bileşenlerinde bağlam değişikliği olmadan önce kullanıcıya sesli ve görsel uyarı veriliyor mu?",
    "wcag": "3.2.2",
    "criterion": "GİRDİ İÇİN",
    "nextOnNo": null
  },
  "Q097": {
    "question": "Kullanıcı arayüz bileşenlerinde bağlam değişikliği olacağına onay verebiliyor mu? (Örneğin, Gönder (Submit) düğmesi ile onay verebilmeli.)",
    "wcag": "3.2.2",
    "criterion": "GİRDİ İÇİN",
    "nextOnNo": null
  },
  "Q098": {
    "question": "Web sayfasında aşağıdaki mekanizmalardan herhangi biri mevcut mu? a. İletişim Sayfaları, İletişim Bilgileri (Telefon Numarası, E-posta adresi, Adres vb) b. İnsan Etkileşimli Yardım Sayfası (İletişim Formu, Canlı Sohbet Sistemleri, Sosyal medya gibi iletişim mekanizması) c. Sıkça Sorulan Sorular, Destek Sayfası, Kendi Kendine Yardım Sayfaları vb d. Otomatik sohbet robotu (Cevabınız hayırsa Soru 101'e geçiniz.)",
    "wcag": "3.2.6",
    "criterion": "TUTARLI YARDIM",
    "nextOnNo": "Q101"
  },
  "Q099": {
    "question": "Bu mekanizmalar sayfa yakınlaştırıldığında, sayfa yön değiştirdiğinde veya site içinde başka bir sayfaya geçildiğinde görsel konumu aynı yerde mi?",
    "wcag": "3.2.6",
    "criterion": "TUTARLI YARDIM",
    "nextOnNo": null
  },
  "Q100": {
    "question": "Bu mekanizmalar yardımcı teknolojideki kodlama sırası ile görsel aynı göreceli sıralamada mı?",
    "wcag": "3.2.6",
    "criterion": "TUTARLI YARDIM",
    "nextOnNo": null
  },
  "Q101": {
    "question": "Sayfada kullanıcının girdi hatası yapabileceği bir durum söz konusu mu? (Örneğin, veri girişi yaparken rakam yerine harf girilmesi gibi.) (Cevabınız hayırsa Soru 111'e geçiniz.)",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": "Q111"
  },
  "Q102": {
    "question": "Hata metni kullanıcının anlayabileceği şekilde açık ve anlamlı olarak ifade edildi mi?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q103": {
    "question": "Kullanıcı hata yaparsa aldığı hata mesajını hemen görebiliyor mu?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q104": {
    "question": "Hatanın bulunduğu bölümde hata mesajları vurgulu ve belirgin mi?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q105": {
    "question": "Kullanıcının hata mesajı aldığı bölümü atlayabileceği bir mekanizma bulunuyor mu?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q106": {
    "question": "Sayfanın başlık çubuğunda hata bildirimlerine yer verildi mi?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q107": {
    "question": "Form, hata mesajları listesi ile birlikte tekrar gösteriliyor mu?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q108": {
    "question": "Hata mesajlarında metinsel olmayan içerikler için metin alternatifi sağlandı mı?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q109": {
    "question": "Veri girişleri başarılı bir şekilde tamamlandıysa sonrasında kullanıcı başarı mesajı alıyor mu?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q110": {
    "question": "Form gönderildiği zaman sunucu tarafından da doğrulanıyor mu?",
    "wcag": "3.3.1",
    "criterion": "HATA TANIMLAMASI",
    "nextOnNo": null
  },
  "Q111": {
    "question": "Kullanıcı veri girişi yaparken verinin hangi formatta girilmesi gerektiği ile ilgili metinsel talimatlar var mı?",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": null
  },
  "Q112": {
    "question": "Form alanında, benzer alanlar gruplandırıldı mı?",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": null
  },
  "Q113": {
    "question": "Grup kontrolleri için alan kümesi ve başlığı etiketleri (HTML'de <fieldset> ve <legend> etiketleri gibi) kullanıldı mı?",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": null
  },
  "Q114": {
    "question": "Form elemanları için açıklayıcı etiketler kullanıldı mı?",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": null
  },
  "Q115": {
    "question": "Kullanılan etiketlerin form elemanlarıyla ilişkisi doğru konumlandırıldı mı? (Örneğin; form elemanı onay kutusu veya seçenek düğmesi ise etiketin hemen sonrasında yer alması gibi.)",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": null
  },
  "Q116": {
    "question": "Zorunlu doldurulacak form elemanı var mı? (Cevabınız hayırsa Soru 118'e geçiniz.)",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": "Q118"
  },
  "Q117": {
    "question": "Zorunlu doldurulacak form elemanları için metin kullanıldı mı?",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": null
  },
  "Q118": {
    "question": "Kodlamada form elemanları için başlık etiketleri (HTML'de <label> veya <title> etiketleri gibi) kullanıldı mı?",
    "wcag": "3.3.2",
    "criterion": "ETİKETLER VE KULLANIM TALİMATLARI",
    "nextOnNo": null
  },
  "Q119": {
    "question": "Form alanında kullanıcı tarafından girilen veya kullanıcıya sağlanan verilerin tekrar girilmesi gerekiyor mu? (Örneğin, teslimat adresiyle fatura adresi bilgilerinin aynı girilmesi gibi.) (Cevabınız hayırsa Soru 121'e geçiniz.)",
    "wcag": "3.3.7",
    "criterion": "TEKRARLANAN GİRİŞ",
    "nextOnNo": "Q121"
  },
  "Q120": {
    "question": "Bu veriler otomatik olarak doldurulmuş şekilde geliyor mu veya kullanıcının seçmesine izin veriliyor mu? (NOT: Yeniden girilmesi gereken önemli bilgiler (e-posta teyidi gibi), güvenlik için gerekli bilgiler (şifre tekrarı vb.), geçerliliğini yitirmiş veriler (süresi dolmuş kredi kartı bilgileri) dahil değildir.)",
    "wcag": "3.3.7",
    "criterion": "TEKRARLANAN GİRİŞ",
    "nextOnNo": null
  },
  "Q121": {
    "question": "Sayfada kodlamayla oluşturulan arabirim bileşenleri (form öğeleri, bağlantılar veya bileşenler) var mı? (Cevabınız hayırsa kontrol listesi tamamlanmıştır.)",
    "wcag": "4.1.2",
    "criterion": "İSİM, ROL, DEĞER",
    "nextOnNo": null
  },
  "Q122": {
    "question": "Arabirim bileşenlerinin ad, rol, durum ve değer bilgileri doğru olarak girildi mi? (Kontrol listesi tamamlanmıştır.)",
    "wcag": "4.1.2",
    "criterion": "İSİM, ROL, DEĞER",
    "nextOnNo": null
  }
});

module.exports = { OFFICIAL_CHECKLIST_METADATA };
