(function () {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const root = document.getElementById('root');
  const loading = document.getElementById('loading');
  const screens = {
    start: document.getElementById('screen-start'),
    vote: document.getElementById('screen-vote'),
    confirmed: document.getElementById('screen-confirmed'),
    error: document.getElementById('screen-error'),
  };

  function getChatId() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('chatId');
    if (fromUrl) return fromUrl;
    const unsafe = tg?.initDataUnsafe;
    if (unsafe?.chat?.id) return String(unsafe.chat.id);
    return null;
  }

  function getUser() {
    const u = tg?.initDataUnsafe?.user;
    if (u) return { id: u.id, name: u.username ? '@' + u.username : u.first_name };
    return { id: 0, name: 'Вы' };
  }

  function show(id) {
    loading.style.display = 'none';
    Object.values(screens).forEach((el) => el?.classList.remove('active'));
    const s = document.getElementById('screen-' + id);
    if (s) s.classList.add('active');
  }

  function showError(msg) {
    const el = document.getElementById('error-text');
    if (el) el.textContent = msg;
    show('error');
  }

  const api = {
    base: '',
    async get(path) {
      const r = await fetch(this.base + path);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    async post(path, body) {
      const r = await fetch(this.base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  };

  const chatId = getChatId();
  const user = getUser();

  if (!chatId) {
    showError('Откройте приложение из группы (нажмите кнопку «Сбор на кофе» в чате).');
    throw new Error('no chatId');
  }

  const MINUTES = [15, 30, 45, 60];
  const timeGrid = document.getElementById('time-grid');
  MINUTES.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'time-btn';
    btn.textContent = m === 60 ? '1 час' : m + ' мин';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api.post('/api/collection', {
          chatId: Number(chatId),
          initiatorId: user.id,
          initiatorName: user.name,
          minutes: m,
        });
        await refresh();
      } catch (e) {
        showError(e.message || 'Ошибка создания сбора');
      } finally {
        btn.disabled = false;
      }
    };
    timeGrid.appendChild(btn);
  });

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderVote(data) {
    document.getElementById('vote-meta').textContent =
      'В ' + formatTime(data.at) + ' · Инициатор: ' + data.initiatorName;
    const yesList = document.getElementById('vote-yes-list');
    const noList = document.getElementById('vote-no-list');
    const yesVotes = data.votes.filter((v) => v.vote === 'yes');
    const noVotes = data.votes.filter((v) => v.vote === 'no');
    yesList.innerHTML = yesVotes.length
      ? yesVotes.map((v) => '<li><span class="badge badge-yes">✓</span>' + escapeHtml(v.name) + '</li>').join('')
      : '<li class="empty">Пока никого</li>';
    noList.innerHTML = noVotes.length
      ? noVotes.map((v) => '<li><span class="badge badge-no">✕</span>' + escapeHtml(v.name) + '</li>').join('')
      : '<li class="empty">—</li>';
    const confirmBtn = document.getElementById('btn-confirm');
    confirmBtn.style.display = data.initiatorId === user.id ? 'flex' : 'none';
    confirmBtn.onclick = confirmCollection;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  async function refresh() {
    try {
      const data = await api.get('/api/collection?chatId=' + encodeURIComponent(chatId));
      if (!data) {
        show('start');
        return;
      }
      if (data.confirmed) {
        document.getElementById('confirmed-meta').textContent =
          'Встречаемся в ' + formatTime(data.at);
        const countdown = document.getElementById('countdown');
        function tick() {
          const left = new Date(data.at) - Date.now();
          if (left <= 0) {
            countdown.textContent = '☕ Время!';
            return;
          }
          const min = Math.floor(left / 60000);
          const sec = Math.floor((left % 60000) / 1000);
          countdown.textContent = min + ' мин ' + sec + ' сек';
          setTimeout(tick, 1000);
        }
        tick();
        show('confirmed');
        return;
      }
      renderVote(data);
      show('vote');
    } catch (e) {
      showError(e.message || 'Ошибка загрузки');
    }
  }

  document.getElementById('btn-yes').onclick = async () => {
    try {
      await api.post('/api/collection/vote', {
        chatId: Number(chatId),
        userId: user.id,
        userName: user.name,
        vote: 'yes',
      });
      await refresh();
      tg?.HapticFeedback?.impactOccurred?.('light');
    } catch (e) {
      showError(e.message || 'Ошибка');
    }
  };

  document.getElementById('btn-no').onclick = async () => {
    try {
      await api.post('/api/collection/vote', {
        chatId: Number(chatId),
        userId: user.id,
        userName: user.name,
        vote: 'no',
      });
      await refresh();
      tg?.HapticFeedback?.impactOccurred?.('light');
    } catch (e) {
      showError(e.message || 'Ошибка');
    }
  };

  async function confirmCollection() {
    const btn = document.getElementById('btn-confirm');
    btn.disabled = true;
    try {
      await api.post('/api/collection/confirm', {
        chatId: Number(chatId),
        userId: user.id,
      });
      await refresh();
      tg?.HapticFeedback?.impactOccurred?.('medium');
    } catch (e) {
      showError(e.message || 'Ошибка');
    } finally {
      btn.disabled = false;
    }
  }

  refresh();
})();
