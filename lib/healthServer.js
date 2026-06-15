const http = require('http');

/**
 * DigitalOcean App Platform health check uchun minimal HTTP server.
 * PORT env o'rnatilgan bo'lsa ishlaydi (DO avtomatik beradi).
 */
function startHealthServer() {
  const port = parseInt(process.env.PORT, 10);
  if (!port) return null;

  const server = http.createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (path === '/health' || path === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'karvon' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[karvon] Health check server :${port} (/health)`);
  });

  return server;
}

module.exports = { startHealthServer };
