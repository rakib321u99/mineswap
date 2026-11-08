// Market state persistence — loads the singleton market row, applies the
// lazy price update (see lib/price.js), and persists the result.
// No cron anywhere: the price only moves when someone reads it.
'use strict';

const { getOne, run } = require('./db');
const { getRuntime } = require('./runtime');
const price = require('./price');

async function loadMarket(nowMs) {
  const rt = await getRuntime();
  let row = await getOne('SELECT * FROM market WHERE id = 1');
  if (!row) {
    // First run: seed from runtime (env or admin-set) defaults.
    await run(
      `INSERT INTO market (id, price_nano, floor_nano, cap_nano, high24_nano, low24_nano,
        vol24_mine, window_start, price_updated_at, swaps24h)
       VALUES (1, ?, ?, ?, ?, ?, 0, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000), 0)
       ON DUPLICATE KEY UPDATE id = 1`,
      [rt.priceStartNano, rt.priceFloorNano, rt.priceCapNano,
       rt.priceStartNano, rt.priceStartNano, nowMs, nowMs]
    );
    row = await getOne('SELECT * FROM market WHERE id = 1');
  }
  // Admin-changed floor/cap apply to the stored row as well.
  if (Number(row.floor_nano) !== rt.priceFloorNano || Number(row.cap_nano) !== rt.priceCapNano) {
    await run('UPDATE market SET floor_nano = ?, cap_nano = ? WHERE id = 1',
      [rt.priceFloorNano, rt.priceCapNano]);
    row.floor_nano = rt.priceFloorNano;
    row.cap_nano = rt.priceCapNano;
  }
  const state = {
    priceNano: Number(row.price_nano),
    floorNano: Number(row.floor_nano),
    capNano: Number(row.cap_nano),
    updatedAtMs: new Date(row.price_updated_at).getTime(),
    high24Nano: Number(row.high24_nano),
    low24Nano: Number(row.low24_nano),
    vol24Mine: Number(row.vol24_mine),
    windowStartMs: new Date(row.window_start).getTime(),
    swaps24h: Number(row.swaps24h),
  };
  const before = state.priceNano;
  price.updatePrice(state, nowMs);
  if (state.priceNano !== before || state.updatedAtMs !== new Date(row.price_updated_at).getTime()) {
    await run(
      `UPDATE market SET price_nano = ?, high24_nano = ?, low24_nano = ?,
         vol24_mine = ?, window_start = FROM_UNIXTIME(? / 1000),
         price_updated_at = FROM_UNIXTIME(? / 1000), swaps24h = ? WHERE id = 1`,
      [state.priceNano, state.high24Nano, state.low24Nano, state.vol24Mine,
       state.windowStartMs, state.updatedAtMs, state.swaps24h]
    );
    // Keep a short history for the chart (one point per update at most).
    await run('INSERT INTO price_history (price_nano, recorded_at) VALUES (?, FROM_UNIXTIME(? / 1000))',
      [state.priceNano, nowMs]);
    await run(
      'DELETE FROM price_history WHERE id NOT IN (SELECT id FROM (SELECT id FROM price_history ORDER BY id DESC LIMIT 288) t)'
    );
  }
  return state;
}

// Apply sell pressure after a confirmed swap and persist.
async function applySwapPressure(mineSold, nowMs) {
  const state = await loadMarket(nowMs);
  const next = price.applySellPressure(state.priceNano, state.floorNano, state.capNano, mineSold);
  if (next === state.priceNano) return state;
  await run(
    `UPDATE market SET price_nano = ?, high24_nano = GREATEST(high24_nano, ?),
       low24_nano = LEAST(low24_nano, ?), vol24_mine = vol24_mine + ?, swaps24h = swaps24h + ? WHERE id = 1`,
    [next, next, next, mineSold, 1]
  );
  state.priceNano = next;
  return state;
}

async function getPriceHistory(limit = 96) {
  const { query } = require('./db');
  return query(
    'SELECT price_nano, UNIX_TIMESTAMP(recorded_at) * 1000 AS t FROM price_history ORDER BY id DESC LIMIT ?',
    [limit]
  );
}

module.exports = { loadMarket, applySwapPressure, getPriceHistory };
