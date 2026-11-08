// MineSwap Telegram webhook — Vercel serverless function.
// Handles /start, /admin and the inline 👍 Like button callbacks.
// No other commands. /admin answers ONLY for the owner; everyone else
// gets silence (no hint that an admin exists).
'use strict';

const { config } = require('../lib/config');
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

function webAppKeyboard() {
  return {
    inline_keyboard: [[{
      text: '⛏️ Open MineSwap',
      web_app: { url: config.webAppUrl },
    }]],
  };
}

async function handleStart(msg) {
  const from = msg.from || {};
  const { user, isNew, safetyCode } = await users.getOrCreateUser({
    id: from.id, username: from.username || '', first_name: from.first_name || '',
  });
  const lines = [
    '⛏️ <b>Welcome to MineSwap!</b>',
    '',
    'Mine MINE every day, watch the market, and swap to TON (Gram).',
    `• Mining: ~${config.miningRatePerHour} MINE/hour, daily cap ${config.dailyCapMine} MINE`,
    `• Swap opens at ${config.swapMinMine.toLocaleString('en-US')} MINE`,
    `• Stay joined in @${config.channelUsername} and Like the daily post — both are required to withdraw.`,
    '',
  ];
  if (!user.safety_passed) {
    lines.push(
      '🔐 <b>Quick Safety Check</b>',
      `Your code is: <code>${isNew ? safetyCode : '••••'}</code>`,
      'Open the app and enter this code to start earning (+25 MINE).',
      isNew ? '' : 'If you lost your code, ask the admin to reset it.',
      ''
    );
  }
  lines.push('Tap below to open the app 👇');
  await tg.sendMessage(msg.chat.id, lines.filter((l) => l !== '').join('\n'), {
    reply_markup: webAppKeyboard(),
  });
}

async function handleAdmin(msg) {
  const from = msg.from || {};
  if (Number(from.id) !== Number(config.ownerTgId)) return; // silent for everyone else
  const adminUrl = `${config.webAppUrl.replace(/\/$/, '')}/admin/`;
  await tg.sendMessage(msg.chat.id,
    '🛠️ <b>MineSwap Admin</b>\n\n' +
    `Panel: ${adminUrl}\n` +
    'Sign in with the admin password set in the environment.\n' +
    'From there you can approve swaps, publish the daily post, manage ads, and ban users.',
    { reply_markup: webAppKeyboard() }
  );
}

// Inline 👍 Like button on channel posts: callback data "like:YYYY-MM-DD:postId"
async function handleCallback(q) {
  const data = String(q.data || '');
  const from = q.from || {};
  if (data.startsWith('like:')) {
    const parts = data.split(':');
    const date = parts[1] || '';
    const postId = parts.slice(2).join(':') || '';
    const existing = await users.getUserByTgId(from.id);
    if (!existing) {
      await tg.answerCallbackQuery(q.id, 'Open the bot and press /start first.', true);
      return;
    }
    if (existing.banned) {
      await tg.answerCallbackQuery(q.id, 'Your account is banned.', true);
      return;
    }
    await users.recordLike(existing.id, postId, date);
    await tg.answerCallbackQuery(q.id, '👍 Like recorded! You can claim your mining today.');
    return;
  }
  await tg.answerCallbackQuery(q.id, '');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }
  try {
    // Optional shared-secret check (set TELEGRAM_WEBHOOK_SECRET in env and
    // in BotFather's setWebhook secret_token to enable it).
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    if (secret) {
      const got = req.headers['x-telegram-bot-api-secret-token'] || '';
      if (got !== secret) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false }));
        return;
      }
    }
    const update = await readBody(req);
    if (update.message && typeof update.message.text === 'string') {
      const text = update.message.text.trim();
      if (text === '/start' || text.startsWith('/start ')) await handleStart(update.message);
      else if (text === '/admin' || text.startsWith('/admin ')) await handleAdmin(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error('webhook error:', e && e.message ? e.message : e);
    res.statusCode = 200; // always 200 so Telegram stops retrying a poisoned update
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  }
};
