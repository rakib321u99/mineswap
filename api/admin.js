// MineSwap admin panel backend — Vercel serverless function.
// POST { action, ...params } -> JSON.
// Auth: action=login with { password } returns a 24h HMAC token; every
// other action requires it (body.token or Authorization: Bearer).
// The admin password lives ONLY in the ADMIN_PASSWORD env var.
'use strict';

const crypto = require('node:crypto');
const { config } = require('../lib/config');
const { getOne, run, query, withTx } = require('../lib/db');
const { getRuntime, clearRuntimeCache, INT_KEYS, STR_KEYS } = require('../lib/runtime');
const { credit } = require('../lib/ledger');
const { nanoToTon } = require('../lib/price');
const { dhakaDate } = require('../lib/mining');
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

function tokenSecret() {
  return `${config.adminPassword}:${config.botToken || 'mineswap-dev'}`;
}

function issueAdminToken() {
  const exp = Date.now() + 24 * 3600 * 1000;
  const sig = crypto.createHmac('sha256', tokenSecret()).update(String(exp)).digest('hex');
  return Buffer.from(`${exp}.${sig}`).toString('base64url');
}

function verifyAdminToken(token) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const [exp, sig] = raw.split('.');
    if (!exp || !sig || Date.now() > Number(exp)) return false;
    const want = crypto.createHmac('sha256', tokenSecret()).update(exp).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(want, 'hex'));
  } catch (_) { return false; }
}

const SETTING_ALLOW = new Set([...Object.keys(INT_KEYS), ...Object.keys(STR_KEYS)]);

async function handleStats() {
  const totalUsers = await getOne('SELECT COUNT(*) AS c FROM users');
  const mining = await getOne('SELECT COUNT(*) AS c FROM users WHERE mining_active = 1');
  const pending = await getOne("SELECT COUNT(*) AS c, COALESCE(SUM(mine_amount),0) AS s FROM withdrawals WHERE status = 'pending'");
  const approved = await getOne("SELECT COUNT(*) AS c, COALESCE(SUM(mine_amount),0) AS s FROM withdrawals WHERE status = 'approved'");
  const market = await getOne('SELECT price_nano, vol24_mine FROM market WHERE id = 1');
  const adsToday = await getOne('SELECT COUNT(*) AS c FROM ad_views WHERE view_date = ?', [dhakaDate(Date.now())]);
  return {
    ok: true,
    totalUsers: Number(totalUsers?.c || 0),
    miningActive: Number(mining?.c || 0),
    pendingWithdrawals: Number(pending?.c || 0),
    pendingMine: Number(pending?.s || 0),
    approvedWithdrawals: Number(approved?.c || 0),
    approvedMine: Number(approved?.s || 0),
    priceNano: market ? Number(market.price_nano) : 0,
    vol24Mine: market ? Number(market.vol24_mine) : 0,
    adViewsToday: Number(adsToday?.c || 0),
  };
}

async function handleWithdrawals(params) {
  const status = ['pending', 'approved', 'rejected'].includes(params.status) ? params.status : 'pending';
  const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 50));
  const rows = await query(
    `SELECT w.*, u.tg_id, u.username FROM withdrawals w
     JOIN users u ON u.id = w.user_id WHERE w.status = ? ORDER BY w.id DESC LIMIT ?`,
    [status, limit]
  );
  return {
    ok: true,
    withdrawals: rows.map((w) => ({
      id: w.id, tgId: w.tg_id, username: w.username,
      mineAmount: Number(w.mine_amount), ton: nanoToTon(Number(w.ton_nano)),
      priceNano: Number(w.price_nano), wallet: w.wallet, status: w.status,
      proof: w.proof, note: w.admin_note, createdAt: w.created_at, decidedAt: w.decided_at,
    })),
  };
}

async function handleApprove(params) {
  const id = parseInt(params.id, 10);
  const proof = String(params.proof || '').trim();
  if (!id) return { ok: false, error: 'bad_id' };
  const w = await getOne('SELECT * FROM withdrawals WHERE id = ?', [id]);
  if (!w) return { ok: false, error: 'not_found' };
  if (w.status !== 'pending') return { ok: false, error: 'not_pending' };
  await run(
    "UPDATE withdrawals SET status = 'approved', proof = ?, decided_at = NOW() WHERE id = ?",
    [proof, id]
  );
  const u = await getOne('SELECT tg_id FROM users WHERE id = ?', [w.user_id]);
  if (u) {
    tg.sendMessage(u.tg_id,
      `✅ Swap #${id} approved!\n${Number(w.mine_amount).toLocaleString('en-US')} MINE → ${nanoToTon(Number(w.ton_nano))} TON (Gram) has been sent to your wallet.` +
      (proof ? `\nProof: ${proof}` : '')
    ).catch(() => {});
  }
  return { ok: true };
}

