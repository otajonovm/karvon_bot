# Karvon — DigitalOcean ga deploy qilish

Ikki yo'l: **Droplet (tavsiya)** yoki **App Platform**.

---

## 0. Oldindan tayyorlash (lokal kompyuterda)

### Telegram session olish (scraper uchun)

Serverda QR/login ishlamaydi. Avval lokalda kirish qiling:

```powershell
cd Karvon
node scraper.js
# QR yoki telefon bilan login → session.txt yaratiladi
```

`session.txt` ichidagi **butun matnni** nusxa oling — bu `TELEGRAM_SESSION` bo'ladi.

### Supabase

`supabase/schema.sql`, `policies.sql`, `migration_scraper.sql` ni Supabase SQL Editor da ishga tushiring.

---

## 1-usul: Droplet (tavsiya etiladi) — $6/oy

Bot + scraper doimiy ishlashi uchun eng qulay.

### DigitalOcean da yaratish

1. [cloud.digitalocean.com](https://cloud.digitalocean.com) → **Create** → **Droplets**
2. **Ubuntu 22.04**, plan **Basic $6** (1 GB RAM)
3. Region: **Frankfurt (fra)** yoki yaqinroq
4. SSH key qo'shing (yoki parol)
5. Create Droplet

### Serverga ulanish

```bash
ssh root@DROPLET_IP
```

### O'rnatish

```bash
apt update && apt install -y git
git clone https://github.com/otajonovm/karvon_bot.git /opt/karvon
cd /opt/karvon
bash deploy/setup-droplet.sh
```

### `karvon.env` to'ldirish

```bash
nano /opt/karvon/karvon.env
```

| O'zgaruvchi | Qayerdan olish |
|---|---|
| `BOT_TOKEN` | [@BotFather](https://t.me/BotFather) |
| `API_ID`, `API_HASH` | [my.telegram.org](https://my.telegram.org) |
| `SUPABASE_URL`, `SUPABASE_KEY` | Supabase → Settings → API |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) |
| `CARGO_GROUPS` | Guruh ID lari vergul bilan |
| `TELEGRAM_SESSION` | Lokal `session.txt` dan nusxa |
| `TELEGRAM_USE_WSS` | `1` (serverda tavsiya) |

Keyin:

```bash
cd /opt/karvon
pm2 restart all
pm2 logs
```

### Yangilash (keyingi pushlardan keyin)

```bash
cd /opt/karvon
git pull
npm ci --omit=dev
pm2 restart all
```

---

## 2-usul: App Platform — GitHub dan avto-deploy

**Arxitektura:** bitta Web Service (`server.js`) — bot va scraper parallel, alohida Worker kerak emas.

1. DigitalOcean → **Apps** → **Create App** (yoki mavjud app ni tahrirlang)
2. **GitHub** → `otajonovm/karvon_bot` → branch `main`
3. **Component:** faqat **1 ta Web Service** — `http_port: 8080`, `run_command: npm start`
4. **Worker komponentini o'chiring** (agar bor bo'lsa) — `karvon-scraper` Degraded sababi
5. **Edit Spec** → `.do/app.yaml` mazmunini qo'llang
6. **Health check path:** `/health`
7. **Environment Variables** — faqat **App-Level** da qo'shing (Encrypt):

   Apps → Settings → **App-Level Environment Variables** → Edit

| Key | Qayerdan |
|-----|----------|
| `BOT_TOKEN` | @BotFather |
| `API_ID` | my.telegram.org |
| `API_HASH` | my.telegram.org |
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_KEY` | Supabase → anon/service key |
| `DEEPSEEK_API_KEY` | platform.deepseek.com |
| `CARGO_GROUPS` | `-1002468475563,-1002956624079,-1002182000321` |
| `TELEGRAM_SESSION` | Lokal `session.txt` dan nusxa (scraper uchun) |

> **Muhim:** `.do/app.yaml` da SECRET kalitlarni yozmang — bo'sh component override app-level ni o'chiradi va `Missing BOT_TOKEN` chiqadi.
> Har birini yozib **Save** bosing, keyin **Actions → Deploy**.
> `NODE_ENV`, `PORT`, `TELEGRAM_USE_WSS` yaml da — qayta kiritish shart emas.

5. **Deploy**

> Health check: `server.js` `PORT` da `/health` ga `200 OK` qaytaradi.
> **Instance count = 1** (409 va AUTH_KEY conflict bo'lmasin).
> Lokalda ham cloud bilan bir vaqtda ishlamang: `node scripts/stop-karvon.js`

---

## 3-usul: Docker (Droplet ichida)

```bash
cd /opt/karvon
cp .env.example karvon.env
nano karvon.env   # to'ldiring
docker compose up -d --build
docker compose logs -f
```

---

## Tekshirish

```bash
pm2 status
pm2 logs karvon-bot
pm2 logs karvon-scraper
# yoki
node scripts/healthcheck.js
```

Telegramda `@karvongo_bot` → `/start` ishlashi kerak.

---

## Muhim eslatmalar

- `karvon.env`, `session.txt` **GitHubga push qilinmaydi** (`.gitignore`)
- Bir vaqtda faqat **bitta** bot polling qilishi kerak (lokal + server birga ishlamasin)
- Serverda ishlatganda lokal `start-all.js` ni to'xtating: `node scripts/stop-karvon.js`
- `TELEGRAM_SESSION` muddati tugasa — lokalda qayta login, yangi session ni server env ga yozing
