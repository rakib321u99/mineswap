// MineSwap Mini App backend — Vercel serverless function.
// POST { initData, action, ...params } -> JSON.
// Every action authenticates via Telegram initData (HMAC, see lib/auth.js).
// No action trusts the client for money: balances, caps, gates and prices
// are all computed server-side. Rates/limits come from runtime settings
// (DB settings table over env defaults, see lib/runtime.js).
'use strict';

const crypto = require('node:crypto');
const { config } = require('../lib/config');
const { getRuntime } = require('../lib/runtime');
const { validateInitData } = require('../lib/auth');
const { getOne, run, withTx } = require('../lib/db');
const { dhakaDate, accruedMine, claimableMine } = require('../lib/mining');
const { isValidTonAddress } = require('../lib/ton');
const { isChannelJoined, canClaim, canSwap, validateSwapAmount, tonOutNano } = require('../lib/gates');
const { formatPrice, nanoToTon } = require('../lib/price');
const { loadMarket, applySwapPressure, getPriceHistory } = require('../lib/marketStore');
const { credit } = require('../lib/ledger');
const { makeCaptcha, checkCaptcha } = require('../lib/captcha');
const users = require('../lib/users');
const tg = require('../lib/telegram');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined) {
      if (typeof req.body === 'string') {
        try { resolve(JSON.parse(req.body)); } catch (_) { resolve({}); }
      } else resolve(req.body || {});
      return;
    }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); }
    });
  });
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// --- captcha token: HMAC-signed, single-purpose, 5-minute validity ---
function issueToken(userId, purpose) {
  const exp = Date.now() + 5 * 60 * 1000;
  const payload = `${userId}:${purpose}:${exp}`;
  const sig = crypto.createHmac('sha256', config.botToken || 'mineswap-dev').update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyToken(token, userId, purpose) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [uid, purp, exp, sig] = raw.split(':');
    if (Number(uid) !== Number(userId) || purp !== purpose) return false;
    if (Date.now() > Number(exp)) return false;
    const payload = `${uid}:${purp}:${exp}`;
    const want = crypto.createHmac('sha256', config.botToken || 'mineswap-dev').update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(want, 'hex'));
  } catch (_) { return false; }
}

// Fresh channel check (Telegram API), cached on the user row.
async function refreshChannelStatus(user, rt) {
  const chatId = rt.channelId || `@${rt.channelUsername}`;
  const status = await tg.getChatMemberStatus(chatId, user.tg_id);
  await run('UPDATE users SET channel_status = ?, channel_checked_at = NOW() WHERE id = ?',
    [status, user.id]);
  return status;
}

function adConfig(rt) {
  return {
    monetag: { configured: !!(rt.monetagSdkSrc && rt.monetagId), id: rt.monetagId, sdkSrc: rt.monetagSdkSrc },
    adsterra: { configured: !!rt.adsterraId, id: rt.adsterraId, invokeDomain: rt.adsterraInvokeDomain },
    adsgram: { configured: !!rt.adsgramBlockId, blockId: rt.adsgramBlockId },
    gigapub: { configured: !!rt.gigapubId, projectId: rt.gigapubId },
    rewardMine: rt.adRewardMine,
    dailyCap: rt.adDailyCap,
  };
}

