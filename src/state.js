/**
 * Состояние активных сборов на кофе (в памяти).
 * key: chatId (группа)
 * value: { initiatorId, initiatorName, at, messageId, votes, confirmed, timerId }
 */
const collections = new Map();

export function getCollection(chatId) {
  return collections.get(chatId);
}

export function setCollection(chatId, data) {
  collections.set(chatId, data);
}

export function deleteCollection(chatId) {
  const c = collections.get(chatId);
  if (c?.timerId) clearTimeout(c.timerId);
  collections.delete(chatId);
}

export function setTimer(chatId, timerId) {
  const c = collections.get(chatId);
  if (c) c.timerId = timerId;
}

/** Сериализация для API (votes → массив) */
export function getCollectionForApi(chatId) {
  const c = collections.get(chatId);
  if (!c) return null;
  const votes = [...c.votes.entries()].map(([userId, v]) => ({
    userId,
    name: v.name,
    vote: v.vote,
  }));
  return {
    initiatorId: c.initiatorId,
    initiatorName: c.initiatorName,
    at: c.at.toISOString(),
    votes,
    confirmed: c.confirmed,
  };
}
