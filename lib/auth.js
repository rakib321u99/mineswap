// Telegram Mini App initData validation (official algorithm):
//   secret = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
//   check  = HMAC_SHA256(key=secret, msg="k=v\nk=v..." sorted, without hash)
//   valid  = check == hash  AND  auth_date is recent (<= 24h old).
// Uses only node:crypto. No network.
'use strict';

const crypto = require('node:crypto');

function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function validateInitData(initData, botToken, nowMs = Date.now(), maxAgeSec = 86400) {
  if (!initData || !botToken) return { ok: false, reason: 'missing' };
  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return { ok: false, reason: 'no_hash' };
  delete data.hash;

  const checkString = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  let equal = false;
  try {
    equal = crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
  } catch (_) {
    equal = false;
  }
  if (!equal) return { ok: false, reason: 'bad_hash' };

  const authDate = parseInt(data.auth_date || '0', 10);
  if (!authDate || nowMs / 1000 - authDate > maxAgeSec) {
    return { ok: false, reason: 'stale' };
  }
  let user = null;
  try { user = JSON.parse(data.user || 'null'); } catch (_) { user = null; }
  if (!user || !user.id) return { ok: false, reason: 'no_user' };
  return { ok: true, user };
}

// Helper for tests: build a valid initData string for a fake token/user.
function buildInitData(botToken, user, authDateSec) {
  const data = {
    auth_date: String(authDateSec),
    query_id: 'test-query-id',
    user: JSON.stringify(user),
  };
  const checkString = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  const params = new URLSearchParams({ ...data, hash });
  return params.toString();
}

module.exports = { parseInitData, validateInitData, buildInitData };