async function handleState(user, rt) {
  const nowMs = Date.now();
  const today = dhakaDate(nowMs);
  const market = await loadMarket(nowMs);
  const likedToday = await users.hasLikedToday(user.id, today);
  const history = await getPriceHistory(96);
  const refNano = history.length ? Number(history[history.length - 1].price_nano) : market.priceNano;
  const change24 = refNano ? ((market.priceNano - refNano) / refNano) * 100 : 0;

  let accrued = 0; let claimable = 0; let claimedToday = 0;
  if (user.mining_active) {
    const since = user.last_claim_at ? new Date(user.last_claim_at).getTime()
      : new Date(user.mining_started_at).getTime();
    accrued = accruedMine(since, nowMs, rt.miningRatePerHour);
    claimedToday = user.claim_date === today ? Number(user.claimed_today) : 0;
    claimable = claimableMine(accrued, claimedToday, rt.dailyCapMine);
  }

  const adViews = await getOne(
    'SELECT COUNT(*) AS c FROM ad_views WHERE user_id = ? AND view_date = ?',
    [user.id, today]
  );
  const pending = await getOne(
    "SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ? AND status = 'pending'",
    [user.id]
  );

  return {
    ok: true,
    user: {
      tgId: user.tg_id, username: user.username, firstName: user.first_name,
      balanceMine: Number(user.balance_mine), safetyPassed: !!user.safety_passed,
      banned: !!user.banned,
    },
    mining: {
      active: !!user.mining_active, ratePerHour: rt.miningRatePerHour,
      accrued, claimable, claimedToday, dailyCap: rt.dailyCapMine, likedToday,
    },
    market: {
      priceNano: market.priceNano, priceTon: formatPrice(market.priceNano),
      change24hPct: Math.round(change24 * 100) / 100,
      high24Nano: market.high24Nano, low24Nano: market.low24Nano,
      vol24Mine: market.vol24Mine,
    },
    channel: {
      username: rt.channelUsername, status: user.channel_status || '',
      joined: isChannelJoined(user.channel_status || ''),
      checkedAt: user.channel_checked_at,
    },
    tasks: { likedToday, todayPostUrl: rt.todayPostUrl, adViewsToday: Number(adViews?.c || 0), adDailyCap: rt.adDailyCap },
    swap: { minMine: rt.swapMinMine, pendingCount: Number(pending?.c || 0) },
    ads: adConfig(rt),
  };
}

async function handleStartMining(user) {
  if (user.banned) return { ok: false, error: 'banned' };
  if (!user.safety_passed) return { ok: false, error: 'safety_required' };
  if (user.mining_active) return { ok: true, already: true };
  const now = new Date();
  await run(
    'UPDATE users SET mining_active = 1, mining_started_at = ?, last_claim_at = ? WHERE id = ?',
    [now, now, user.id]
  );
  return { ok: true, startedAt: now.toISOString() };
}

async function handleClaim(user, rt) {
  if (user.banned) return { ok: false, error: 'banned' };
  if (!user.safety_passed) return { ok: false, error: 'safety_required' };
  const nowMs = Date.now();
  const today = dhakaDate(nowMs);
  const likedToday = await users.hasLikedToday(user.id, today);
  const gate = canClaim({ miningActive: !!user.mining_active, likedToday, banned: !!user.banned });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const since = user.last_claim_at ? new Date(user.last_claim_at).getTime()
    : new Date(user.mining_started_at).getTime();
  const accrued = accruedMine(since, nowMs, rt.miningRatePerHour);
  const claimedToday = user.claim_date === today ? Number(user.claimed_today) : 0;
  const amount = claimableMine(accrued, claimedToday, rt.dailyCapMine);
  if (amount <= 0) return { ok: false, error: 'nothing_to_claim', accrued };

  await withTx(async (conn) => {
    await credit(conn, user.id, 'mining_claim', amount, `claim:${today}`);
    await conn.execute(
      `UPDATE users SET last_claim_at = FROM_UNIXTIME(? / 1000),
         claimed_today = CASE WHEN claim_date = ? THEN claimed_today + ? ELSE ? END,
         claim_date = ? WHERE id = ?`,
      [nowMs, today, amount, amount, today, user.id]
    );
  });
  const updated = await users.getUserByTgId(user.tg_id);
  return { ok: true, claimed: amount, balanceMine: Number(updated.balance_mine) };
}

async function handleQuote(user, params, rt) {
  const amount = parseInt(params.amount, 10);
  const v = validateSwapAmount(amount, Number(user.balance_mine), rt.swapMinMine);
  if (!v.ok) return { ok: false, error: v.reason };
  const market = await loadMarket(Date.now());
  const tonNano = tonOutNano(amount, market.priceNano);
  return {
    ok: true, amountMine: amount, priceNano: market.priceNano,
    priceTon: formatPrice(market.priceNano), tonNano, ton: nanoToTon(tonNano),
  };
}

