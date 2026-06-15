module.exports = {
  apps: [
    {
      name: 'karvon-bot',
      script: 'index.js',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'karvon-scraper',
      script: 'scraper.js',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        TELEGRAM_USE_WSS: '1',
      },
    },
  ],
};
