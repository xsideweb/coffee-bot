import { Telegraf, Markup } from 'telegraf';
import { getCollection, setCollection, deleteCollection, setTimer } from './state.js';

const MINUTES_OPTIONS = [15, 30, 45, 60];

/** В группах web_app-кнопка в inline-клавиатуре даёт BUTTON_TYPE_INVALID. Отправляем ссылку в тексте — по нажатию откроется Main Mini App с start_param. */
function getMiniAppMessage(chatId, botUsername) {
  const link = `https://t.me/${botUsername}?startapp=${chatId}`;
  return {
    text: `☕ Нажмите ссылку, чтобы открыть приложение «Сбор на кофе»:\n\n☕ <a href="${link}">Сбор на кофе</a>`,
    extra: { parse_mode: 'HTML' },
  };
}

function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatMinutes(m) {
  if (m === 60) return '1 час';
  return `${m} мин`;
}

/** Клавиатура "Сбор на кофе" в группе */
export function keyboardStartCollection() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('☕ Сбор на кофе', 'coffee_start')],
  ]);
}

/** Клавиатура выбора времени (в минутах от сейчас) */
export function keyboardTimeOptions(chatId) {
  const row1 = MINUTES_OPTIONS.slice(0, 2).map((m) =>
    Markup.button.callback(formatMinutes(m), `coffee_time_${chatId}_${m}`)
  );
  const row2 = MINUTES_OPTIONS.slice(2, 4).map((m) =>
    Markup.button.callback(formatMinutes(m), `coffee_time_${chatId}_${m}`)
  );
  return Markup.inlineKeyboard([row1, row2]);
}

/** Клавиатура голосования + подтверждение для инициатора */
function keyboardVote(chatId, initiatorId) {
  const buttons = [
    [
      Markup.button.callback('✅ Участвую', `coffee_vote_${chatId}_yes`),
      Markup.button.callback('❌ Не смогу', `coffee_vote_${chatId}_no`),
    ],
  ];
  buttons.push([Markup.button.callback('🔒 Подтвердить сбор', `coffee_confirm_${chatId}`)]);
  return Markup.inlineKeyboard(buttons);
}

/** Текст сообщения о сборе до подтверждения */
function voteMessageText(collection) {
  const at = formatTime(collection.at);
  const votesYes = [...collection.votes.entries()].filter(([, v]) => v.vote === 'yes');
  const votesNo = [...collection.votes.entries()].filter(([, v]) => v.vote === 'no');
  const namesYes = votesYes.map(([, v]) => v.name).join(', ') || '—';
  const namesNo = votesNo.map(([, v]) => v.name).join(', ') || '—';
  const lines = [
    `☕ Сбор на кофе в ${at}`,
    `Инициатор: ${collection.initiatorName}`,
    '',
    `✅ Участвуют (${votesYes.length}): ${namesYes}`,
    `❌ Не смогут (${votesNo.length}): ${namesNo}`,
    '',
    'Нажмите кнопку ниже. Инициатор нажимает «Подтвердить сбор», когда все проголосовали.',
  ];
  return lines.join('\n');
}

/** Обновить сообщение голосования в чате */
async function updateVoteMessage(ctx, chatId, collection) {
  try {
    await ctx.telegram.editMessageText(
      chatId,
      collection.messageId,
      null,
      voteMessageText(collection),
      keyboardVote(chatId, collection.initiatorId)
    );
  } catch (e) {
    // сообщение могло не измениться или быть устаревшим
  }
}

/** Запуск таймера: в момент времени сбора отправить сообщение в чат */
function scheduleTimer(ctx, chatId, collection) {
  const delay = Math.max(0, collection.at - Date.now());
  const timerId = setTimeout(async () => {
    await ctx.telegram.sendMessage(chatId, '☕ Время! Идём за кофе.');
    deleteCollection(chatId);
  }, delay);
  setTimer(chatId, timerId);
}

