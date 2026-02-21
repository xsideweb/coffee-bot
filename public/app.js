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
    const startParam = params.get('tgWebAppStartParam') || tg?.initDataUnsafe?.start_param;
    if (startParam) return startParam;
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

  const timeInput = document.getElementById('time-input');
  const timeDisplay = document.getElementById('time-display');
  const btnCreate = document.getElementById('btn-create');

  function setTimeInputMin() {
    const now = new Date();
    const minMins = 5;
    const next = new Date(now.getTime() + minMins * 60 * 1000);
    const h = String(next.getHours()).padStart(2, '0');
    const m = String(next.getMinutes()).padStart(2, '0');
    timeInput.min = h + ':' + m;
  }
  setTimeInputMin();

  function updateTimeDisplay() {
    const v = timeInput.value;
    if (!v) {
      timeDisplay.textContent = 'Выберите время';
      timeDisplay.classList.add('placeholder');
      return;
    }
    const [h, min] = v.split(':');
    timeDisplay.textContent = h + ':' + min;
    timeDisplay.classList.remove('placeholder');
  }
  timeInput.addEventListener('input', updateTimeDisplay);
  timeInput.addEventListener('change', updateTimeDisplay);
  updateTimeDisplay();

  function minutesFromTimeInput() {
    const [h, min] = (timeInput.value || '').split(':').map(Number);
    if (h == null || min == null || isNaN(h) || isNaN(min)) return null;
    const now = new Date();
    let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0);
    if (target <= now) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
    return Math.round((target - now) / 60000);
  }

  btnCreate.onclick = async () => {
    const minutes = minutesFromTimeInput();
    if (minutes == null || minutes < 1) {
      showError('Выберите время встречи');
      return;
    }
    btnCreate.disabled = true;
    try {
      await api.post('/api/collection', {
        chatId: Number(chatId),
        initiatorId: user.id,
        initiatorName: user.name,
        minutes,
      });
      await refresh();
      tg?.HapticFeedback?.impactOccurred?.('light');
    } catch (e) {
      showError(e.message || 'Ошибка создания сбора');
    } finally {
      btnCreate.disabled = false;
    }
  };

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
        function formatRemaining(ms) {
          if (ms <= 0) return '☕ Время!';
          const totalMin = Math.floor(ms / 60000);
          const h = Math.floor(totalMin / 60);
          const m = totalMin % 60;
          if (h >= 1) return h + ' ч ' + m + ' мин';
          if (m >= 1) return m + ' мин';
          const sec = Math.ceil(ms / 1000);
          return sec + ' сек';
        }
        function tick() {
          const left = new Date(data.at) - Date.now();
          countdown.textContent = formatRemaining(left);
          if (left > 0) setTimeout(tick, left > 60000 ? 60000 : 1000);
        }
        tick();
        const cancelBtn = document.getElementById('btn-cancel');
        cancelBtn.style.display = data.initiatorId === user.id ? 'flex' : 'none';
        cancelBtn.onclick = cancelCollection;
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

  async function cancelCollection() {
    const btn = document.getElementById('btn-cancel');
    btn.disabled = true;
    try {
      await api.post('/api/collection/cancel', {
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
