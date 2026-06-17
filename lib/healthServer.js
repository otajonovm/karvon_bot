const http = require('http');
const { collectHealth } = require('./healthCheck');

let activeServer = null;

/**
 * DigitalOcean App Platform health check.
 * /health — chuqur tekshiruv (Supabase + userbot)
 * /health/live — faqat process jon (DO liveness)
 */
function startHealthServer() {
  const port = parseInt(process.env.PORT, 10);
  if (!port) return null;
  if (activeServer) return activeServer;

  const server = http.createServer(async (req, res) => {
    const path = req.url?.split('?')[0];

    if (path === '/health/live' || path === '/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'karvon' }));
      return;
    }

    if (path === '/health' || path === '/') {
      try {
        const body = await collectHealth();
        const code = body.ok ? 200 : 503;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unhealthy', error: err.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[karvon] Health :${port} band — asosiy process ishlatmoqda (OK)`);
      return;
    }
    console.error('[karvon] Health server xato:', err.message);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[karvon] Health check server :${port} (/health, /health/live)`);
  });

  activeServer = server;
  return server;
}

module.exports = { startHealthServer };
