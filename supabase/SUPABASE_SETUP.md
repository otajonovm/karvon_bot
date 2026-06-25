# Karvon — Yangi Supabase integratsiyasi

Eski loyiha yopilgan bo'lsa, quyidagi qadamlarni ketma-ket bajaring.

## 1. Yangi loyiha ochish

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Nom: `karvon` (yoki istalgan)
3. Database parolini saqlab qo'ying
4. Region: yaqin server (masalan Frankfurt)

## 2. Jadvallarni yaratish

1. Supabase → **SQL Editor** → **New query**
2. `supabase/setup_fresh.sql` faylini ochib, **butun matnni** nusxalang
3. **Run** bosing — xato bo'lmasa tayyor

## 3. API kalitlarini olish

1. **Project Settings** → **API**
2. Nusxalang:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_KEY`

## 4. `karvon.env` yangilash

```env
SUPABASE_URL=https://SIZNING-LOYIHA-ID.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Muhim:** URL va KEY **bir xil loyihadan** bo'lishi kerak. KEY ichidagi `ref` maydoni URL dagi loyiha ID bilan mos keladi.

## 5. Tekshirish (lokal)

```powershell
node scripts/test-supabase.js
node scripts/verify-migrations.js
```

Ikkalasi ham ✅ bo'lsa — bot ishga tushiring:

```powershell
node scripts/stop-karvon.js
node server.js
```

Telegramda `/start` bosing.

## 6. DigitalOcean (production)

DO → App → **Environment Variables**:

| Kalit | Qiymat |
|-------|--------|
| `SUPABASE_URL` | Yangi Project URL |
| `SUPABASE_KEY` | Yangi anon key |

Save → Redeploy.

## Muammolar

| Xato | Yechim |
|------|--------|
| `relation does not exist` | `setup_fresh.sql` ni qayta Run qiling |
| `fetch failed` / `ENOTFOUND` | Internet, VPN, yoki URL noto'g'ri |
| `row-level security` | `setup_fresh.sql` dagi RLS qismini Run qiling |
| Bot `/start` xato | `node scripts/test-supabase.js` ishlating |