async function handleSwap(user, params, rt) {
  if (user.banned) return { ok: false, error: 'banned' };
  if (!user.safety_passed) return { ok: false, error: 'safety_required' };
  const amount = parseInt(params.amount, 10);
  const wallet = String(params.wallet || '').trim();
  const walletValid = isValidTonAddress(wallet);
  const v = validateSwapAmount(amount, Number(user.balance_mine), rt.swapMinMine);
  if (!v.ok) return { ok: false, error: v.reason };
  if (!walletValid) return { ok: false, error: 'invalid_wallet' };

  // Fresh channel check at swap time — the gate that matters.
  const channelStatus = await refreshChannelStatus(user, rt);
  const today = dhakaDate(Date.now());
  const likedToday = await users.hasLikedToday(user.id, today);
  const gate = canSwap({
    balanceMine: Number(user.balance_mine), swapMinMine: rt.swapMinMine,
    channelStatus, likedToday, walletValid, banned: !!user.banned,
  });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const market = await loadMarket(Date.now());
  const tonNano = tonOutNano(amount, market.priceNano);

  const withdrawalId = await withTx(async (conn) => {
    await credit(conn, user.id, 'swap_lock', -amount, `swap:${amount}`);
    const [res] = await conn.execute(
      `INSERT INTO withdrawals (user_id, mine_amount, ton_nano, price_nano, wallet, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [user.id, amount, tonNano, market.priceNano, wallet]
    );
    return res.insertId;
  });
  // Sell pressure moves the price down after a confirmed swap.
  await applySwapPressure(amount, Date.now());
  // Notify the owner (fire and forget — never blocks the user response).
  tg.sendMessage(config.ownerTgId,
    `🆕 New swap request #${withdrawalId}\nUser: ${user.tg_id} (@${user.username || '-'})\n` +
    `${amount} MINE → ${nanoToTon(tonNano)} TON (Gram)\nWallet: <code>${wallet}</code>\nApprove it in the admin panel.`
  ).catch(() => {});
  return { ok: true, withdrawalId, amountMine: amount, tonNano, ton: nanoToTon(tonNano), priceTon: formatPrice(market.priceNano) };
}

async function handleCaptchaNew(user) {
  const c = makeCaptcha(Date.now());
  const res = await run(
    'INSERT INTO captchas (user_id, question, answer_hash, expires_at) VALUES (?, ?, ?, FROM_UNIXTIME(? / 1000))',
    [user.id, c.question, c.answerHash, c.expiresAtMs]
  );
  return { ok: true, captchaId: res.insertId, question: c.question };
}

async function handleCaptchaVerify(user, params) {
  const row = await getOne('SELECT * FROM captchas WHERE id = ? AND user_id = ?', [params.captchaId, user.id]);
  if (!row) return { ok: false, error: 'not_found' };
  const challenge = {
    answerHash: row.answer_hash,
    expiresAtMs: new Date(row.expires_at).getTime(),
    attempts: Number(row.attempts), used: !!row.used,
  };
  const check = checkCaptcha(challenge, params.answer, Date.now());
  if (!check.ok) {
    await run('UPDATE captchas SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    return { ok: false, error: check.reason };
  }
  await run('UPDATE captchas SET used = 1 WHERE id = ?', [row.id]);
  return { ok: true, token: issueToken(user.id, 'task') };
}

async function handleSafetyVerify(user, params) {
  const res = await users.verifySafetyCode(user, params.code);
  if (!res.ok) return { ok: false, error: res.reason };
  if (!res.already) {
    await withTx((conn) => credit(conn, user.id, 'safety_check', config.safetyRewardMine, 'safety'));
  }
  return { ok: true, rewardMine: res.already ? 0 : config.safetyRewardMine };
}

async function handleAdView(user, params, rt) {
  if (user.banned) return { ok: false, error: 'banned' };
  if (!user.safety_passed) return { ok: false, error: 'safety_required' };
  const provider = String(params.provider || 'placeholder');
  const allowed = ['placeholder', 'adsgram', 'gigapub', 'monetag', 'adsterra'];
  if (!allowed.includes(provider)) return { ok: false, error: 'bad_provider' };
  // A solved captcha token is required: proves a human completed the task.
  if (!verifyToken(params.captchaToken, user.id, 'task')) {
    return { ok: false, error: 'captcha_required' };
  }
  // Real providers must be configured; placeholder is the safe fallback.
  const cfg = adConfig(rt);
  if (provider === 'adsgram' && !cfg.adsgram.configured) return { ok: false, error: 'provider_not_configured' };
  if (provider === 'gigapub' && !cfg.gigapub.configured) return { ok: false, error: 'provider_not_configured' };
  if (provider === 'monetag' && !cfg.monetag.configured) return { ok: false, error: 'provider_not_configured' };
  if (provider === 'adsterra' && !cfg.adsterra.configured) return { ok: false, error: 'provider_not_configured' };

  const today = dhakaDate(Date.now());
  const count = await getOne(
    'SELECT COUNT(*) AS c FROM ad_views WHERE user_id = ? AND view_date = ?',
    [user.id, today]
  );
  if (Number(count?.c || 0) >= rt.adDailyCap) return { ok: false, error: 'daily_cap' };

  await withTx(async (conn) => {
    await conn.execute(
      'INSERT INTO ad_views (user_id, provider, view_date) VALUES (?, ?, ?)',
      [user.id, provider, today]
    );
    await credit(conn, user.id, 'ad', rt.adRewardMine, `ad:${provider}`);
  });
  const updated = await users.getUserByTgId(user.tg_id);
  return { ok: true, rewardMine: rt.adRewardMine, balanceMine: Number(updated.balance_mine) };
}

async function handleProfile(user) {
  const ledger = await users.getLedger(user.id, 30);
  const withdrawals = await users.getWithdrawals(user.id, 20);
  return {
    ok: true,
    balanceMine: Number(user.balance_mine),
    ledger: ledger.map((r) => ({ source: r.source, amount: Number(r.amount_mine), ref: r.ref, date: r.ledger_date })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id, mineAmount: Number(w.mine_amount), ton: nanoToTon(Number(w.ton_nano)),
      wallet: w.wallet, status: w.status, proof: w.proof, note: w.admin_note,
      createdAt: w.created_at, decidedAt: w.decided_at,
    })),
  };
}

async function handleRefreshChannel(user, rt) {
  const status = await refreshChannelStatus(user, rt);
  return { ok: true, status, joined: isChannelJoined(status) };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const body = await readBody(req);
    const auth = validateInitData(body.initData || '', config.botToken);
    if (!auth.ok) return send(res, 401, { ok: false, error: 'unauthorized', reason: auth.reason });
    const tgUser = auth.user;

    const existing = await users.getUserByTgId(tgUser.id);
    if (!existing) {
      // First contact through the Mini App (never pressed /start).
      // Create the account; the safety code is delivered by the /start message.
      await users.getOrCreateUser(tgUser);
      return send(res, 200, { ok: false, error: 'need_start', message: 'Open the bot and press /start to get your safety code.' });
    }
    const user = existing;
    if (user.banned) return send(res, 403, { ok: false, error: 'banned' });
    const rt = await getRuntime();

    switch (body.action) {
      case 'state': return send(res, 200, await handleState(user, rt));
      case 'start_mining': return send(res, 200, await handleStartMining(user));
      case 'claim': return send(res, 200, await handleClaim(user, rt));
      case 'market': {
        const market = await loadMarket(Date.now());
        const history = await getPriceHistory(96);
        return send(res, 200, {
          ok: true,
          priceNano: market.priceNano, priceTon: formatPrice(market.priceNano),
          high24Nano: market.high24Nano, low24Nano: market.low24Nano,
          vol24Mine: market.vol24Mine,
          history: history.reverse().map((h) => ({ t: Number(h.t), priceNano: Number(h.price_nano) })),
        });
      }
      case 'quote': return send(res, 200, await handleQuote(user, body, rt));
      case 'swap': return send(res, 200, await handleSwap(user, body, rt));
      case 'refresh_channel': return send(res, 200, await handleRefreshChannel(user, rt));
      case 'captcha_new': return send(res, 200, await handleCaptchaNew(user));
      case 'captcha_verify': return send(res, 200, await handleCaptchaVerify(user, body));
      case 'safety_verify': return send(res, 200, await handleSafetyVerify(user, body));
      case 'ad_view': return send(res, 200, await handleAdView(user, body, rt));
      case 'profile': return send(res, 200, await handleProfile(user));
      default: return send(res, 400, { ok: false, error: 'unknown_action' });
    }
  } catch (e) {
    console.error('miniapp error:', e && e.message ? e.message : e);
    return send(res, 500, { ok: false, error: 'server_error' });
  }
};
