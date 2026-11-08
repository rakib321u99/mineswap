// MineSwap Mini App — frontend logic (original code).
// Talks only to /api/miniapp. No secrets here: auth is Telegram initData.
'use strict';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

let S = null;          // last /state payload
let captchaToken = null;
let chartData = [];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(action, params = {}) {
  const res = await fetch('/api/miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg ? tg.initData : '', action, ...params }),
  });
  return res.json();
}

// ---------- tabs ----------
document.querySelectorAll('nav button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    $('tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'market') loadMarket();
    if (b.dataset.tab === 'profile') loadProfile();
    if (b.dataset.tab === 'swap') renderSwapGates();
  });
});

function badge(el, text, kind) {
  el.textContent = text;
  el.className = 'badge' + (kind ? ' ' + kind : '');
}

// ---------- state ----------
async function loadState() {
  try {
    const r = await api('state');
    if (r.error === 'need_start') {
      toast('Open the bot and press /start first.');
      return;
    }
    if (!r.ok) { toast(r.error || 'Could not load. Try again.'); return; }
    S = r;
    renderAll();
  } catch (e) { toast('Network error. Pull to retry.'); }
}

function renderAll() {
  if (!S) return;
  $('hdr-balance').textContent = fmt(S.user.balanceMine);
  $('mine-balance').textContent = fmt(S.user.balanceMine);
  $('mine-rate').textContent = `${S.mining.ratePerHour} MINE / hour`;
  $('mine-accrued').textContent = `${fmt(S.mining.accrued)} MINE`;
  $('mine-claimable').textContent = `${fmt(S.mining.claimable)} MINE`;
  $('mine-day-bar').style.width = Math.min(100, (S.mining.claimedToday / S.mining.dailyCap) * 100) + '%';
  $('mine-day-text').textContent = `${fmt(S.mining.claimedToday)} / ${fmt(S.mining.dailyCap)} MINE claimed today`;
  const priceTon = parseFloat(S.market.priceTon);
  $('mine-usd').textContent = `≈ ${(S.user.balanceMine * priceTon).toFixed(4)} TON at current price`;
  $('btn-start-mining').disabled = S.mining.active;
  $('btn-start-mining').textContent = S.mining.active ? '⛏️ Mining…' : '▶ Start Mining';
  $('btn-claim').disabled = !S.mining.active || S.mining.claimable <= 0;
  badge($('mine-like-status'), S.mining.likedToday ? 'Done ✓' : 'Not done', S.mining.likedToday ? '' : 'warn');
  badge($('mine-like-badge'), S.mining.likedToday ? '👍 Liked today' : '👍 Like needed', S.mining.likedToday ? '' : 'warn');

  $('mkt-price').textContent = S.market.priceTon;
  const chg = $('mkt-change');
  chg.textContent = (S.market.change24hPct >= 0 ? '+' : '') + S.market.change24hPct.toFixed(2) + '%';
  chg.className = 'badge' + (S.market.change24hPct >= 0 ? '' : ' bad');
  $('mkt-high').textContent = (S.market.high24Nano / 1e9).toFixed(6) + ' TON';
  $('mkt-low').textContent = (S.market.low24Nano / 1e9).toFixed(6) + ' TON';
  $('mkt-vol').textContent = fmt(S.market.vol24Mine) + ' MINE';
  $('mkt-value').textContent = (S.user.balanceMine * priceTon).toFixed(4) + ' TON';

  $('swap-min').textContent = fmt(S.swap.minMine) + ' MINE';
  $('swap-balance').textContent = fmt(S.user.balanceMine) + ' MINE';
  $('swap-price').textContent = S.market.priceTon + ' TON / MINE';

  badge($('task-join-badge'), S.channel.joined ? 'Joined ✓' : 'Not joined', S.channel.joined ? '' : 'warn');
  badge($('task-like-badge'), S.tasks.likedToday ? 'Done ✓' : 'Not done', S.tasks.likedToday ? '' : 'warn');
  $('ad-reward').textContent = `+${S.ads.rewardMine} MINE / ad`;
  $('ad-count').textContent = `${S.tasks.adViewsToday} / ${S.tasks.adDailyCap}`;
  $('btn-watch-ad').disabled = S.tasks.adViewsToday >= S.tasks.adDailyCap;

  $('prof-tgid').textContent = S.user.tgId;
  $('prof-name').textContent = S.user.firstName || S.user.username || '—';
  $('prof-balance').textContent = fmt(S.user.balanceMine) + ' MINE';
  badge($('prof-safety'), S.user.safetyPassed ? 'Passed ✓' : 'Pending', S.user.safetyPassed ? '' : 'warn');

  renderSwapGates();
  injectAds();
  if (!S.user.safetyPassed) $('modal-safety').classList.add('open');
}