export function setupBot(token, options = {}) {
  const { baseUrl } = options;
  const bot = new Telegraf(token);
  let cachedBotUsername = null;

  const sendAppButton = async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      if (chatType === 'private') {
        return await ctx.reply('Добавьте бота в группу и там напишите /start — появится ссылка для запуска приложения.');
      }
      if (baseUrl) {
        if (!cachedBotUsername) {
          const me = await ctx.telegram.getMe();
          cachedBotUsername = me.username;
        }
        const { text, extra } = getMiniAppMessage(chatId, cachedBotUsername);
        await ctx.reply(text, extra);
      } else {
        await ctx.reply('Mini App: задайте BASE_URL на сервере и перезапустите. Пока можно использовать кнопки ниже.', keyboardStartCollection());
      }
    } catch (err) {
      console.error('Ошибка при отправке сообщения в чат:', err.message || err);
    }
  };

  bot.command('start', sendAppButton);
  bot.command('coffee', sendAppButton);
  bot.command('app', sendAppButton);
  bot.catch((err, ctx) => {
    console.error('Ошибка бота:', err.message || err, 'updateType:', ctx?.updateType);
  });

  // Показать кнопку "Сбор на кофе" при первом добавлении в группу можно через greeting
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return next();
    // Не реагируем на каждое сообщение — только на callback
    return next();
  });

  // Нажатие "Сбор на кофе"
  bot.action(/^coffee_start$/, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat?.id;
    if (!chatId) return ctx.answerCbQuery('Используйте в группе.');
    if (getCollection(chatId)) {
      return ctx.answerCbQuery('Уже есть активный сбор. Дождитесь его завершения.');
    }
    await ctx.answerCbQuery();
    await ctx.reply('Выберите, через сколько минут сбор:', keyboardTimeOptions(chatId));
  });

  // Выбор времени
  bot.action(/^coffee_time_(-?\d+)_(\d+)$/, async (ctx) => {
    const [, rawChatId, minutes] = ctx.match;
    const chatId = Number(rawChatId);
    const mins = Number(minutes);
    const from = ctx.callbackQuery.from;
    const name = from.username ? `@${from.username}` : from.first_name;

    if (getCollection(chatId)) {
      return ctx.answerCbQuery('Сбор уже создан.');
    }

    const at = new Date(Date.now() + mins * 60 * 1000);
    const message = await ctx.telegram.sendMessage(
      chatId,
      voteMessageText({
        initiatorName: name,
        at,
        votes: new Map(),
      }),
      keyboardVote(chatId, from.id)
    );

    setCollection(chatId, {
      initiatorId: from.id,
      initiatorName: name,
      at,
      messageId: message.message_id,
      votes: new Map(),
      confirmed: false,
      timerId: null,
    });

    await ctx.answerCbQuery(`Сбор через ${formatMinutes(mins)}`);
    try {
      await ctx.deleteMessage();
    } catch (_) {}
  });

  // Голос: Участвую / Не смогу
  bot.action(/^coffee_vote_(-?\d+)_(yes|no)$/, async (ctx) => {
    const [, rawChatId, vote] = ctx.match;
    const chatId = Number(rawChatId);
    const userId = ctx.callbackQuery.from.id;
    const collection = getCollection(chatId);
    if (!collection) {
      return ctx.answerCbQuery('Сбор уже завершён.');
    }
    if (collection.confirmed) {
      return ctx.answerCbQuery('Голосование закрыто.');
    }
    const name = ctx.callbackQuery.from.username
      ? `@${ctx.callbackQuery.from.username}`
      : ctx.callbackQuery.from.first_name;
    collection.votes.set(userId, { vote, name });
    await updateVoteMessage(ctx, chatId, collection);
    await ctx.answerCbQuery(vote === 'yes' ? 'Отлично!' : 'Понятно');
  });

  // Подтверждение сбора (только инициатор)
  bot.action(/^coffee_confirm_(-?\d+)$/, async (ctx) => {
    const [, rawChatId] = ctx.match;
    const chatId = Number(rawChatId);
    const userId = ctx.callbackQuery.from.id;
    const collection = getCollection(chatId);
    if (!collection) {
      return ctx.answerCbQuery('Сбор уже завершён.');
    }
    if (collection.initiatorId !== userId) {
      return ctx.answerCbQuery('Подтвердить сбор может только инициатор.');
    }
    collection.confirmed = true;
    const atStr = formatTime(collection.at);
    const participants = [...collection.votes.entries()].filter(([, v]) => v.vote === 'yes');
    const names = participants.map(([, v]) => v.name).join(', ');
    const text = `🔒 Сбор подтверждён! Встречаемся в ${atStr}. Участники: ${names || '—'}`;
    try {
      await ctx.telegram.editMessageText(chatId, collection.messageId, null, text, []);
    } catch (_) {}
    scheduleTimer(ctx, chatId, collection);
    await ctx.answerCbQuery('Сбор подтверждён!');
  });

  return bot;
}
