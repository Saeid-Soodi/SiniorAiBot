const { Telegraf } = require('telegraf');
const env = require('./config/env');
const connectDb = require('./config/db');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerUserHandlers } = require('./handlers/user');
const seedLessons = require('./services/seedLessons');

async function bootstrap() {
  await connectDb();
  await seedLessons(env.ownerId);
  const bot = new Telegraf(env.botToken);

  registerAdminHandlers(bot);
  registerUserHandlers(bot);

  bot.catch((error, ctx) => {
    console.error(`Bot error on update ${ctx.update.update_id}:`, error);
    ctx.reply('یک خطای موقت رخ داد. دوباره تلاش کنید.').catch(() => {});
  });

  await bot.launch();
  console.log('🤖 SiniorAiBot is running');

  const shutdown = signal => {
    console.log(`${signal} received. Stopping bot...`);
    bot.stop(signal);
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch(error => {
  console.error('Startup error:', error);
  process.exit(1);
});
