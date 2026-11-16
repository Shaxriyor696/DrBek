# DrStudy — fiziologiyani kitob asosida o’rganish

Responsive web ilova: 15 ta asosiy fiziologiya mavzusi, Guyton & Hall (14-nashr) kitobining 85 bobi, kitobning asl rasmlari va jadvallari, o’zbekcha izohlar, to’liq o’zbekcha tarjima (bosqichma-bosqich), qaydlar, saqlash, ixtiyoriy testlar, kunlik/haftalik/oylik statistika va manbaga tayangan AI yordamchi.

## Tez ishga tushirish

Talablar: **Node.js 22.13+** (SQLite Node ichida, alohida baza o’rnatish shart emas). Python faqat kontentni qayta import qilish uchun kerak.

```bash
cd drstudy-app
npm install                 # faqat ixtiyoriy @anthropic-ai/sdk (AI va tarjima uchun)
cp .env.example .env        # kerakli qiymatlarni to’ldiring (pastga qarang)
npm start                   # http://localhost:3000
```

Birinchi admin hisobi (kontentni tekshirish va nashr etish uchun):

```bash
npm run create-admin -- siz@example.com "Ismingiz"
```

Tekshiruvlar:

```bash
npm test          # 13 ta avtotest: baholash (AC-08), egalik izolyatsiyasi, CSRF, heartbeat, testlar, tarjima…
npm run check     # kontent butunligi va qamrov hisoboti
```

## `.env` sozlamalari

| Kalit | Nima uchun | Bo’sh bo’lsa |
|---|---|---|
| `BOOK_PDF_PATH` | Kitob PDF fayli: “Kitobdagi sahifani ochish” tugmasi | Tugma “PDF ulanmagan” deydi, qolgan hammasi ishlaydi |
| `ANTHROPIC_API_KEY` | AI yordamchi va tarjima skripti | AI javob o’rniga kitobdan topilgan manba parchalarini ko’rsatadi |
| `CONTENT_ACCESS` | `review_preview` — tekshiruvdagi darslar ogohlantirish bilan ko’rinadi; `published_only` — faqat nashr etilganlar | `review_preview` |
| `MAIL_OUTBOX` | SMTP ulanmaguncha tasdiqlash/parol xatlari shu faylga yoziladi | `data/outbox.log` |
| `PUBLIC_URL`, `SECURE_COOKIES` | HTTPS orqasida joylashtirish | localhost |

## Kontent qayerdan olingan

- `content/lessons/chNN.json` — har bob uchun: **Sodda izoh** (avvalgi o’qishda tayyorlangan o’zbekcha sharh), **Asl matn (EN)** — kitob PDFidan ajratilgan to’liq matn, sarlavhalar, kitob sahifalari, atamalar, ta’riflar.
- `content/figures/img/*.webp` — kitob PDFidan kesib olingan **971** rasm va jadval (959 tasi avtomatik kesilgan, 12 tasi qo’lda kesishni kutmoqda). Katalogdagi 3D rasmlar faqat mavzu muqovasi.
- `content/translations/chNN.uz.json` — **to’liq o’zbekcha tarjima**, kitobdagi xatboshilar bilan bir xil tartibda.
- `content/questions/*.json` — test savollari (hozircha 03 Yurak: 31 ta).

Kontentni qayta import qilish (idempotent, ID lar o’zgarmaydi):

```bash
pip install pymupdf pillow
BOOK_PDF_PATH=... GUYTON_NOTES_DIR=... UI_TOPICS_JSON=... npm run import:content
```

Tarjimalar alohida papkada saqlanadi, shuning uchun qayta import ularni o’chirmaydi.

## To’liq o’zbekcha tarjima

Hozir **10-bob** (“Yurakning ritmik qo’zg’alishi”) to’liq tarjima qilingan: 60 ta xatboshi va sarlavha hamda 4 ta rasm izohi. Darsda **“To’liq tarjima (UZ)”** bo’limini oching.

Qolgan boblarni tarjima qilish uchun `.env` ga `ANTHROPIC_API_KEY` yozing, keyin:

```bash
npm run translate:status                     # qaysi boblar tayyor
npm run translate -- --all --dry-run         # hajm: ~683 000 so’z, ~506 so’rov; token taxmini
npm run translate -- --only ch09,ch11        # avval bir nechta bob
npm run translate -- --all --concurrency 2   # hammasi (to’xtasa, qayta ishga tushiring — davom etadi)
```

Skript haqida:
- har bir xatboshi to’liq tarjima qilinadi, qisqartirilmaydi;
- tarjima manbadan juda qisqa chiqsa, rad etiladi va keyingi ishga tushirishda qayta so’raladi;
- `**Rasm 10-1**` havolalari ishlaydi;
- natija “tekshirilishi kerak” holatida chiqadi.

Narx tanlangan modelga bog’liq. Avval `--dry-run` bilan hajmni ko’ring va hozirgi narxlarni tekshiring.

