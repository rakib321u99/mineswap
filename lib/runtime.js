// Runtime settings — DB settings table overrides env defaults.
// The admin panel writes these keys; the app reads them (60s cache).
// Key names match the settings table and the admin allow-list.
'use strict';

const { config } = require('./config');
const { query } = require('./db');

let cache = null;
let cacheAt = 0;
const CACHE_MS = 60 * 1000;

const INT_KEYS = {
  mining_rate_per_hour: 'miningRatePerHour',
  daily_cap_mine: 'dailyCapMine',
  swap_min_mine: 'swapMinMine',
  ad_reward_mine: 'adRewardMine',
  ad_daily_cap: 'adDailyCap',
  price_floor_nano: 'priceFloorNano',
  price_cap_nano: 'priceCapNano',
};

const STR_KEYS = {
  channel_username: 'channelUsername',
  channel_id: 'channelId',
  monetag_id: 'monetagId',
  monetag_sdk_src: 'monetagSdkSrc',
  adsterra_id: 'adsterraId',
  adsterra_invoke_domain: 'adsterraInvokeDomain',
  adsgram_block_id: 'adsgramBlockId',
  gigapub_id: 'gigapubId',
  today_post_url: 'todayPostUrl',
};

async function getRuntime() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  const rt = {
    miningRatePerHour: config.miningRatePerHour,
    dailyCapMine: config.dailyCapMine,
    swapMinMine: config.swapMinMine,
    adRewardMine: config.adRewardMine,
    adDailyCap: config.adDailyCap,
    priceFloorNano: config.priceFloorNano,
    priceCapNano: config.priceCapNano,
    priceStartNano: config.priceStartNano,
    channelUsername: config.channelUsername,
    channelId: config.channelId,
    monetagId: config.monetagId,
    monetagSdkSrc: config.monetagSdkSrc,
    adsterraId: config.adsterraId,
    adsterraInvokeDomain: config.adsterraInvokeDomain,
    adsgramBlockId: config.adsgramBlockId,
    gigapubId: config.gigapubId,
    todayPostUrl: '',
  };
  try {
    const rows = await query('SELECT skey, svalue FROM settings');
    for (const r of rows) {
      const k = r.skey;
      if (INT_KEYS[k]) {
        const n = parseInt(r.svalue, 10);
        if (Number.isFinite(n) && n > 0) rt[INT_KEYS[k]] = n;
      } else if (STR_KEYS[k]) {
        rt[STR_KEYS[k]] = String(r.svalue);
      }
    }
  } catch (_) {
    // DB unreachable or table missing: fall back to env defaults.
  }
  cache = rt;
  cacheAt = now;
  return rt;
}

function clearRuntimeCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = { getRuntime, clearRuntimeCache, INT_KEYS, STR_KEYS };
