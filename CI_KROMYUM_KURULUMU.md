# CI Chromium Kurulumu

Bu projede dinamik erişilebilirlik testleri için Chromium gereklidir.

## Komutlar

- Normal test: `npm test`
- Chromium zorunlu test (CI): `npm run test:ci`

`test:ci` komutu şunları yapar:

1. Chromium/Chrome yolunu otomatik bulmaya çalışır.
2. `A11Y_REQUIRE_CHROMIUM=1` ile testleri çalıştırır.
3. `A11Y_COMPONENT_GATE=1` ile bileşen erişilebilirlik kapısını strict modda etkinleştirir.
4. Chromium bulunamazsa açık hata verip `exit 1` döner.

## Gerekirse elle yol verin

Otomatik bulma başarısız olursa aşağıdaki değişkenlerden birini tanımlayın:

- `CHROME_PATH`
- `PUPPETEER_EXECUTABLE_PATH`

Örnek (macOS):

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run test:ci
```

## Beklenen davranış

- Chromium mevcutsa: runtime senaryo testleri `SKIP` yerine gerçek çalışır.
- Chromium yoksa: CI kırılır (istenen davranış).