Qo’lda yoki muharrir tuzatgan tarjimani kiritish: `tools/translations-src/chNN.uz.txt` (format faylning boshida yozilgan), keyin `npm run translate:compile -- tools/translations-src/chNN.uz.txt`.

## Nimalar tayyor va nimalar hali ulanmagan

**Tayyor va ishlaydi:**
- Ro’yxatdan o’tish, kirish, chiqish, dastlabki sozlash, parolni tiklash. Parollar scrypt bilan xeshlanadi, sessiya HttpOnly cookie da, CSRF himoyasi bor.
- 15 mavzu katalogi: qidiruv, filtrlar, saqlash. Mavzu sahifasi: bo’limlar, qamrov, manbalar, oldingi/keyingi mavzu.
- Reader bo’limlari: Sodda izoh / To’liq tarjima (UZ) / Asl matn (EN) / Atamalar / Manba.
  - Kitob rasmlari matn ichida turadi. Lightboxda kattalashtirish (pinch ham ishlaydi) va kitob sahifasini ochish mumkin.
  - Shrift o’lchami sozlanadi. Oxirgi o’qilgan joy tiklanadi. “O’qib bo’ldim” belgisi va takrorlash bayrog’i bor.
- Matnni belgilab: AI dan tushuntirish so’rash, qayd yozish yoki saqlash. Qaydlar avtomatik saqlanadi, boshqa oynada o’zgargan bo’lsa ogohlantiradi.
- Saqlanganlar: papkalar, tur bo’yicha filtr, o’chirib qaytarish.
- Testlar (ixtiyoriy):
  - mashq va imtihon rejimlari, javoblar avtomatik saqlanadi;
  - natija, “xatolarni qayta yechish”, eng yaxshi va oxirgi urinish belgilari;
  - baholash serverda bajariladi.
- Statistika: kunlik, haftalik, oylik. Faqat faol o’qish vaqti hisoblanadi, parallel oynalar ikki marta sanalmaydi. Seriya, aniqlik, mavzular bo’yicha progress bor.
- Global qidiruv: mavzu, bo’lim, o’zbekcha va inglizcha matn, atamalar, rasmlar.
- AI yordamchi:
  - faqat ilovadagi materialdan qidiradi va javobda manbaga havola beradi;
  - manbasi yo’q havolalar olib tashlanadi;
  - to’xtatish, 30 soniyalik limit va kunlik limit bor;
  - kalit bo’lmasa “ulanmagan” deb ochiq aytadi.
- Admin: qamrov, darslar, rasmlarni tasdiqlash yoki rad etish. Nashr shartlari tekshiriladi. Arxivlash, rollar, qayta import.

**Hali ulanmagan yoki tayyor emas:**
- **AI yordamchi** — `ANTHROPIC_API_KEY` kerak.
- **To’liq o’zbekcha tarjima** — 85 bobdan 1 tasi tayyor. Qolganlari skript orqali tarjima qilinadi (API kaliti kerak).
- **Email (SMTP)** — xatlar hozircha `data/outbox.log` faylga yoziladi. **Google orqali kirish** qo’shilmagan.
- **Ekspert tekshiruvi** — hamma darslar, rasmlar va savollar “tekshiruvda” holatida turibdi. Ilova shuning uchun oldindan ko’rish rejimida ishlaydi.
- **12 ta rasm yoki jadval** qo’lda kesishni talab qiladi (`npm run check` ro’yxatini ko’rsatadi). Ular hozircha to’liq sahifa sifatida ko’rsatiladi.
- **Test savollari** faqat 03 Yurak mavzusida bor (31 ta). Boshqa mavzularda “Test hali yo’q” deb yoziladi.
- Sodda izohlar qisqa sharh, to’liq tarjima emas (buni “To’liq tarjima” bo’limi to’ldiradi).

## Web ko’rinish (statik demo)

`node tools/build-demo.mjs` — serverni vaqtinchalik bazada ishga tushirib, API javoblaridan JSON nusxa oladi va `dist/demo/` ga statik sahifa yig’adi (kitob rasmlari bob bo’yicha jamlanadi). Demo rejimida (`window.DS_DEMO`) API brauzerning o’zida `public/js/demo-api.js` orqali javob beradi: o’qish, saqlash, qaydlar, testlar va statistika shu brauzerda saqlanadi. AI va kitob PDF havolasi demoda ulanmagan. Birinchi ochilishda grafiklar bo’sh qolmasligi uchun 1 haftalik namuna faoliyat qo’shiladi va bosh sahifada shu haqida yozib qo’yiladi; Sozlamalardan tozalash mumkin.

## Tuzilma

```
server/        Node HTTP server (router, auth, API, AI, admin, analytics, SQLite)
public/        SPA (vanilla JS modullar, build kerak emas), dizayn tizimi, logolar
content/       import natijasi: darslar, rasmlar, tarjimalar, savollar, qamrov hisoboti
tools/         import (Python + PyMuPDF), tarjima skripti, rasm aniqlash
scripts/       create-admin, check
test/          node:test avtotestlari
```
