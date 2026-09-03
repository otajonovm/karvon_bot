/**
 * Yangi Telegram session — QR kod orqali.
 * Telefonda: Sozlamalar → Qurilmalar → Kompyuterni ulash
 */
require('../config/env');

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { TelegramClient } = require('telegram');
const { Logger } = require('telegram/extensions');
const { StringSession } = require('telegram/sessions');
const { SESSION_FILE, encodeSessionB64 } = require('../lib/session');

const API_ID = parseInt(process.env.API_ID, 10);
const API_HASH = process.env.API_HASH;
const QR_FILE = path.join(__dirname, '..', 'karvon-qr.png');
const READY_FILE = path.join(__dirname, '..', 'karvon-qr.ready');

if (!API_ID || !API_HASH) {
  console.error('API_ID / API_HASH kerak (karvon.env)');
  process.exit(1);
}

async function main() {
  if (fs.existsSync(SESSION_FILE)) {
    const bak = `${SESSION_FILE}.backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, '')
      .slice(0, 15)}`;
    fs.copyFileSync(SESSION_FILE, bak);
    fs.unlinkSync(SESSION_FILE);
    console.log(`[qr] Eski session saqlandi: ${path.basename(bak)}`);
  }

  try {
    if (fs.existsSync(QR_FILE)) fs.unlinkSync(QR_FILE);
    if (fs.existsSync(READY_FILE)) fs.unlinkSync(READY_FILE);
  } catch {
    /* ignore */
  }

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 10,
    retryDelay: 3000,
    useWSS: process.env.TELEGRAM_USE_WSS === '1',
    baseLogger: new Logger('error'),
  });

  console.log('[qr] Telegramga ulanmoqda...');
  await client.connect();

  console.log('[qr] QR chiqarilmoqda...');
  console.log('[qr] Telegram → Sozlamalar → Qurilmalar → Kompyuterni ulash\n');

  await client.signInUserWithQrCode(
    { apiId: API_ID, apiHash: API_HASH },
    {
      qrCode: async ({ token }) => {
        const url = `tg://login?token=${token.toString('base64url')}`;
        console.clear();
        console.log('\n  Telegram → Sozlamalar → Qurilmalar → Kompyuterni ulash');
        console.log('  QR 30 soniyada yangilanadi — shu terminaldagi kodni skaner qiling\n');
        qrcodeTerminal.generate(url, { small: true });
        await QRCode.toFile(QR_FILE, url, { width: 480, margin: 2 });
        fs.writeFileSync(READY_FILE, String(Date.now()));
        console.log('\n  Skaner qiling. 2FA bo\'lsa shu yerga parol yoziladi.\n');
      },
      password: async () => {
        console.error('[qr] 2FA yoqilgan — shu terminalda parol so\'raladi');
        const input = require('input');
        const p = await input.text('2FA parol: ');
        return p.trim() || undefined;
      },
      onError: (err) => {
        console.error('[qr] Auth xato:', err.message);
        return false;
      },
    }
  );

  const session = client.session.save();
  fs.writeFileSync(SESSION_FILE, session, 'utf8');
  console.log(`[qr] Session saqlandi (${session.length} belgi) → session.txt`);
  console.log(`[qr] Heroku: TELEGRAM_SESSION ni yangilang (b64 ${encodeSessionB64(session).length} belgi)`);

  await client.disconnect();
  try {
    if (fs.existsSync(READY_FILE)) fs.unlinkSync(READY_FILE);
  } catch {
    /* ignore */
  }
  console.log('[qr] Tayyor. Endi shu sessionni Heroku config ga yozish kerak.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[qr] Xato:', err.message);
  process.exit(1);
});
