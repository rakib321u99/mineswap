// MineSwap market price engine — pure functions over a plain state object.
// Price is stored as INTEGER nanoTON per MINE (1 TON = 1e9 nanoTON).
// The market is SIMULATED inside the bot (the token is not listed on any
// real exchange): price moves with swap pressure + a small random walk,
// clamped to a floor and a cap. No cron: the price updates LAZILY —
// updatePrice() is called on every market read and applies one step per
// elapsed 5-minute bucket, using a seeded PRNG so concurrent reads in the
// same bucket agree.
'use strict';

const STEP_MS = 5 * 60 * 1000; // one price step per 5 minutes

// Deterministic PRNG in [0, 1) from an integer seed (mulberry32).
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

// One drift step: random walk of at most +/-0.4% per 5-min bucket, with a
// tiny upward pull when the market has been quiet (few swaps recently),
// so a held token does not only bleed down. Returns the new price.
function driftStep(priceNano, floorNano, capNano, bucketSeed, quiet) {
  const rnd = seededRandom(bucketSeed)();
  // -0.004 .. +0.004, shifted +0.0005 when quiet (holding pressure).
  let pct = (rnd - 0.5) * 0.008 + (quiet ? 0.0005 : 0);
  const next = Math.round(priceNano * (1 + pct));
  return clamp(next, floorNano, capNano);
}

// Swap pressure: selling MINE pushes the price DOWN.
// k = 1% per 10,000 MINE sold (relative to a 1,000,000 MINE pool).
// A 10,000 MINE swap (the minimum) moves the price -1%.
function applySellPressure(priceNano, floorNano, capNano, mineSold) {
  if (mineSold <= 0) return priceNano;
  // 1% down per 10,000 MINE sold, capped at -5% per single swap.
  const pct = Math.min(0.05, mineSold / 1000000);
  const next = Math.round(priceNano * (1 - pct));
  return clamp(next, floorNano, capNano);
}

// Lazy update: apply drift steps for every full 5-min bucket elapsed
// since state.updatedAtMs. Mutates and returns the state object.
// state = { priceNano, floorNano, capNano, updatedAtMs, high24Nano,
//           low24Nano, vol24Mine, windowStartMs, swaps24h }
function updatePrice(state, nowMs) {
  const floor = state.floorNano;
  const cap = state.capNano;
  let { priceNano, updatedAtMs } = state;
  if (!updatedAtMs || nowMs <= updatedAtMs) return state;

  // Roll the 24h window.
  if (!state.windowStartMs || nowMs - state.windowStartMs >= 24 * 3600 * 1000) {
    state.windowStartMs = nowMs;
    state.high24Nano = priceNano;
    state.low24Nano = priceNano;
    state.vol24Mine = 0;
    state.swaps24h = 0;
  }

  const buckets = Math.floor((nowMs - updatedAtMs) / STEP_MS);
  const quiet = (state.swaps24h || 0) === 0;
  for (let i = 0; i < buckets; i++) {
    const bucketIndex = Math.floor((updatedAtMs + (i + 1) * STEP_MS) / STEP_MS);
    priceNano = driftStep(priceNano, floor, cap, bucketIndex, quiet);
    if (priceNano > state.high24Nano) state.high24Nano = priceNano;
    if (priceNano < state.low24Nano) state.low24Nano = priceNano;
  }
  if (buckets > 0) {
    state.priceNano = priceNano;
    state.updatedAtMs = updatedAtMs + buckets * STEP_MS;
  }
  return state;
}

// 24h change in percent vs the price 24h ago (approximated by low/high
// midpoint when no history exists — callers pass the real reference).
function changePct(priceNano, refNano) {
  if (!refNano || refNano <= 0) return 0;
  return ((priceNano - refNano) / refNano) * 100;
}

// Format nanoTON as a TON decimal string (9 decimals, trimmed).
function nanoToTon(nano) {
  const whole = Math.floor(nano / 1e9);
  const frac = String(nano % 1e9).padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// Format price (nanoTON per MINE) with 6 decimals of TON.
function formatPrice(nano) {
  return (nano / 1e9).toFixed(6);
}

module.exports = {
  STEP_MS, seededRandom, clamp, driftStep, applySellPressure,
  updatePrice, changePct, nanoToTon, formatPrice,
};
