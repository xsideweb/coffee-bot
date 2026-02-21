import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getCollection,
  getCollectionForApi,
  setCollection,
  deleteCollection,
  setTimer,
} from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WEBHOOK_PATH = '/telegram-webhook';

function formatAtInTZ(date, timeZone) {
  return new Date(date).toLocaleString('ru-RU', {
    timeZone: timeZone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function createApp(bot, options = {}) {
  const { baseUrl } = options;
  let cachedBotUsername = null;
  const getBotUsername = async () => {
    if (cachedBotUsername) return cachedBotUsername;
    const me = await bot.telegram.getMe();
    cachedBotUsername = me.username;
    return cachedBotUsername;
  };

  const app = express();
  app.use(express.json());

  // Webhook для бота: именно POST и полный путь в req.url, иначе Telegraf не принимает запрос (filter сравнивает req.url с path).
  app.post(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));

  // Статика Mini App
  app.use(express.static(join(__dirname, '..', 'public')));

  // Проверка webhook (откройте в браузере после деплоя): видно, что Telegram знает ваш URL
  app.get('/api/webhook-info', async (_req, res) => {
    try {
      const info = await bot.telegram.getWebhookInfo();
      res.json({ ok: true, url: info.url || null, pending: info.pending_update_count });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message) });
    }
  });

  // API: текущий сбор для чата
  app.get('/api/collection', (req, res) => {
    const chatId = req.query.chatId;
    if (chatId == null) return res.status(400).json({ error: 'chatId required' });
    const data = getCollectionForApi(Number(chatId));
    return res.json(data);
  });

  // API: создать сбор (at — ISO строка времени в часовом поясе создателя, timeZone — IANA, например Europe/Moscow)
  app.post('/api/collection', async (req, res) => {
    const { chatId, initiatorId, initiatorName, at: atIso, timeZone } = req.body;
    if (chatId == null || initiatorId == null || !initiatorName || !atIso) {
      return res.status(400).json({ error: 'chatId, initiatorId, initiatorName, at (ISO) required' });
    }
    const cid = Number(chatId);
    if (getCollection(cid)) {
      return res.status(409).json({ error: 'Сбор уже создан' });
    }
    const at = new Date(atIso);
    if (Number.isNaN(at.getTime())) {
      return res.status(400).json({ error: 'Некорректное время at' });
    }
    const votes = new Map();
    votes.set(Number(initiatorId), { vote: 'yes', name: initiatorName });
    setCollection(cid, {
      initiatorId: Number(initiatorId),
      initiatorName,
      at,
      messageId: null,
      votes,
      confirmed: false,
      timerId: null,
      timeZone: timeZone || undefined,
    });
    const atStr = formatAtInTZ(at, timeZone);
    let text;
    if (baseUrl) {
      const username = await getBotUsername();
      const appLink = `https://t.me/${username}?startapp=${cid}`;
      text = `Срочный сбор в Культ! Ответь в приложении! <a href="${appLink}">${appLink}</a>`;
    } else {
      text = `Срочный сбор в Культ в ${atStr}. Откройте приложение, чтобы ответить.`;
    }
    try {
      await bot.telegram.sendMessage(cid, text, baseUrl ? { parse_mode: 'HTML' } : undefined);
    } catch (e) {
      // группа может не существовать или бот не в ней
    }
    return res.json(getCollectionForApi(cid));
  });

  // API: голос
  app.post('/api/collection/vote', async (req, res) => {
    const { chatId, userId, userName, vote } = req.body;
    if (chatId == null || userId == null || !vote) {
      return res.status(400).json({ error: 'chatId, userId, vote required' });
    }
    if (vote !== 'yes' && vote !== 'no') {
      return res.status(400).json({ error: 'vote must be yes or no' });
    }
    const cid = Number(chatId);
    const c = getCollection(cid);
    if (!c) return res.status(404).json({ error: 'Сбор не найден' });
    if (c.confirmed) return res.status(409).json({ error: 'Голосование закрыто' });
    const name = userName || `User ${userId}`;
    c.votes.set(Number(userId), { vote, name });
    try {
      const msg = vote === 'yes'
        ? `Ничего себе ${name} идет!`
        : `${name} не хочет идти в Культ 😢`;
      await bot.telegram.sendMessage(cid, msg);
    } catch (e) {}
    return res.json(getCollectionForApi(cid));
  });

  // API: подтвердить сбор (только инициатор)
  app.post('/api/collection/confirm', async (req, res) => {
    const { chatId, userId } = req.body;
    if (chatId == null || userId == null) {
      return res.status(400).json({ error: 'chatId, userId required' });
    }
    const cid = Number(chatId);
    const uid = Number(userId);
    const c = getCollection(cid);
    if (!c) return res.status(404).json({ error: 'Сбор не найден' });
    if (c.initiatorId !== uid) {
      return res.status(403).json({ error: 'Подтвердить может только инициатор' });
    }
    c.confirmed = true;
    const atStr = formatAtInTZ(c.at, c.timeZone);
    const participants = [...c.votes.entries()].filter(([, v]) => v.vote === 'yes');
    const names = participants.map(([, v]) => v.name).join(', ');
    try {
      await bot.telegram.sendMessage(
        cid,
        `🔒 Срочный сбор подтверждён! Встречаемся в ${atStr}. Участники: ${names || '—'}`
      );
    } catch (e) {}
    const delay = Math.max(0, c.at - Date.now());
    const timerId = setTimeout(async () => {
      try {
        await bot.telegram.sendMessage(cid, '☕ Время! Идём за кофе.');
      } catch (e) {}
      deleteCollection(cid);
    }, delay);
    setTimer(cid, timerId);
    return res.json(getCollectionForApi(cid));
  });

  // API: отменить сбор (только инициатор, пока таймер идёт)
  app.post('/api/collection/cancel', async (req, res) => {
    const { chatId, userId } = req.body;
    if (chatId == null || userId == null) {
      return res.status(400).json({ error: 'chatId, userId required' });
    }
    const cid = Number(chatId);
    const uid = Number(userId);
    const c = getCollection(cid);
    if (!c) return res.status(404).json({ error: 'Сбор не найден' });
    if (c.initiatorId !== uid) {
      return res.status(403).json({ error: 'Отменить сбор может только инициатор' });
    }
    deleteCollection(cid);
    try {
      await bot.telegram.sendMessage(cid, 'Сбор оказался не срочный. Отмена.');
    } catch (e) {}
    return res.json({ ok: true });
  });

  // SPA: все пути отдаём index.html
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

export function getWebhookPath() {
  return WEBHOOK_PATH;
}
