(() => {
  'use strict';

  const DAY = 86_400_000;
  const MINUTE = 60_000;
  const DAILY_NEW_LIMIT = 20;
  const STORAGE_KEY = 'japanese-ch1-srs-v1';

  const cards = String(window.CARD_ROWS || '')
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((row, index) => {
      const [cat, page, jp, romaji, en, audio] = row.split('|');
      return {
        cat,
        page: Number(page),
        jp,
        romaji,
        en,
        audio,
        id: index,
        key: `${cat}¦${jp}¦${en}`,
      };
    });

  const $ = (id) => document.getElementById(id);
  const category = $('category');
  const mode = $('mode');
  const search = $('search');
  const cardEl = $('card');
  const jpEl = $('jp');
  const romajiEl = $('romaji');
  const englishEl = $('english');
  const metaEl = $('meta');
  const sideEl = $('side');
  const positionEl = $('position');
  const statsEl = $('stats');
  const progressEl = $('progress');
  const scheduleEl = $('schedule');
  const statusEl = $('status');
  const prevBtn = $('prev');
  const nextBtn = $('next');
  const flipBtn = $('flip');
  const listenBtn = $('listen');
  const jishoLink = $('jisho');
  const shuffleBtn = $('shuffle');
  const resetBtn = $('reset');
  const clearProgressBtn = $('clearProgress');
  const dailyNoticeEl = $('dailyNotice');
  const dailyNoticeTextEl = $('dailyNoticeText');
  const gradeButtons = [...document.querySelectorAll('[data-grade]')];

  let srs = loadProgress();
  let order = [];
  let cursor = 0;
  let flipped = false;
  let manuallyShuffled = false;

  function loadProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(srs));
    } catch {
      announce('Progress could not be saved in this browser.');
    }
  }

  function todayKey(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function introducedTodayCount() {
    return Object.values(srs).filter((state) => state && state.introducedDate === todayKey()).length;
  }

  function dailyGoalComplete() {
    return introducedTodayCount() >= DAILY_NEW_LIMIT;
  }

  function currentCard() {
    return order.length ? cards[order[cursor]] : null;
  }

  function announce(text) {
    statusEl.textContent = text;
  }

  function getState(card) {
    return srs[card.key] || null;
  }

  function newState() {
    return {
      reps: 0,
      interval: 0,
      ease: 2.5,
      due: 0,
      lastReviewed: 0,
      introducedDate: todayKey(),
      lapses: 0,
    };
  }

  function previewSchedule(card, grade, now = Date.now()) {
    const previous = getState(card);
    const state = previous ? { ...previous } : newState();
    state.introducedDate ||= todayKey();
    state.lastReviewed = now;

    if (grade === 'again') {
      state.reps = 0;
      state.interval = 0;
      state.ease = Math.max(1.3, state.ease - 0.2);
      state.lapses = (state.lapses || 0) + 1;
      state.due = now + 10 * MINUTE;
      return state;
    }

    if (grade === 'hard') {
      state.interval = state.reps === 0 ? 1 : Math.max(1, Math.round(state.interval * 1.2));
      state.reps += 1;
      state.ease = Math.max(1.3, state.ease - 0.15);
    } else if (grade === 'good') {
      if (state.reps === 0) state.interval = 2;
      else if (state.reps === 1) state.interval = 5;
      else state.interval = Math.max(1, Math.round(state.interval * state.ease));
      state.reps += 1;
    } else if (grade === 'easy') {
      state.interval = state.reps === 0 ? 4 : Math.max(4, Math.round(state.interval * state.ease * 1.3));
      state.reps += 1;
      state.ease = Math.min(3.2, state.ease + 0.15);
    }

    state.due = now + state.interval * DAY;
    return state;
  }

  function scheduleCard(card, grade) {
    const next = previewSchedule(card, grade);
    srs[card.key] = next;
    saveProgress();
    return next;
  }

  function formatDuration(ms) {
    if (ms <= 0) return 'now';
    const minutes = Math.round(ms / MINUTE);
    if (minutes < 60) return `${Math.max(1, minutes)} min`;
    const hours = Math.round(ms / (60 * MINUTE));
    if (hours < 24) return `${hours} hr`;
    const days = Math.round(ms / DAY);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months} mo`;
    const years = Math.round(months / 12);
    return `${years} yr`;
  }

  function formatDue(timestamp) {
    const diff = timestamp - Date.now();
    if (diff <= 0) return 'Due now';
    return `Due in ${formatDuration(diff)}`;
  }

  function baseFilteredCards() {
    const selectedCategory = category.value;
    const query = search.value.trim().toLocaleLowerCase();
    return cards.filter((card) => {
      const categoryMatch = selectedCategory === 'All' || card.cat === selectedCategory;
      const searchMatch = !query || [card.jp, card.romaji, card.en].some((value) => value.toLocaleLowerCase().includes(query));
      return categoryMatch && searchMatch;
    });
  }

  function buildQueue() {
    const now = Date.now();
    const base = baseFilteredCards();
    const selectedMode = mode.value;
    let queue;

    if (selectedMode === 'due') {
      queue = base.filter((card) => {
        const state = getState(card);
        return state && state.due <= now;
      });
      queue.sort((a, b) => getState(a).due - getState(b).due);
    } else if (selectedMode === 'new') {
      queue = base.filter((card) => !getState(card));
    } else if (selectedMode === 'review') {
      queue = base.filter((card) => Boolean(getState(card)));
      queue.sort((a, b) => getState(a).due - getState(b).due);
    } else if (selectedMode === 'today') {
      const dueCards = base
        .filter((card) => {
          const state = getState(card);
          return state && state.due <= now;
        })
        .sort((a, b) => getState(a).due - getState(b).due);

      const introducedToday = introducedTodayCount();
      const remainingNewSlots = Math.max(0, DAILY_NEW_LIMIT - introducedToday);
      const allNewCards = base.filter((card) => !getState(card));

      // The daily limit is a target, not a hard stop. Once the target is reached,
      // unlock every remaining new card in the current view for optional extra study.
      const newCards = introducedToday >= DAILY_NEW_LIMIT
        ? allNewCards
        : allNewCards.slice(0, remainingNewSlots);

      queue = [...dueCards, ...newCards];
    } else {
      queue = base;
    }

    if (manuallyShuffled) shuffleArray(queue);
    order = queue.map((card) => card.id);
    if (cursor >= order.length) cursor = Math.max(0, order.length - 1);
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function getDeckStats() {
    const now = Date.now();
    let due = 0;
    let fresh = 0;
    let learning = 0;
    let mature = 0;

    cards.forEach((card) => {
      const state = getState(card);
      if (!state) {
        fresh += 1;
        return;
      }
      if (state.due <= now) due += 1;
      if (state.interval >= 21) mature += 1;
      else learning += 1;
    });

    return { due, fresh, learning, mature, introduced: cards.length - fresh };
  }

  function updateStats() {
    const deckStats = getDeckStats();
    statsEl.textContent = `Due ${deckStats.due} • New ${deckStats.fresh} • Learning ${deckStats.learning} • Mature ${deckStats.mature}`;
    progressEl.style.width = `${Math.round((deckStats.introduced / cards.length) * 100)}%`;
  }

  function updateDailyNotice() {
    if (!dailyNoticeEl || !dailyNoticeTextEl) return;

    const complete = dailyGoalComplete();
    const visible = mode.value === 'today' && complete;
    dailyNoticeEl.hidden = !visible;
    if (!visible) return;

    const remainingNew = baseFilteredCards().filter((card) => !getState(card)).length;
    dailyNoticeTextEl.textContent = remainingNew
      ? `You finished today’s ${DAILY_NEW_LIMIT}-new-card target. Extra study is unlocked — ${remainingNew} new card${remainingNew === 1 ? '' : 's'} remain in this view, and you can keep going.`
      : `You finished today’s ${DAILY_NEW_LIMIT}-new-card target. There are no new cards left in this view; switch the Study queue to All cards if you want another pass.`;
  }

  function updateGradeLabels(card) {
    const now = Date.now();
    gradeButtons.forEach((button) => {
      const grade = button.dataset.grade;
      const preview = previewSchedule(card, grade, now);
      const intervalText = grade === 'again' ? '10 min' : formatDuration(preview.due - now);
      const small = button.querySelector('small');
      if (small) small.textContent = intervalText;
      button.disabled = !flipped;
    });
  }

  function scheduleText(card) {
    const state = getState(card);
    if (!state) return 'New card • not yet scheduled';
    const interval = state.interval ? ` • interval ${formatDuration(state.interval * DAY)}` : '';
    const reviews = state.reps + (state.lapses || 0);
    return `${formatDue(state.due)}${interval} • ${reviews} review${reviews === 1 ? '' : 's'}`;
  }

  function nextDueText() {
    const future = cards
      .map((card) => getState(card))
      .filter((state) => state && state.due > Date.now())
      .sort((a, b) => a.due - b.due)[0];
    return future ? `Next scheduled card is ${formatDue(future.due).toLocaleLowerCase()}.` : 'No reviews are scheduled yet.';
  }

  function render() {
    const card = currentCard();
    const empty = !card;
    updateDailyNotice();

    [prevBtn, nextBtn, flipBtn].forEach((button) => { button.disabled = empty; });
    listenBtn.disabled = empty || !('speechSynthesis' in window);
    jishoLink.style.display = empty ? 'none' : 'inline-flex';
    cardEl.disabled = empty;

    if (empty) {
      positionEl.textContent = 'No cards in this queue';
      metaEl.textContent = mode.value === 'today'
        ? (dailyGoalComplete() ? 'Daily goal complete • extra study finished in this view' : 'Today’s study session is complete')
        : 'Try another filter';
      sideEl.textContent = '';
      jpEl.hidden = false;
      romajiEl.hidden = false;
      englishEl.hidden = true;
      jpEl.textContent = mode.value === 'today' ? 'おつかれさまでした' : 'No matching cards';
      romajiEl.textContent = mode.value === 'today'
        ? (dailyGoalComplete() ? 'Daily goal complete. No new or due cards remain in this view.' : 'otsukaresama deshita — good work')
        : 'Change the category, study queue, or search.';
      scheduleEl.textContent = nextDueText();
      gradeButtons.forEach((button) => { button.disabled = true; });
      updateStats();
      return;
    }

    positionEl.textContent = `Card ${cursor + 1} of ${order.length} • ${cards.length} total`;
    const extraStudy = mode.value === 'today' && dailyGoalComplete();
    metaEl.textContent = `${card.cat} • source page ${card.page}${extraStudy ? ' • extra study' : ''}`;
    sideEl.textContent = flipped ? 'English' : 'Japanese → English';
    jpEl.hidden = flipped;
    romajiEl.hidden = flipped;
    englishEl.hidden = !flipped;
    jpEl.textContent = card.jp;
    romajiEl.textContent = card.romaji;
    englishEl.textContent = card.en;
    scheduleEl.textContent = scheduleText(card);
    jishoLink.href = `https://jisho.org/search/${encodeURIComponent(card.audio || card.jp)}`;
    updateGradeLabels(card);
    updateStats();
  }

  function rebuild({ resetCursor = true } = {}) {
    if (resetCursor) cursor = 0;
    flipped = false;
    manuallyShuffled = false;
    buildQueue();
    render();
  }

  function go(step) {
    if (!order.length) return;
    cursor = (cursor + step + order.length) % order.length;
    flipped = false;
    render();
    announce('');
  }

  function flipCard() {
    if (!currentCard()) return;
    flipped = !flipped;
    render();
    announce('');
  }

  function pronunciationText(card) {
    if (!/[／/・]/.test(card.jp)) return card.audio || card.jp;
    const special = {
      'これ（それ／あれ）は 何ですか？': 'これは何ですか。それは何ですか。あれは何ですか。',
      '私は 15／19／22 歳です': '私は十五歳です。私は十九歳です。私は二十二歳です。',
    };
    if (special[card.jp]) return special[card.jp];
    return card.jp
      .replace(/（(?:casual|more polite)）|\((?:casual|more polite)\)/gi, '')
      .replace(/_{2,}|〜+/g, '')
      .replace(/[／/・]/g, '。')
      .replace(/[()（）]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function speak() {
    const card = currentCard();
    if (!card) return;
    if (!('speechSynthesis' in window)) {
      announce('Audio is not supported in this browser.');
      return;
    }

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(pronunciationText(card));
    utterance.lang = 'ja-JP';
    utterance.rate = 0.78;
    const voice = speechSynthesis.getVoices().find((item) => (item.lang || '').toLowerCase().startsWith('ja'));
    if (voice) utterance.voice = voice;
    utterance.onstart = () => announce('Playing Japanese pronunciation.');
    utterance.onend = () => announce('');
    utterance.onerror = () => announce('This browser could not play the pronunciation.');
    speechSynthesis.speak(utterance);
  }

  function gradeCurrent(grade) {
    const card = currentCard();
    if (!card || !flipped) return;

    const oldCursor = cursor;
    const wasNew = !getState(card);
    const beforeIntroducedToday = introducedTodayCount();
    const result = scheduleCard(card, grade);
    const afterIntroducedToday = introducedTodayCount();
    const justFinishedDailyGoal = mode.value === 'today'
      && wasNew
      && beforeIntroducedToday < DAILY_NEW_LIMIT
      && afterIntroducedToday >= DAILY_NEW_LIMIT;

    const message = justFinishedDailyGoal
      ? `Daily goal complete! You finished today’s ${DAILY_NEW_LIMIT}-new-card target. Extra study is unlocked — keep going as long as you want.`
      : `${grade[0].toUpperCase() + grade.slice(1)} — next review ${formatDue(result.due).toLocaleLowerCase()}.`;

    flipped = false;
    manuallyShuffled = false;
    buildQueue();

    if (mode.value === 'all' || mode.value === 'review') {
      cursor = order.length ? Math.min(oldCursor + 1, order.length - 1) : 0;
    } else {
      cursor = order.length ? Math.min(oldCursor, order.length - 1) : 0;
    }
    render();
    announce(message);
  }

  category.addEventListener('change', () => rebuild());
  mode.addEventListener('change', () => rebuild());
  search.addEventListener('input', () => rebuild());
  cardEl.addEventListener('click', flipCard);
  flipBtn.addEventListener('click', flipCard);
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  listenBtn.addEventListener('click', speak);

  shuffleBtn.addEventListener('click', () => {
    manuallyShuffled = true;
    const queue = order.map((id) => cards[id]);
    shuffleArray(queue);
    order = queue.map((card) => card.id);
    cursor = 0;
    flipped = false;
    render();
    announce('Current queue shuffled.');
  });

  resetBtn.addEventListener('click', () => {
    category.value = 'All';
    mode.value = 'today';
    search.value = '';
    cursor = 0;
    flipped = false;
    manuallyShuffled = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    buildQueue();
    render();
    announce('Study view reset. Your review schedule was kept.');
  });

  clearProgressBtn.addEventListener('click', () => {
    const confirmed = window.confirm('Clear all spaced-repetition history for these flashcards? This cannot be undone.');
    if (!confirmed) return;
    srs = {};
    localStorage.removeItem(STORAGE_KEY);
    rebuild();
    announce('All study history was cleared.');
  });

  gradeButtons.forEach((button) => {
    button.addEventListener('click', () => gradeCurrent(button.dataset.grade));
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName || '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    if (event.key === ' ') { event.preventDefault(); flipCard(); }
    if (event.key.toLowerCase() === 'p') { event.preventDefault(); speak(); }
    if (flipped && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      gradeCurrent({ '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }[event.key]);
    }
  });

  buildQueue();
  render();
})();
