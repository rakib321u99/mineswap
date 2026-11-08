// Math captcha for task verification — pure functions.
// A challenge is "a + b" with a,b in 1..20, 60 seconds to solve, 2 attempts.
// The server stores only a SHA-256 hash of the answer (never the answer).
'use strict';

const crypto = require('node:crypto');

function makeCaptcha(nowMs, rand = Math.random) {
  const a = 1 + Math.floor(rand() * 20);
  const b = 1 + Math.floor(rand() * 20);
  return {
    question: `${a} + ${b} = ?`,
    answerHash: crypto.createHash('sha256').update(String(a + b)).digest('hex'),
    expiresAtMs: nowMs + 60 * 1000,
    attempts: 0,
  };
}

// challenge: { answerHash, expiresAtMs, attempts, used }
// Returns { ok, reason? }. Does NOT mutate; the caller persists attempts.
function checkCaptcha(challenge, givenAnswer, nowMs) {
  if (!challenge || challenge.used) return { ok: false, reason: 'used' };
  if (nowMs > challenge.expiresAtMs) return { ok: false, reason: 'expired' };
  if (challenge.attempts >= 2) return { ok: false, reason: 'too_many_attempts' };
  const hash = crypto.createHash('sha256').update(String(givenAnswer).trim()).digest('hex');
  if (hash !== challenge.answerHash) return { ok: false, reason: 'wrong' };
  return { ok: true };
}

module.exports = { makeCaptcha, checkCaptcha };
