const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const initData = tg?.initData || '';
let currentUser = null;

/* ==========================================================
   AdsGram SDK — Reward + Interstitial (نفس نمط بوت SLY)
   لا يوجد blockId بعد؛ يبقى null إلى حين إنشاء البلوكات من
   partner.adsgram.ai ووضعها في متغيرات البيئة على السيرفر.
   ========================================================== */
const ADSGRAM_SCRIPT_SRC = 'https://sad.adsgram.ai/js/sad.min.js';

let rewardController = null;       // بلوك Reward — هذا فقط يُحسب للأرباح
let interstitialController = null; // بلوك Interstitial — عرض عادي بدون مكافأة

// قفل عام يمنع عرض إعلانين بنفس الوقت + فاصل 12 ثانية بين إعلانين يدويين
const MIN_GAP_BETWEEN_ADS_MS = 12000;
let globalAdLock = false;
let lastAdEndedAt = 0;
let autoAdsBackoffUntil = 0; // يتوقف الإعلان التلقائي مؤقتًا لو AdsGram اعتبره سبام

function tryAcquireGlobalAdLock(isAuto) {
  if (globalAdLock) return false;
  if (!isAuto && lastAdEndedAt > 0 && Date.now() - lastAdEndedAt < MIN_GAP_BETWEEN_ADS_MS) return false;
  globalAdLock = true;
  return true;
}
function releaseGlobalAdLock(isAuto) {
  globalAdLock = false;
  if (!isAuto) lastAdEndedAt = Date.now();
}

function waitForAdsgramScript(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (window.Adsgram) return resolve(true);

    const existing = document.querySelector(`script[src="${ADSGRAM_SCRIPT_SRC}"]`);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearInterval(pollId);
      clearTimeout(timeoutId);
      resolve(ok);
    };

    const pollId = setInterval(() => { if (window.Adsgram) finish(true); }, 200);
    const timeoutId = setTimeout(() => finish(!!window.Adsgram), timeoutMs);

    if (existing) {
      existing.addEventListener('load', () => finish(true), { once: true });
      existing.addEventListener('error', () => finish(false), { once: true });
    } else {
      const script = document.createElement('script');
      script.src = ADSGRAM_SCRIPT_SRC;
      script.async = true;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    }
  });
}

// يضيف مستمعي التشخيص نفسها المستخدمة في SLY: onBannerNotFound / onError
// (مشاكل عرض عادية، لا تعني خطأ بالتطبيق) و onNonStopShow (AdsGram يعتبر
// الإعلانات المتتالية سبام، فنوقف الإعلان التلقائي دقيقة كاملة).
function attachAdDiagnostics(controller, label) {
  if (!controller?.addEventListener) return;
  controller.addEventListener('onBannerNotFound', () => console.warn(`[AdsGram:${label}] لا يوجد إعلان متاح حاليًا`));
  controller.addEventListener('onError', () => console.warn(`[AdsGram:${label}] خطأ أثناء تشغيل الإعلان`));
  controller.addEventListener('onNonStopShow', () => {
    console.warn(`[AdsGram:${label}] تم رصد إعلانات متتالية بسرعة — إيقاف الإعلان التلقائي مؤقتًا`);
    autoAdsBackoffUntil = Date.now() + 60000;
  });
}

async function initAdsgram(rewardBlockId, interstitialBlockId) {
  const ready = await waitForAdsgramScript();
  if (!ready || !window.Adsgram) {
    console.warn('تعذر تحميل AdsGram SDK');
    return;
  }
  if (rewardBlockId) {
    rewardController = window.Adsgram.init({ blockId: rewardBlockId });
    attachAdDiagnostics(rewardController, 'reward');
  } else {
    console.warn('ADSGRAM_REWARD_BLOCK_ID غير مُعرَّف بعد — لن يعمل زر مشاهدة الإعلان حتى يُضاف من لوحة AdsGram');
  }
  if (interstitialBlockId) {
    interstitialController = window.Adsgram.init({ blockId: interstitialBlockId });
    attachAdDiagnostics(interstitialController, 'interstitial');
    maybeShowInterstitialOnce();
  }
}