async function handleReject(params) {
  const id = parseInt(params.id, 10);
  const reason = String(params.reason || 'Rejected by admin').trim();
  if (!id) return { ok: false, error: 'bad_id' };
  const w = await getOne('SELECT * FROM withdrawals WHERE id = ?', [id]);
  if (!w) return { ok: false, error: 'not_found' };
  if (w.status !== 'pending') return { ok: false, error: 'not_pending' };
  await withTx(async (conn) => {
    await conn.execute(
      "UPDATE withdrawals SET status = 'rejected', admin_note = ?, decided_at = NOW() WHERE id = ?",
      [reason, id]
    );
    // Refund the locked MINE.
    await credit(conn, w.user_id, 'swap_refund', Number(w.mine_amount), `refund:${id}`);
  });
  const u = await getOne('SELECT tg_id FROM users WHERE id = ?', [w.user_id]);
  if (u) {
    tg.sendMessage(u.tg_id,
      `❌ Swap #${id} was rejected.\nReason: ${reason}\nYour ${Number(w.mine_amount).toLocaleString('en-US')} MINE has been refunded to your balance.`
    ).catch(() => {});
  }
  return { ok: true };
}

async function handleUsers(params) {
  const q = String(params.q || '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 50));
  let rows;
  if (q) {
    rows = await query(
      `SELECT tg_id, username, first_name, balance_mine, mining_active,
              safety_passed, banned, created_at FROM users
       WHERE tg_id = ? OR username LIKE ? ORDER BY id DESC LIMIT ?`,
      [q, `%${q}%`, limit]
    );
  } else {
    rows = await query(
      `SELECT tg_id, username, first_name, balance_mine, mining_active,
              safety_passed, banned, created_at FROM users ORDER BY id DESC LIMIT ?`,
      [limit]
    );
  }
  return {
    ok: true,
    users: rows.map((u) => ({
      tgId: u.tg_id, username: u.username, firstName: u.first_name,
      balanceMine: Number(u.balance_mine), miningActive: !!u.mining_active,
      safetyPassed: !!u.safety_passed, banned: !!u.banned, createdAt: u.created_at,
    })),
  };
}

async function handleBan(params) {
  const tgId = parseInt(params.tgId, 10);
  if (!tgId) return { ok: false, error: 'bad_id' };
  await run('UPDATE users SET banned = ? WHERE tg_id = ?', [params.banned ? 1 : 0, tgId]);
  return { ok: true };
}

async function handlePostPublish(params) {
  const text = String(params.text || '').trim();
  if (!text) return { ok: false, error: 'empty_text' };
  const rt = await getRuntime();
  const today = dhakaDate(Date.now());
  const sent = await tg.tgCall('sendMessage', {
    chat_id: `@${rt.channelUsername}`,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: '👍 Like', callback_data: `like:${today}` }]],
    },
  });
  if (!sent || sent.ok !== true) {
    return { ok: false, error: 'send_failed', detail: sent && sent.description ? sent.description : '' };
  }
  const msg = sent.result;
  const url = `https://t.me/${rt.channelUsername}/${msg.message_id}`;
  await users.setSetting('today_post_url', url);
  clearRuntimeCache();
  return { ok: true, url, messageId: msg.message_id };
}

async function handleSafetyReset(params) {
  const tgId = parseInt(params.tgId, 10);
  if (!tgId) return { ok: false, error: 'bad_id' };
  const reset = await users.resetSafetyCode(tgId);
  if (!reset) return { ok: false, error: 'not_found' };
  // Deliver the fresh code to the user in the bot chat ONLY.
  await tg.sendMessage(tgId,
    `🔐 Your MineSwap safety code was reset by the admin.\nYour new code is: <code>${reset.safetyCode}</code>\nEnter it in the app to start earning.`
  );
  return { ok: true };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const body = await readBody(req);

    if (body.action === 'login') {
      if (!config.adminPassword) return send(res, 500, { ok: false, error: 'admin_not_configured' });
      if (String(body.password || '') !== config.adminPassword) {
        return send(res, 401, { ok: false, error: 'wrong_password' });
      }
      return send(res, 200, { ok: true, token: issueAdminToken() });
    }

    const token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!verifyAdminToken(token)) return send(res, 401, { ok: false, error: 'unauthorized' });

    switch (body.action) {
      case 'stats': return send(res, 200, await handleStats());
      case 'settings_get': {
        const rows = await query('SELECT skey, svalue FROM settings');
        const out = {};
        for (const r of rows) out[r.skey] = r.svalue;
        return send(res, 200, { ok: true, settings: out });
      }
      case 'settings_set': {
        const key = String(body.key || '');
        if (!SETTING_ALLOW.has(key)) return send(res, 400, { ok: false, error: 'key_not_allowed' });
        await users.setSetting(key, String(body.value ?? ''));
        clearRuntimeCache();
        return send(res, 200, { ok: true });
      }
      case 'withdrawals': return send(res, 200, await handleWithdrawals(body));
      case 'withdrawal_approve': return send(res, 200, await handleApprove(body));
      case 'withdrawal_reject': return send(res, 200, await handleReject(body));
      case 'users': return send(res, 200, await handleUsers(body));
      case 'user_ban': return send(res, 200, await handleBan(body));
      case 'safety_reset': return send(res, 200, await handleSafetyReset(body));
      case 'post_publish': return send(res, 200, await handlePostPublish(body));
      default: return send(res, 400, { ok: false, error: 'unknown_action' });
    }
  } catch (e) {
    console.error('admin error:', e && e.message ? e.message : e);
    return send(res, 500, { ok: false, error: 'server_error' });
  }
};
