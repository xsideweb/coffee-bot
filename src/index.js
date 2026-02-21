import 'dotenv/config';
import { setupBot } from './bot.js';
import { createApp, getWebhookPath } from './server.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан. Локально: создайте .env из .env.example. На Railway: Variables → Add Variable → BOT_TOKEN = токен от @BotFather');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, ''); // без завершающего слеша

const bot = setupBot(token, { baseUrl });
const app = createApp(bot, { baseUrl });

const server = app.listen(port, async () => {
  console.log('☕ COFFEE_BOT v2 — Сервер на порту', port);
  if (baseUrl) {
    console.log('   Mini App URL:', baseUrl);
    const webhookUrl = `${baseUrl}${getWebhookPath()}`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log('   Бот в режиме WEBHOOK (без 409):', webhookUrl);
  } else {
    console.log('   BASE_URL не задан — бот в режиме polling (только один экземпляр).');
    await bot.launch();
  }
  console.log('☕ Добавьте бота в группу и отправьте /start');
});

function shutdown() {
  server.close();
  bot.stop('SIGTERM');
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
