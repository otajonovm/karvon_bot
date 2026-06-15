#!/bin/bash
# DigitalOcean Droplet (Ubuntu 22.04) — birinchi marta sozlash
# Ishlatish: bash deploy/setup-droplet.sh

set -e

APP_DIR="/opt/karvon"
REPO="https://github.com/otajonovm/karvon_bot.git"

echo "==> Node.js 20 o'rnatilmoqda..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

echo "==> PM2 o'rnatilmoqda..."
sudo npm install -g pm2

echo "==> Loyiha klonlanmoqda..."
sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
else
  cd "$APP_DIR" && git pull
fi

cd "$APP_DIR"
npm ci --omit=dev

if [ ! -f karvon.env ]; then
  cp .env.example karvon.env
  echo ""
  echo "!!! karvon.env yaratildi — $APP_DIR/karvon.env ni to'ldiring !!!"
  echo "    nano $APP_DIR/karvon.env"
  exit 1
fi

echo "==> PM2 ishga tushirilmoqda..."
pm2 start ecosystem.config.js
pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME"

echo ""
echo "Tayyor! Holat: pm2 status"
echo "Loglar:   pm2 logs"
