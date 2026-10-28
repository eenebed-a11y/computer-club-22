# Computer Club MVP

Kompyuter klub uchun QR/NFC to'lov tizimi: mijoz PC'dagi QR yoki NFC stikerni skanerlaydi →
so'rov yuboradi → kassir to'lovni Xolis'da tekshirib tasdiqlaydi → PC avtomatik ochiladi →
vaqt tugaganda qayta bloklanadi.

## Nima tayyor

- `GET /p/:pcId` orqali mijoz sahifasi (telefon → vaqt → kassaga so'rov). NFC stiker shu manzilga yoziladi
- `GET /api/pc/:pcId` orqali frontend uchun PC sahifa JSON ma'lumoti
- `POST /cash-requests` orqali mijoz so'rovi (pending)
- `GET /admin/cash-requests` orqali kassadagi so'rovlar
- `POST /admin/cash-requests/:id/approve` orqali to'lovni tasdiqlash va sessiyani boshlash (`gameId` ixtiyoriy)
- `POST /admin/cash-requests/:id/reject` orqali so'rovni rad etish
- `GET /admin/pcs` orqali PC holatlari
- `GET /admin/sessions` orqali sessionlar
- `POST /admin/pcs/:pcId/start`, `/stop`, `/lock` orqali qo'lda boshqarish
- `POST /agent/register` va `POST /agent/heartbeat` orqali agent ulanishi
- `GET /agent/commands/:pcId` orqali agent command queue
- `client/` — Windows PC agenti (WPF): QR ko'rsatadi, buyruqlarni bajaradi, vaqt tugaganda bloklaydi

Diqqat: `POST /payments/mock-create` olib tashlangan — endi pul tekshirilmasdan sessiya boshlanmaydi.

## Ishga tushirish

```bash
npm install
npm run dev
```

Server odatda `http://localhost:4000` da ishlaydi.

## MongoDB

Ma'lumotlar MongoDB'da bitta hujjat sifatida saqlanadi (`computer_club` bazasi, `state` kolleksiyasi,
`singleton` hujjati). Server ishga tushganda holat shu yerdan yuklanadi, har o'zgarishdan keyin esa
2 soniyalik kechikish (debounce) bilan qayta yoziladi.

Ulanish satri `MONGODB_URI` muhit o'zgaruvchisidan o'qiladi:

```
MONGODB_URI=mongodb+srv://<user>:<parol>@<cluster>.mongodb.net/computer_club?retryWrites=true&w=majority
```

`MONGODB_URI` o'rnatilmagan bo'lsa server avvalgidek faqat xotirada ishlaydi. MongoDB vaqtincha
ulanmasa ham server ishga tushadi va 10 soniyada bir qayta urinadi — klub ishdan qolmaydi.

Eslatma: `lastHeartbeatAt` ataylab saqlanmaydi, aks holda har heartbeat uchun bazaga yozish kerak bo'lardi.
Agent qayta ishga tushganda `register` orqali holatni o'zi tiklaydi.

## Lokal tarmoqda ishlatish (klub)

Railway o'rniga tizim klubning lokal tarmog'ida ishlashi mumkin. Bunda stikerlar lokal IP manzilga
yoziladi va mijoz telefoni klub WiFi'siga ulangan bo'lishi kerak.

- Server: `http://192.168.100.162:4000` (qat'iy IP)
- Kassa paneli: `http://192.168.100.162:4000/admin`
- Stikerlar: `http://192.168.100.162:4000/p/PC-01`, `.../p/PC-02`
- Firewall: TCP 4000 porti faqat lokal tarmoqdan (`LocalSubnet`) ochilgan
- Avtoyuklash: `Computer Club Server` vazifasi (Windows Task Scheduler) kompyuter yonganda
  `node dist/server.js` ni SYSTEM nomidan ishga tushiradi

Kod o'zgargandan keyin:

```powershell
npm run build
Stop-ScheduledTask -TaskName "Computer Club Server"; Start-ScheduledTask -TaskName "Computer Club Server"
```

## Railwayga joylashtirish

`railway.json` build (`npm run build`) va start (`npm start`) buyruqlarini belgilaydi, `PORT` esa `src/server.ts` ichida o'qiladi.

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

Deploydan keyin `Settings → Networking → Generate Domain` orqali manzil olinadi: `https://<nom>.up.railway.app`.

- NFC stiker va QR shu manzilga yoziladi: `https://<nom>.up.railway.app/p/PC-01`
- `client/client.json` ichidagi `serverUrl` ham shu manzilga o'zgartiriladi

Eslatma: ma'lumot MongoDB'da saqlanadi, shuning uchun redeploy yoki restartdan keyin ham sessiyalar va so'rovlar joyida qoladi. Railway'da `ADMIN_KEY` va `MONGODB_URI` o'zgaruvchilarini ham qo'shib qo'ying.

## Birinchi testlar

### 1. PC sahifasini ko'rish

```bash
curl http://localhost:4000/p/PC-01
```

Bu route HTML qaytaradi va ichida avval telefon raqami so'raladi, keyin faqat `kompyuter raqami + to'lov tariflari` ko'rinadi. Sahifa ma'lumotni `GET /api/pc/PC-01` orqali yuklaydi.

### 2. PC JSON API ni ko'rish

```bash
curl http://localhost:4000/api/pc/PC-01
```

### 3. So'rov yuborish va kassada tasdiqlash

```bash
curl -X POST http://localhost:4000/cash-requests ^
  -H "Content-Type: application/json" ^
  -d "{\"pcId\":\"PC-01\",\"requestedMinutes\":60,\"phone\":\"+998901234567\"}"

curl http://localhost:4000/admin/cash-requests

curl -X POST http://localhost:4000/admin/cash-requests/<requestId>/approve ^
  -H "Content-Type: application/json" ^
  -d "{\"gameId\":\"cs2\"}"
```

### 4. Admin panel uchun PC holatlari

```bash
curl http://localhost:4000/admin/pcs
```

### 5. Agent uchun pending commandlarni olish

```bash
curl http://localhost:4000/agent/commands/PC-01
```

## Muhim eslatma

- Ma'lumotlar MongoDB'da bitta hujjat sifatida saqlanadi; `MONGODB_URI` bo'lmasa xotira rejimida ishlaydi.
- Hozircha real `Payme/Click`, `OTP`, va `WebSocket` yo'q (agent polling orqali ishlaydi).
- Keyingi bosqichda real payment callback va alohida kolleksiyalar (sessions, payments) ulash mumkin.
