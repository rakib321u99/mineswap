// Users + settings helpers (DB-backed).
'use strict';

const crypto = require('node:crypto');
const { getOne, run, query } = require('./db');
const { dhakaDate } = require('./mining');

async function getUserByTgId(tgId) {
  return getOne('SELECT * FROM users WHERE tg_id = ?', [tgId]);
}

async function createUser(tgUser) {
  const safetyCode = String(100 + Math.floor(Math.random() * 900)); // 3 digits
  const hash = crypto.createHash('sha256').update(safetyCode).digest('hex');
  const res = await run(
    `INSERT INTO users (tg_id, username, first_name, safety_code_hash)
     VALUES (?, ?, ?, ?)`,
    [tgUser.id, tgUser.username || '', tgUser.first_name || '', hash]
  );
  return { id: res.insertId, safetyCode };
}

// Get-or-create. Returns { user, isNew, safetyCode? }.
// The safety code is returned ONLY on creation, so the webhook can send it
// to the user once. It is never stored in plain text.
async function getOrCreateUser(tgUser) {
  const existing = await getUserByTgId(tgUser.id);
  if (existing) return { user: existing, isNew: false };
  const { id, safetyCode } = await createUser(tgUser);
  const user = await getUserByTgId(tgUser.id);
  return { user, isNew: true, safetyCode };
}

async function verifySafetyCode(user, code) {
  if (user.safety_passed) return { ok: true, already: true };
  const hash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
  if (hash !== user.safety_code_hash) return { ok: false, reason: 'wrong_code' };
  await run('UPDATE users SET safety_passed = 1 WHERE id = ?', [user.id]);
  return { ok: true };
}

// Admin-only: issue a fresh safety code (e.g. user lost theirs).
// Returns the new code in plain text — the caller must deliver it to the
// user via the bot chat ONLY, never store or log it.
async function resetSafetyCode(tgId) {
  const user = await getUserByTgId(tgId);
  if (!user) return null;
  const safetyCode = String(100 + Math.floor(Math.random() * 900));
  const hash = crypto.createHash('sha256').update(safetyCode).digest('hex');
  await run('UPDATE users SET safety_code_hash = ?, safety_passed = 0 WHERE id = ?',
    [hash, user.id]);
  return { user, safetyCode };
}

async function hasLikedToday(userId, dateStr) {
  const row = await getOne(
    'SELECT id FROM likes WHERE user_id = ? AND like_date = ?',
    [userId, dateStr || dhakaDate(Date.now())]
  );
  return !!row;
}

async function recordLike(userId, postId, dateStr) {
  const d = dateStr || dhakaDate(Date.now());
  await run(
    'INSERT IGNORE INTO likes (user_id, like_date, post_id) VALUES (?, ?, ?)',
    [userId, d, postId || '']
  );
  return true;
}

async function getSetting(key, fallback = '') {
  const row = await getOne('SELECT svalue FROM settings WHERE skey = ?', [key]);
  return row ? String(row.svalue) : fallback;
}

async function setSetting(key, value) {
  await run(
    'INSERT INTO settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)',
    [key, String(value)]
  );
}

async function getLedger(userId, limit = 30) {
  return query(
    'SELECT source, amount_mine, ref, ledger_date, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    [userId, limit]
  );
}

async function getWithdrawals(userId, limit = 20) {
  return query(
    `SELECT id, mine_amount, ton_nano, price_nano, wallet, status, proof,
            admin_note, created_at, decided_at
     FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
}

module.exports = {
  getUserByTgId, createUser, getOrCreateUser, verifySafetyCode, resetSafetyCode,
  hasLikedToday, recordLike, getSetting, setSetting, getLedger, getWithdrawals,
};