// إعلان انتقالي واحد بعد فتح التطبيق (اختياري، بدون مكافأة، بدون
// إجبار المستخدم على أي تفاعل) — تمامًا بروح الإعلان التلقائي في SLY.
let interstitialShownThisSession = false;
function maybeShowInterstitialOnce() {
  if (interstitialShownThisSession) return;
  if (!interstitialController) return;
  if (document.visibilityState !== 'visible') return;
  if (Date.now() < autoAdsBackoffUntil) return;
  if (!tryAcquireGlobalAdLock(true)) return;

  interstitialShownThisSession = true;
  interstitialController
    .show()
    .catch(() => {}) // المستخدم تخطاه أو ما فيه تعبئة — لا مشكلة، لا يوجد أي إلزام
    .finally(() => releaseGlobalAdLock(true));
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

const hasCountry = () => !!(currentUser && currentUser.country);

function showScreen(name) {
  const alwaysOpen = ['country', 'loading', 'error'];
  // A user without a confirmed country can never open any other page.
  if (!alwaysOpen.includes(name) && !hasCountry()) return;

  document.querySelectorAll('#app > div[id^="screen-"]').forEach((s) => s.classList.add('hidden'));
  document.getElementById('screen-' + name).classList.remove('hidden');
  document.getElementById('bottomnav').classList.toggle('hidden', !hasCountry() || alwaysOpen.includes(name));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === name));
  window.scrollTo(0, 0);
  if (name === 'withdraw') loadWithdraw().catch(() => toast(t('toast_load_failed')));
  if (name === 'history') loadHistory().catch(() => toast(t('toast_load_failed')));
  if (name === 'leaderboard') loadLeaderboard().catch(() => toast(t('toast_load_failed')));
}

document.getElementById('bottomnav').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (item) showScreen(item.dataset.screen);
});

// ---------- Country selection ----------
let selectedCountryId = null;

async function initApp() {
  showScreen('loading');
  try {
    const me = await api('/me');
    currentUser = me;
    if (!me.country) {
      await loadCountries();
      showScreen('country');
    } else {
      renderHome(me);
      showScreen('home');
      preloadScreens();
      initAdsgram(me.ads.rewardBlockId, me.ads.interstitialBlockId);
    }
  } catch (err) {
    console.error(err);
    const retry = document.getElementById('btn-retry');
    let text = t('load_error_generic');
    retry.classList.remove('hidden');
    if (err.status === 401) {
      text = t('open_in_telegram');
    } else if (err.status === 403) {
      text = t('account_suspended');
      retry.classList.add('hidden');
    }
    document.getElementById('error-text').textContent = text;
    showScreen('error');
  }
}

async function loadCountries() {
  const countries = await api('/countries');
  const list = document.getElementById('country-list');
  const confirmBtn = document.getElementById('btn-confirm-country');
  list.innerHTML = '';
  selectedCountryId = null;
  confirmBtn.disabled = true;

  if (!countries.length) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = t('no_countries');
    list.appendChild(p);
    return;
  }

  countries.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'country-item';
    div.setAttribute('role', 'button');
    div.tabIndex = 0;
    div.textContent = c.name;
    const pick = () => {
      selectedCountryId = c.id;
      document.querySelectorAll('.country-item').forEach((x) => x.classList.remove('selected'));
      div.classList.add('selected');
      confirmBtn.disabled = false;
    };
    div.onclick = pick;
    div.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    list.appendChild(div);
  });
}

document.getElementById('btn-confirm-country').addEventListener('click', async () => {
  if (!selectedCountryId) return;
  const btn = document.getElementById('btn-confirm-country');
  btn.disabled = true;
  try {
    await api('/select-country', { method: 'POST', body: { countryId: selectedCountryId } });
    await initApp();
  } catch (err) {
    if (err.error === 'country_already_set') return initApp();
    btn.disabled = false;
    toast(t('toast_generic_error'));
  }
});

document.getElementById('btn-retry').addEventListener('click', initApp);

