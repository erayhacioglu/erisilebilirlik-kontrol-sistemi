# EKS - Erişilebilirlik Kontrol Sistemi

WCAG 2.2 Düzey A odaklı, masaüstü (Electron) erişilebilirlik tarama ve raporlama aracı.

## Özellikler
- Otomatik tarama (axe-core + statik kurallar)
- WCAG 2.2 A kontrol listesi ile eşleme (122 soru)
- Manuel inceleme gerektiren maddeleri ayırma
- Sorun detay paneli ve dosya/satır odaklı öneriler
- JSON/CSV/PDF dışa aktarma
- Kural güvenilirliği özeti (yüksek/orta/düşük güven)

## Yerel Çalıştırma
```bash
npm ci
npm start
```

## Test
```bash
npm test --silent
```

## Paket Alma
```bash
npm run dist:mac
npm run dist:win
```

Çıktılar `dist/` klasörüne üretilir.

## GitHub Actions
`.github/workflows/release.yml`:
- Etiket (`v*`) push edildiğinde macOS + Windows build alır
- Artifact olarak paketleri yükler

## Notlar
- macOS dağıtımı için kurumsal kullanımda kod imzalama + notarization önerilir.
- Windows dağıtımı için kod imzalama sertifikası önerilir.
