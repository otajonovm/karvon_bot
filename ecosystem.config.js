module.exports = {
  apps: [
    {
      name: 'karvon-bot',
      script: 'index.js',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
    },
    {
      name: 'karvon-scraper',
      script: 'scraper.js',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
    },
  ],
};