// ---------- Home ----------
function renderHome(me) {
  document.getElementById('country-pill').textContent = me.country ? me.country.name : '—';
  document.getElementById('balance-available').textContent = '$' + Number(me.balanceAvailable).toFixed(2);
  document.getElementById('balance-paid').textContent = '$' + Number(me.balancePaid).toFixed(2);
  document.getElementById('today-impressions').textContent = me.today.impressions;
  document.getElementById('today-earnings').textContent =
    me.today.earnings === 'pending' ? t('pending_label') : '$' + Number(me.today.earnings).toFixed(3);
}

document.getElementById('lang-toggle').addEventListener('click', () => {
  const next = getLang() === 'ar' ? 'en' : 'ar';
  setLang(next, refreshAllViews);
});

// Re-renders every screen from cached data (no refetch) after a language switch.
function refreshAllViews() {
  if (currentUser) renderHome(currentUser);
  renderWithdrawState(currentUser);
  if (withdrawHistoryCache) renderWithdrawHistory(withdrawHistoryCache);
  if (historyCache) renderHistoryList(historyCache);
  if (leaderboardCache) renderLeaderboard(leaderboardCache);
}

document.getElementById('btn-watch-ad').addEventListener('click', async () => {
  const btn = document.getElementById('btn-watch-ad');
  const note = document.getElementById('ad-note');
  note.textContent = '';

  if (!rewardController) {
    note.textContent = t('note_ads_disabled');
    return;
  }
  if (!tryAcquireGlobalAdLock(false)) {
    note.textContent = t('note_please_wait_ad');
    return;
  }

  btn.disabled = true;
  try {
    const { sessionId } = await api('/ads/request', { method: 'POST' });

    rewardController
      .show()
      .then(async () => {
        try {
          const r = await api('/ads/complete', { method: 'POST', body: { sessionId } });
          toast(r.pending ? t('toast_view_recorded_pending') : t('toast_earnings_added'));
          const me = await api('/me');
          currentUser = me;
          renderHome(me);
        } catch (err) {
          toast(t('toast_confirm_failed'));
        }
      })
      .catch(() => {
        note.textContent = t('note_ad_incomplete');
      })
      .finally(() => {
        btn.disabled = false;
        releaseGlobalAdLock(false);
      });
  } catch (err) {
    btn.disabled = false;
    releaseGlobalAdLock(false);
    if (err.status === 429 && err.error === 'too_soon') {
      note.textContent = t('note_wait_seconds', { sec: err.retryAfterSeconds || '' });
    } else if (err.status === 429) {
      note.textContent = t('note_daily_limit');
    } else {
      note.textContent = t('note_ad_start_failed');
    }
  }
});

// ---------- Withdraw + History (preloaded, cached) ----------
function statusLabel(status) {
  return t('status_' + status) || status;
}
let withdrawHistoryCache = null;
let historyCache = null;

function emptyNote(text) {
  const p = document.createElement('p');
  p.className = 'empty-note';
  p.textContent = text;
  return p;
}

function renderWithdrawState(me) {
  if (!me) return;
  const lockedBox = document.getElementById('withdraw-locked');
  const openBox = document.getElementById('withdraw-open');
  if (!me.withdrawalsOpen) {
    lockedBox.classList.remove('hidden');
    openBox.classList.add('hidden');
  } else {
    lockedBox.classList.add('hidden');
    openBox.classList.remove('hidden');
    document.getElementById('withdraw-balance').textContent = '$' + Number(me.balanceAvailable).toFixed(2);
  }
}

function renderWithdrawHistory(history) {
  const wrap = document.getElementById('withdraw-history');
  wrap.innerHTML = '';
  if (!history.length) return wrap.appendChild(emptyNote(t('no_withdraw_history')));
  history.forEach((h) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    const left = document.createElement('span');
    left.textContent = '$' + Number(h.amount).toFixed(2) + ' — ' + h.method;
    const badge = document.createElement('span');
    badge.className = 'badge ' + (h.status === 'paid' ? 'paid' : h.status === 'rejected' ? 'rejected' : 'pending');
    badge.textContent = statusLabel(h.status);
    row.append(left, badge);
    wrap.appendChild(row);
  });
}

