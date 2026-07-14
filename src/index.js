const dns = require('dns');
const http = require('http');
const { Telegraf } = require('telegraf');
const packageJson = require('../package.json');

// Some hosts resolve api.telegram.org to IPv6 first while outbound IPv6 is unavailable.
// Prefer IPv4 so Telegram API requests use the working HTTPS/443 route.
dns.setDefaultResultOrder('ipv4first');

const env = require('./config/env');
const connectDb = require('./config/db');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerUserHandlers } = require('./handlers/user');
const seedLessons = require('./services/seedLessons');

const bot = new Telegraf(env.botToken, {
  handlerTimeout: 90_000
});

registerAdminHandlers(bot);
registerUserHandlers(bot);

bot.catch((error, ctx) => {
  const updateId = ctx?.update?.update_id ?? 'unknown';
  console.error(`Bot error on update ${updateId}:`, error);

  ctx?.reply('یک خطای موقت رخ داد. دوباره تلاش کنید.').catch(() => {});
});

/**
 * cPanel/LiteSpeed/Passenger receives public traffic on ports 80 and 443,
 * then forwards it to the internal port exposed in process.env.PORT.
 * Do not bind this shared-hosting app directly to ports 80 or 443.
 */
const internalPort = Number(process.env.PORT || process.env.HTTP_PORT || 3000);

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (path === '/' || path === '/bot' || path === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    res.end(JSON.stringify({
      ok: true,
      service: 'SiniorAiBot',
      version: packageJson.version,
      status: 'running'
    }));
    return;
  }

  res.writeHead(404, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

let shuttingDown = false;

async function bootstrap() {
  try {
    // Start the health server first so cPanel can see the application immediately.
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(internalPort, '0.0.0.0', () => {
        server.removeListener('error', reject);
        console.log(`✅ HTTP health server is running on internal port ${internalPort}`);
        resolve();
      });
    });

    await connectDb();
    console.log('✅ MongoDB connected');

    await seedLessons(env.ownerId);

    await bot.launch({
      dropPendingUpdates: false
    });

    console.log('🤖 SiniorAiBot is running');
  } catch (error) {
    console.error('❌ Startup error:', error);

    if (server.listening) {
      server.close(() => process.exit(1));
    } else {
      process.exit(1);
    }
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received. Stopping application...`);

  try {
    bot.stop(signal);
  } catch (error) {
    console.error('Bot shutdown error:', error);
  }

  if (!server.listening) {
    process.exit(0);
    return;
  }

  server.close(() => process.exit(0));

  // Prevent a stuck process during hosting restarts.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

bootstrap();