// ---------- market chart ----------
function drawChart() {
  const c = $('chart');
  if (!c || !chartData.length) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const prices = chartData.map((p) => p.priceNano);
  let min = Math.min(...prices), max = Math.max(...prices);
  if (max === min) { max += 1; min -= 1; }
  ctx.strokeStyle = '#1e2c4d';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (H / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  const up = prices[prices.length - 1] >= prices[0];
  ctx.strokeStyle = up ? '#4ade80' : '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  prices.forEach((p, i) => {
    const x = (i / (prices.length - 1)) * (W - 8) + 4;
    const y = H - 8 - ((p - min) / (max - min)) * (H - 16);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

async function loadMarket() {
  try {
    const r = await api('market');
    if (!r.ok) return;
    chartData = r.history || [];
    if (chartData.length) {
      S.market.priceNano = r.priceNano;
      S.market.priceTon = r.priceTon;
      S.market.high24Nano = r.high24Nano;
      S.market.low24Nano = r.low24Nano;
      S.market.vol24Mine = r.vol24Mine;
      renderAll();
    }
    drawChart();
  } catch (e) { /* keep old data */ }
}

// ---------- mining ----------
$('btn-start-mining').addEventListener('click', async () => {
  const r = await api('start_mining');
  if (r.ok) { toast('⛏️ Mining started!'); loadState(); }
  else toast(r.error === 'safety_required' ? 'Complete the safety check first.' : (r.error || 'Failed.'));
});

$('btn-claim').addEventListener('click', async () => {
  const r = await api('claim');
  if (r.ok) { toast(`💰 Claimed ${fmt(r.claimed)} MINE!`); loadState(); }
  else if (r.error === 'like_required') toast('👍 Like today\'s channel post first (Tasks tab).');
  else if (r.error === 'nothing_to_claim') toast('Nothing to claim yet — mining accrues over time.');
  else toast(r.error || 'Claim failed.');
});

// ---------- swap ----------
function renderSwapGates() {
  if (!S) return;
  const g = $('swap-gates');
  const rows = [
    [`Balance ≥ ${fmt(S.swap.minMine)} MINE`, S.user.balanceMine >= S.swap.minMine],
    ['Joined the channel', S.channel.joined],
    ["Liked today's post", S.tasks.likedToday],
    ['TON wallet address entered', $('swap-wallet').value.trim().length > 10],
  ];
  g.innerHTML = rows.map(([t, ok]) => `<div class="row"><span>${ok ? '✅' : '❌'} ${t}</span></div>`).join('') +
    (S.swap.pendingCount ? `<p class="muted mt">You have ${S.swap.pendingCount} pending swap(s) — the admin will process them.</p>` : '');
}
$('swap-wallet').addEventListener('input', renderSwapGates);

$('btn-quote').addEventListener('click', async () => {
  const amount = parseInt($('swap-amount').value, 10);
  if (!amount) { toast('Enter an amount first.'); return; }
  const r = await api('quote', { amount });
  if (r.ok) $('swap-quote').textContent = `${r.ton} TON (at ${r.priceTon} TON/MINE)`;
  else toast(r.error === 'below_minimum' ? `Minimum swap is ${fmt(S.swap.minMine)} MINE.` : (r.error || 'Quote failed.'));
});

$('btn-swap').addEventListener('click', async () => {
  const amount = parseInt($('swap-amount').value, 10);
  const wallet = $('swap-wallet').value.trim();
  if (!amount || !wallet) { toast('Enter amount and wallet address.'); return; }
  if (!confirm(`Swap ${fmt(amount)} MINE for TON at the current price?`)) return;
  const r = await api('swap', { amount, wallet });
  if (r.ok) {
    toast(`🔄 Swap #${r.withdrawalId} created — ${r.ton} TON pending admin approval.`);
    $('swap-amount').value = '';
    loadState(); loadProfile();
  } else if (r.error === 'channel_required') toast('📣 Join the channel first (Tasks tab).');
  else if (r.error === 'like_required') toast('👍 Like today\'s post first (Tasks tab).');
  else if (r.error === 'invalid_wallet') toast('That TON wallet address looks invalid.');
  else if (r.error === 'below_minimum') toast(`Minimum swap is ${fmt(S.swap.minMine)} MINE.`);
  else if (r.error === 'insufficient_balance') toast('Not enough MINE balance.');
  else toast(r.error || 'Swap failed.');
});

// ---------- tasks ----------
$('btn-open-post').addEventListener('click', () => {
  if (S && S.tasks.todayPostUrl) {
    if (tg) tg.openTelegramLink(S.tasks.todayPostUrl);
    else window.open(S.tasks.todayPostUrl, '_blank');
  } else toast('No post published today yet — check back later.');
});

$('btn-refresh-channel').addEventListener('click', async () => {
  const r = await api('refresh_channel');
  if (r.ok) { toast(r.joined ? '✅ Channel joined!' : '❌ Not joined yet.'); loadState(); }
  else toast('Check failed. Try again.');
});

// ---------- captcha + ads ----------
function openCaptcha(onSolved) {
  $('modal-captcha').classList.add('open');
  $('captcha-answer').value = '';
  api('captcha_new').then((r) => {
    if (!r.ok) { toast('Captcha failed to load.'); return; }
    $('captcha-question').textContent = r.question;
    $('btn-captcha').onclick = async () => {
      const v = await api('captcha_verify', { captchaId: r.captchaId, answer: $('captcha-answer').value });
      if (v.ok) {
        $('modal-captcha').classList.remove('open');
        onSolved(v.token);
      } else {
        toast(v.error === 'wrong' ? 'Wrong answer — try again.' : (v.error === 'expired' ? 'Expired — get a new one.' : 'Too many tries — get a new one.'));
        if (v.error !== 'wrong') $('modal-captcha').classList.remove('open');
      }
    };
  });
}
$('btn-captcha-close').addEventListener('click', () => $('modal-captcha').classList.remove('open'));

$('btn-watch-ad').addEventListener('click', () => {
  if (!S) return;
  openCaptcha(async (token) => {
    captchaToken = token;
    const ads = S.ads;
    // Real provider SDKs when configured, otherwise a 5-second placeholder.
    if (ads.adsgram.configured && window.Adsgram) {
      try {
        const AdController = window.Adsgram.init({ blockId: ads.adsgram.blockId });
        await AdController.show();
        await creditAd('adsgram');
        return;
      } catch (e) { /* fall through to placeholder */ }
    }
    if (ads.gigapub.configured && window.GigaPub) {
      try {
        await window.GigaPub.showRewarded();
        await creditAd('gigapub');
        return;
      } catch (e) { /* fall through */ }
    }
    toast('📺 Ad playing… (5s)');
    setTimeout(() => creditAd('placeholder'), 5000);
  });
});

async function creditAd(provider) {
  const r = await api('ad_view', { provider, captchaToken });
  if (r.ok) { toast(`📺 +${r.rewardMine} MINE!`); loadState(); }
  else if (r.error === 'daily_cap') toast('Daily ad limit reached.');
  else toast(r.error || 'Ad reward failed.');
}

// ---------- safety ----------
$('btn-safety').addEventListener('click', async () => {
  const code = $('safety-code').value.trim();
  if (code.length !== 3) { toast('Enter the 3-digit code.'); return; }
  const r = await api('safety_verify', { code });
  if (r.ok) {
    $('modal-safety').classList.remove('open');
    toast(`🔐 Safety check passed! +${r.rewardMine} MINE`);
    loadState();
  } else toast('Wrong code — check the bot chat and try again.');
});
$('btn-safety-close').addEventListener('click', () => $('modal-safety').classList.remove('open'));

// ---------- profile ----------
async function loadProfile() {
  try {
    const r = await api('profile');
    if (!r.ok) return;
    $('prof-ledger').innerHTML = r.ledger.length
      ? r.ledger.map((x) => `<div class="item"><div><div class="t">${x.source}</div><div class="s">${x.date}</div></div><b class="${x.amount >= 0 ? 'green' : 'red'}">${x.amount >= 0 ? '+' : ''}${fmt(x.amount)}</b></div>`).join('')
      : 'No activity yet.';
    $('prof-swaps').innerHTML = r.withdrawals.length
      ? r.withdrawals.map((w) => `<div class="item"><div><div class="t">#${w.id} — ${fmt(w.mineAmount)} MINE → ${w.ton} TON</div><div class="s">${w.status}${w.note ? ' — ' + w.note : ''}${w.proof ? ' — proof: ' + w.proof : ''}</div></div><span class="badge ${w.status === 'approved' ? '' : w.status === 'rejected' ? 'bad' : 'warn'}">${w.status}</span></div>`).join('')
      : 'No swaps yet.';
  } catch (e) { /* ignore */ }
}

// ---------- ads (banner slots) ----------
let adsInjected = false;
function injectAds() {
  if (!S || adsInjected) return;
  adsInjected = true;
  const ads = S.ads;
  if (ads.monetag.configured) {
    const s = document.createElement('script');
    s.src = ads.monetag.sdkSrc;
    s.async = true;
    document.head.appendChild(s);
    // The zone renders into the slot divs once the SDK loads.
    document.querySelectorAll('.ad-slot').forEach((d) => { d.dataset.monetagZone = ads.monetag.id; });
  }
  if (ads.adsterra.configured) {
    // Adsterra banner/native: atOptions + invoke script per placement.
    window.atOptions = { key: ads.adsterra.id, format: 'iframe', height: 90, width: 728, params: {} };
    const s = document.createElement('script');
    s.src = `https://${ads.adsterra.invokeDomain}/${ads.adsterra.id}/invoke.js`;
    s.async = true;
    document.getElementById('ad-banner-mine').appendChild(s);
  }
  // Adsgram / Giga.pub SDKs are loaded lazily on Watch Ad click.
  if (ads.adsgram.configured) {
    const s = document.createElement('script');
    s.src = 'https://sad.adsgram.ai/js/sad.min.js';
    s.async = true;
    document.head.appendChild(s);
  }
}

// ---------- boot ----------
$('btn-refresh-market').addEventListener('click', loadMarket);
loadState();
setInterval(() => { if (S) loadState(); }, 60000); // refresh state every minute