function renderHistoryList(rows) {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (!rows.length) return list.appendChild(emptyNote(t('no_history')));
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    const left = document.createElement('span');
    left.textContent = r.month_label + ' — ' + r.impressions + ' ' + t('views_suffix');
    const right = document.createElement('span');
    right.textContent = '$' + Number(r.earnings).toFixed(2);
    row.append(left, right);
    list.appendChild(row);
  });
}

async function refreshWithdraw() {
  const [me, history] = await Promise.all([api('/me'), api('/withdraw/history')]);
  currentUser = me;
  withdrawHistoryCache = history;
  renderWithdrawState(me);
  renderWithdrawHistory(history);
}

async function refreshHistory() {
  historyCache = await api('/history');
  renderHistoryList(historyCache);
}

function loadWithdraw() {
  renderWithdrawState(currentUser);
  if (withdrawHistoryCache) renderWithdrawHistory(withdrawHistoryCache);
  return refreshWithdraw();
}

function loadHistory() {
  if (historyCache) renderHistoryList(historyCache);
  return refreshHistory();
}

function preloadScreens() {
  renderWithdrawState(currentUser);
  api('/withdraw/history')
    .then((h) => {
      withdrawHistoryCache = h;
      renderWithdrawHistory(h);
    })
    .catch(() => {});
  refreshHistory().catch(() => {});
  refreshLeaderboard().catch(() => {});
}

// ---------- Leaderboard (preloaded, cached) ----------
let leaderboardCache = null;

function renderLeaderboard(data) {
  document.getElementById('leaderboard-month').textContent = data.monthLabel || '—';
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = '';

  if (!data.entries || !data.entries.length) {
    const p = document.createElement('p');
    p.className = 'empty-note lb-empty';
    p.textContent = t('leaderboard_empty');
    list.appendChild(p);
    return;
  }

  data.entries.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-row';
    if (e.rank === 1) row.classList.add('top1');
    else if (e.rank === 2) row.classList.add('top2');
    else if (e.rank === 3) row.classList.add('top3');
    if (e.is_you) row.classList.add('you');

    const rank = document.createElement('div');
    rank.className = 'rank';
    rank.textContent = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : e.rank;

    const name = document.createElement('div');
    name.className = 'lb-name';
    name.textContent = e.is_you ? `${e.display_name}${t('you_suffix')}` : e.display_name;

    const count = document.createElement('div');
    count.className = 'lb-count';
    count.textContent = `${e.impressions} 👁`;

    row.append(rank, name, count);
    list.appendChild(row);
  });
}

async function refreshLeaderboard() {
  leaderboardCache = await api('/leaderboard');
  renderLeaderboard(leaderboardCache);
}

function loadLeaderboard() {
  if (leaderboardCache) renderLeaderboard(leaderboardCache);
  return refreshLeaderboard();
}

document.getElementById('btn-submit-withdraw').addEventListener('click', async () => {
  const btn = document.getElementById('btn-submit-withdraw');
  const amount = document.getElementById('wd-amount').value;
  const method = document.getElementById('wd-method').value;
  const accountInfo = document.getElementById('wd-account').value.trim();
  if (!amount || !accountInfo) return toast(t('toast_fill_fields'));

  btn.disabled = true;
  try {
    await api('/withdraw', { method: 'POST', body: { amount, method, accountInfo } });
    toast(t('toast_withdraw_success'));
    document.getElementById('wd-amount').value = '';
    document.getElementById('wd-account').value = '';
    await refreshWithdraw();
    renderHome(currentUser);
  } catch (err) {
    const messages = {
      withdrawals_locked: t('err_withdrawals_locked'),
      amount_below_minimum: t('err_amount_below_minimum'),
      insufficient_balance: t('err_insufficient_balance'),
      missing_payment_details: t('err_missing_payment_details'),
      invalid_method: t('err_invalid_method'),
    };
    toast(messages[err.error] || t('toast_withdraw_failed'));
  } finally {
    btn.disabled = false;
  }
});

initApp();
