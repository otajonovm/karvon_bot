# Karvon — Railway deploy

Bitta Web Service: `server.js` (bot + scraper parallel).

## Kerakli Variables

| Key | Majburiy | Izoh |
|-----|----------|------|
| `BOT_TOKEN` | ha | @BotFather |
| `API_ID` | ha | my.telegram.org |
| `API_HASH` | ha | my.telegram.org |
| `SUPABASE_URL` | ha | Supabase Project URL |
| `SUPABASE_KEY` | ha | anon yoki service_role |
| `CARGO_GROUPS` | ha | guruh ID lari, vergul bilan |
| `DEEPSEEK_API_KEY` yoki `GEMINI_API_KEY` | ha | AI parse |
| `TELEGRAM_SESSION` yoki `TELEGRAM_SESSION_B64` | ha | scraper session |
| `TELEGRAM_USE_WSS` | tavsiya | `1` |
| `ADMIN_IDS` | ixtiyoriy | admin Telegram ID |
| `PORT` | avto | Railway o‘zi beradi |

## CLI bilan (token orqali)

```bash
export RAILWAY_TOKEN=...
railway link   # yoki: railway init
railway up
railway variables set BOT_TOKEN=... API_ID=... # va h.k.
```

## Dashboard bilan

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Repo: `karvon_bot` (yoki shu repo)
3. Builder: Dockerfile (`railway.toml` allaqachon sozlangan)
4. Variables → yuqoridagi kalitlarni qo‘shing
5. Deploy → `/health/live` 200 bo‘lishi kerak

## Tekshiruv

```bash
railway logs
curl https://YOUR-APP.up.railway.app/health/live
```
