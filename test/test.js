// MineSwap logic tests — pure Node, no dependencies, no network, no DB.
// Run: node test/test.js   (or: npm test)
// Covers the plan's hard rules: mining math, 200/day cap, Like-gates-Claim,
// channel gate, price engine (floor/cap/pressure), swap validation, TON
// math, captcha, and Telegram initData validation.
'use strict';

const assert = require('node:assert');
const mining = require('../lib/mining');
const price = require('../lib/price');
const gates = require('../lib/gates');
const ton = require('../lib/ton');
const captcha = require('../lib/captcha');
const auth = require('../lib/auth');

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e.message}`);
    console.error(`FAIL: ${name}\n  ${e.message}`);
  }
}

const HOUR = 3600000;

/* ================= mining ================= */
test('mining: 1 hour at 7/hr accrues 7 MINE', () => {
  assert.strictEqual(mining.accruedMine(0, HOUR, 7), 7);
});
test('mining: 10 hours at 7/hr accrues 70 MINE', () => {
  assert.strictEqual(mining.accruedMine(0, 10 * HOUR, 7), 70);
});
test('mining: 30 minutes accrues 3 MINE (floored, no fractions)', () => {
  assert.strictEqual(mining.accruedMine(0, 30 * 60 * 1000, 7), 3);
});
test('mining: zero elapsed accrues 0', () => {
  assert.strictEqual(mining.accruedMine(1000, 1000, 7), 0);
});
test('mining: reversed timestamps accrue 0', () => {
  assert.strictEqual(mining.accruedMine(5000, 1000, 7), 0);
});
test('mining: claimable is the full accrual under the cap', () => {
  assert.strictEqual(mining.claimableMine(50, 0, 200), 50);
});
test('mining: claimable is capped by remaining daily allowance', () => {
  assert.strictEqual(mining.claimableMine(50, 180, 200), 20);
});
test('mining: claimable is 0 when the daily cap is already hit', () => {
  assert.strictEqual(mining.claimableMine(50, 200, 200), 0);
});
test('mining: claimable is 0 when claimed exceeds the cap', () => {
  assert.strictEqual(mining.claimableMine(50, 250, 200), 0);
});
test('mining: 10,000 MINE at max rate takes 60 days (168/day)', () => {
  assert.strictEqual(mining.daysToTarget(10000, 7, 200), 60);
});
test('mining: dhakaDate uses Asia/Dhaka (UTC+6)', () => {
  assert.strictEqual(mining.dhakaDate(Date.UTC(2026, 10, 8, 0, 0, 0)), '2026-11-08');
  assert.strictEqual(mining.dhakaDate(Date.UTC(2026, 10, 7, 17, 0, 0)), '2026-11-07');
  assert.strictEqual(mining.dhakaDate(Date.UTC(2026, 10, 7, 18, 0, 0)), '2026-11-08');
});

/* ================= price engine ================= */
test('price: drift stays inside floor/cap over 1000 steps', () => {
  let p = 100000;
  for (let i = 0; i < 1000; i++) {
    p = price.driftStep(p, 50000, 500000, i, false);
    assert.ok(p >= 50000 && p <= 500000, `out of bounds: ${p}`);
  }
});
test('price: drift is deterministic for the same bucket seed', () => {
  assert.strictEqual(price.driftStep(100000, 50000, 500000, 42, false),
    price.driftStep(100000, 50000, 500000, 42, false));
});
test('price: selling 10,000 MINE drops the price ~1%', () => {
  assert.strictEqual(price.applySellPressure(100000, 50000, 500000, 10000), 99000);
});
test('price: selling 0 MINE changes nothing', () => {
  assert.strictEqual(price.applySellPressure(100000, 50000, 500000, 0), 100000);
});
test('price: a huge single swap moves at most -5%', () => {
  assert.strictEqual(price.applySellPressure(100000, 50000, 500000, 1000000), 95000);
});
test('price: sell pressure never goes below the floor', () => {
  assert.strictEqual(price.applySellPressure(50000, 50000, 500000, 1000000), 50000);
});
test('price: lazy update applies one step per elapsed 5-min bucket', () => {
  const now = Date.now();
  const state = {
    priceNano: 100000, floorNano: 50000, capNano: 500000,
    updatedAtMs: now - HOUR, high24Nano: 100000, low24Nano: 100000,
    vol24Mine: 0, windowStartMs: now - HOUR, swaps24h: 0,
  };
  price.updatePrice(state, now);
  assert.strictEqual(state.updatedAtMs, now - HOUR + 12 * price.STEP_MS);
  assert.ok(state.priceNano >= 50000 && state.priceNano <= 500000);
  assert.ok(state.high24Nano >= 100000 && state.low24Nano <= 100000);
});
test('price: lazy update with <5 min elapsed changes nothing', () => {
  const now = Date.now();
  const state = {
    priceNano: 100000, floorNano: 50000, capNano: 500000,
    updatedAtMs: now - 60 * 1000, high24Nano: 100000, low24Nano: 100000,
    vol24Mine: 0, windowStartMs: now - 60 * 1000, swaps24h: 0,
  };
  price.updatePrice(state, now);
  assert.strictEqual(state.priceNano, 100000);
  assert.strictEqual(state.updatedAtMs, now - 60 * 1000);
});
test('price: 24h window rolls after 24h (high/low/vol reset)', () => {
  const now = Date.now();
  const state = {
    priceNano: 120000, floorNano: 50000, capNano: 500000,
    updatedAtMs: now - 25 * HOUR, high24Nano: 200000, low24Nano: 80000,
    vol24Mine: 99999, windowStartMs: now - 25 * HOUR, swaps24h: 5,
  };
  price.updatePrice(state, now);
  assert.strictEqual(state.vol24Mine, 0);
  assert.strictEqual(state.swaps24h, 0);
  assert.ok(state.windowStartMs > now - 60 * 1000);
});
test('price: nanoToTon formats 1 TON and fractions', () => {
  assert.strictEqual(price.nanoToTon(1000000000), '1');
  assert.strictEqual(price.nanoToTon(100000), '0.0001');
  assert.strictEqual(price.nanoToTon(0), '0');
  assert.strictEqual(price.nanoToTon(1500000000), '1.5');
});
test('price: formatPrice shows 6 decimals of TON', () => {
  assert.strictEqual(price.formatPrice(100000), '0.000100');
});
test('price: changePct computes +10% correctly', () => {
  assert.strictEqual(price.changePct(110000, 100000), 10);
  assert.strictEqual(price.changePct(90000, 100000), -10);
  assert.strictEqual(price.changePct(100000, 0), 0);
});
test('price: seededRandom is deterministic and in [0,1)', () => {
  const a = price.seededRandom(7);
  const b = price.seededRandom(7);
  assert.strictEqual(a(), b());
  for (let i = 0; i < 100; i++) {
    const v = price.seededRandom(i)();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

/* ================= gates ================= */
test('gates: member/creator/administrator count as joined', () => {
  assert.strictEqual(gates.isChannelJoined('member'), true);
  assert.strictEqual(gates.isChannelJoined('creator'), true);
  assert.strictEqual(gates.isChannelJoined('administrator'), true);
});
test('gates: left/kicked/restricted/empty do NOT count as joined (fail closed)', () => {
  assert.strictEqual(gates.isChannelJoined('left'), false);
  assert.strictEqual(gates.isChannelJoined('kicked'), false);
  assert.strictEqual(gates.isChannelJoined('restricted'), false);
  assert.strictEqual(gates.isChannelJoined(''), false);
  assert.strictEqual(gates.isChannelJoined(null), false);
  assert.strictEqual(gates.isChannelJoined(undefined), false);
});
test('gates: claim allowed when mining + liked', () => {
  assert.deepStrictEqual(
    gates.canClaim({ miningActive: true, likedToday: true, banned: false }), { ok: true });
});
test('gates: claim BLOCKED without today\'s Like', () => {
  assert.strictEqual(
    gates.canClaim({ miningActive: true, likedToday: false, banned: false }).reason, 'like_required');
});
test('gates: claim BLOCKED when not mining', () => {
  assert.strictEqual(
    gates.canClaim({ miningActive: false, likedToday: true, banned: false }).reason, 'not_mining');
});
test('gates: claim BLOCKED when banned', () => {
  assert.strictEqual(
    gates.canClaim({ miningActive: true, likedToday: true, banned: true }).reason, 'banned');
});
test('gates: swap allowed when all conditions hold', () => {
  assert.deepStrictEqual(gates.canSwap({
    balanceMine: 10000, swapMinMine: 10000, channelStatus: 'member',
    likedToday: true, walletValid: true, banned: false,
  }), { ok: true });
});
test('gates: swap BLOCKED below 10,000 MINE', () => {
  assert.strictEqual(gates.canSwap({
    balanceMine: 9999, swapMinMine: 10000, channelStatus: 'member',
    likedToday: true, walletValid: true, banned: false,
  }).reason, 'below_minimum');
});
test('gates: swap BLOCKED when not in the channel', () => {
  assert.strictEqual(gates.canSwap({
    balanceMine: 10000, swapMinMine: 10000, channelStatus: 'left',
    likedToday: true, walletValid: true, banned: false,
  }).reason, 'channel_required');
});
test('gates: swap BLOCKED without today\'s Like', () => {
  assert.strictEqual(gates.canSwap({
    balanceMine: 10000, swapMinMine: 10000, channelStatus: 'member',
    likedToday: false, walletValid: true, banned: false,
  }).reason, 'like_required');
});
test('gates: swap BLOCKED with an invalid wallet', () => {
  assert.strictEqual(gates.canSwap({
    balanceMine: 10000, swapMinMine: 10000, channelStatus: 'member',
    likedToday: true, walletValid: false, banned: false,
  }).reason, 'invalid_wallet');
});
test('gates: swap amount validation (min, balance, integer)', () => {
  assert.deepStrictEqual(gates.validateSwapAmount(10000, 15000, 10000), { ok: true });
  assert.strictEqual(gates.validateSwapAmount(9999, 15000, 10000).reason, 'below_minimum');
  assert.strictEqual(gates.validateSwapAmount(20000, 15000, 10000).reason, 'insufficient_balance');
  assert.strictEqual(gates.validateSwapAmount(0, 15000, 10000).reason, 'invalid_amount');
  assert.strictEqual(gates.validateSwapAmount(10000.5, 15000, 10000).reason, 'invalid_amount');
  assert.strictEqual(gates.validateSwapAmount(NaN, 15000, 10000).reason, 'invalid_amount');
});
test('gates: 10,000 MINE at start price = exactly 1 TON', () => {
  assert.strictEqual(gates.tonOutNano(10000, 100000), 1000000000);
  assert.strictEqual(gates.tonOutNano(0, 100000), 0);
  assert.strictEqual(gates.tonOutNano(-5, 100000), 0);
});

/* ================= TON addresses ================= */
const EQ_ADDR = 'EQ' + 'A'.repeat(46);
const UQ_ADDR = 'UQ' + 'B7'.repeat(23);
const RAW_ADDR = '0:' + 'ab'.repeat(32);
test('ton: valid EQ/UQ friendly addresses pass', () => {
  assert.strictEqual(ton.isValidTonAddress(EQ_ADDR), true);
  assert.strictEqual(ton.isValidTonAddress(UQ_ADDR), true);
});
test('ton: valid raw 0:hex address passes', () => {
  assert.strictEqual(ton.isValidTonAddress(RAW_ADDR), true);
});
test('ton: invalid addresses fail (short, bad prefix, bad chars, empty)', () => {
  assert.strictEqual(ton.isValidTonAddress('EQshort'), false);
  assert.strictEqual(ton.isValidTonAddress('XQ' + 'A'.repeat(46)), false);
  assert.strictEqual(ton.isValidTonAddress('EQ' + '!'.repeat(46)), false);
  assert.strictEqual(ton.isValidTonAddress(''), false);
  assert.strictEqual(ton.isValidTonAddress(null), false);
  assert.strictEqual(ton.isValidTonAddress('0:' + 'zz'.repeat(32)), false);
  assert.strictEqual(ton.isValidTonAddress('EQ' + 'A'.repeat(45)), false);
});

/* ================= captcha ================= */
test('captcha: challenge has a question and 60s expiry', () => {
  const now = Date.now();
  const c = captcha.makeCaptcha(now);
  assert.match(c.question, /^\d+ \+ \d+ = \?$/);
  assert.strictEqual(c.expiresAtMs, now + 60000);
  assert.strictEqual(c.attempts, 0);
});
test('captcha: correct answer passes', () => {
  const c = captcha.makeCaptcha(Date.now(), () => 0.1); // a=3, b=3
  assert.deepStrictEqual(captcha.checkCaptcha(c, 6, Date.now()), { ok: true });
});
test('captcha: wrong answer fails', () => {
  const c = captcha.makeCaptcha(Date.now(), () => 0.1);
  assert.strictEqual(captcha.checkCaptcha(c, 7, Date.now()).reason, 'wrong');
});
test('captcha: expired challenge fails', () => {
  const c = captcha.makeCaptcha(Date.now());
  assert.strictEqual(captcha.checkCaptcha(c, 1, Date.now() + 61000).reason, 'expired');
});
test('captcha: 2 attempts max', () => {
  const c = captcha.makeCaptcha(Date.now());
  c.attempts = 2;
  assert.strictEqual(captcha.checkCaptcha(c, 1, Date.now()).reason, 'too_many_attempts');
});
test('captcha: used challenge fails', () => {
  const c = captcha.makeCaptcha(Date.now());
  c.used = true;
  assert.strictEqual(captcha.checkCaptcha(c, 1, Date.now()).reason, 'used');
});

/* ================= Telegram initData ================= */
test('auth: valid initData verifies and returns the user', () => {
  const token = 'test-bot-token-123';
  const user = { id: 6826458047, first_name: 'Rakib', username: 'rakib334' };
  const initData = auth.buildInitData(token, user, Math.floor(Date.now() / 1000));
  const r = auth.validateInitData(initData, token);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.user.id, 6826458047);
});
test('auth: tampered user data fails the hash check', () => {
  const token = 'test-bot-token-123';
  const user = { id: 6826458047, first_name: 'Rakib', username: 'rakib334' };
  let initData = auth.buildInitData(token, user, Math.floor(Date.now() / 1000));
  initData = initData.replace('rakib334', 'someone99');
  const r = auth.validateInitData(initData, token);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad_hash');
});
test('auth: stale auth_date is rejected', () => {
  const token = 'test-bot-token-123';
  const user = { id: 1, first_name: 'A' };
  const initData = auth.buildInitData(token, user, Math.floor(Date.now() / 1000) - 90000);
  const r = auth.validateInitData(initData, token);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'stale');
});
test('auth: missing hash is rejected', () => {
  const r = auth.validateInitData('auth_date=1700000000&user=%7B%22id%22%3A1%7D', 'tok');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_hash');
});

/* ================= summary ================= */
console.log(`\nMineSwap logic tests: ${pass} passed, ${fail} failed (total ${pass + fail})`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
