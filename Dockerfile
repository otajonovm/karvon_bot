FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Bot + scraper birga (PM2 siz)
CMD ["node", "scripts/start-all.js"]
