import 'dotenv/config';
import { setupBot } from './bot.js';
import { createApp } from './server.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Задайте BOT_TOKEN в .env (скопируйте из .env.example)');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
const baseUrl = process.env.BASE_URL || ''; // Публичный URL Mini App (HTTPS), например https://your-app.up.railway.app

const bot = setupBot(token, { baseUrl });
const app = createApp(bot);

const server = app.listen(port, () => {
  console.log('☕ Сервер запущен на порту', port);
  if (baseUrl) {
    console.log('   Mini App URL:', baseUrl);
  } else {
    console.log('   BASE_URL не задан — бот работает без Mini App (только кнопки в чате).');
  }
});

bot.launch().then(() => {
  console.log('☕ Бот запущен. Добавьте его в группу и отправьте /start');
});

function shutdown() {
  server.close();
  bot.stop('SIGTERM');
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
