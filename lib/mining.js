// MineSwap mining math — pure functions, integer MINE only (no floats).
// Plan: ~7 MINE/hour, claimable anytime, daily cap 200 MINE.
// "Day" = Asia/Dhaka calendar day (UTC+6), matching the owner's timezone.
'use strict';

// Asia/Dhaka date string (YYYY-MM-DD) for a timestamp.
function dhakaDate(ms) {
  const d = new Date(ms + 6 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// Whole MINE accrued between two timestamps at a given hourly rate.
// Fractions of an hour accrue fractionally and are floored on claim,
// so the user never loses accrued time — it stays in the session.
function accruedMine(fromMs, toMs, ratePerHour) {
  if (fromMs === null || fromMs === undefined || toMs <= fromMs || ratePerHour <= 0) return 0;
  const hours = (toMs - fromMs) / 3600000;
  return Math.floor(hours * ratePerHour);
}

// How much of the accrued amount the user may claim today.
// claimedToday = MINE already claimed on this Dhaka date.
function claimableMine(accrued, claimedToday, dailyCap) {
  if (accrued <= 0) return 0;
  const remaining = dailyCap - claimedToday;
  if (remaining <= 0) return 0;
  return Math.min(accrued, remaining);
}

// Days (at ~ratePerHour, capped daily) to reach a target balance.
function daysToTarget(targetMine, ratePerHour, dailyCap) {
  const perDay = Math.min(ratePerHour * 24, dailyCap);
  if (perDay <= 0) return Infinity;
  return Math.ceil(targetMine / perDay);
}

module.exports = { dhakaDate, accruedMine, claimableMine, daysToTarget };
