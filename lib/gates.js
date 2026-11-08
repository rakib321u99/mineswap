// MineSwap gates — pure decision functions. Every gate fails CLOSED:
// unknown / error / missing data means "not allowed".
'use strict';

// Channel membership statuses that count as "joined".
const JOINED_STATUSES = new Set(['creator', 'administrator', 'member']);

// getChatMember status -> joined?
function isChannelJoined(status) {
  if (typeof status !== 'string') return false;
  return JOINED_STATUSES.has(status.toLowerCase());
}

// Claim gate: today's Like must be recorded. likedToday is a boolean.
function canClaim({ miningActive, likedToday, banned }) {
  if (banned) return { ok: false, reason: 'banned' };
  if (!miningActive) return { ok: false, reason: 'not_mining' };
  if (!likedToday) return { ok: false, reason: 'like_required' };
  return { ok: true };
}

// Swap gate: all conditions must hold at once (plan section 6).
// input: { balanceMine, swapMinMine, channelStatus, likedToday,
//          walletAddress, walletValid, banned }
function canSwap(input) {
  if (input.banned) return { ok: false, reason: 'banned' };
  if (!input.walletValid) return { ok: false, reason: 'invalid_wallet' };
  if (input.balanceMine < input.swapMinMine) return { ok: false, reason: 'below_minimum' };
  if (!isChannelJoined(input.channelStatus)) return { ok: false, reason: 'channel_required' };
  if (!input.likedToday) return { ok: false, reason: 'like_required' };
  return { ok: true };
}

// Swap amount validation (before gates): whole MINE, >= minimum,
// not more than the balance.
function validateSwapAmount(amountMine, balanceMine, swapMinMine) {
  if (!Number.isInteger(amountMine) || amountMine <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  if (amountMine < swapMinMine) return { ok: false, reason: 'below_minimum' };
  if (amountMine > balanceMine) return { ok: false, reason: 'insufficient_balance' };
  return { ok: true };
}

// TON (Gram) out for a swap, in integer nanoTON. No floats for money.
// tonNano = mineAmount * priceNanoPerMine (both integers).
function tonOutNano(mineAmount, priceNano) {
  if (!Number.isInteger(mineAmount) || !Number.isInteger(priceNano)) return 0;
  if (mineAmount <= 0 || priceNano <= 0) return 0;
  return mineAmount * priceNano;
}

module.exports = { isChannelJoined, canClaim, canSwap, validateSwapAmount, tonOutNano };
