// MineSwap config — env vars only. No secrets live in this file.
// Every value has a safe default matching the approved plan.
'use strict';

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const config = {
  botToken: envStr('BOT_TOKEN', ''),
  botUsername: envStr('BOT_USERNAME', 'MineSwapEarnBot'),
  webAppUrl: envStr('WEBAPP_URL', ''),
  ownerTgId: envInt('OWNER_TG_ID', 6826458047),
  adminPassword: envStr('ADMIN_PASSWORD', ''),

  dbHost: envStr('DB_HOST', ''),
  dbPort: envInt('DB_PORT', 4000),
  dbName: envStr('DB_NAME', 'mineswap'),
  dbUser: envStr('DB_USER', ''),
  dbPass: envStr('DB_PASS', ''),
  dbSsl: envStr('DB_SSL', '1') === '1',

  channelUsername: envStr('CHANNEL_USERNAME', 'F67Drop'),
  channelId: envStr('CHANNEL_ID', ''),

  // Price engine: nanoTON per MINE (1 TON = 1,000,000,000 nanoTON).
  // Start 0.0001 TON, floor 0.00005 TON, cap 0.0005 TON per MINE.
  priceStartNano: envInt('PRICE_START_NANO', 100000),
  priceFloorNano: envInt('PRICE_FLOOR_NANO', 50000),
  priceCapNano: envInt('PRICE_CAP_NANO', 500000),

  miningRatePerHour: envInt('MINING_RATE_PER_HOUR', 7),
  dailyCapMine: envInt('DAILY_CAP_MINE', 200),
  swapMinMine: envInt('SWAP_MIN_MINE', 10000),

  // Ads (placeholders until the owner pastes real publisher IDs).
  monetagId: envStr('MONETAG_ID', ''),
  monetagSdkSrc: envStr('MONETAG_SDK_SRC', ''),
  adsterraId: envStr('ADSTERRA_ID', ''),
  adsterraInvokeDomain: envStr('ADSTERRA_INVOKE_DOMAIN', 'www.highperformanceformat.com'),
  adsgramBlockId: envStr('ADSGRAM_BLOCK_ID', ''),
  gigapubId: envStr('GIGAPUB_ID', ''),
  adRewardMine: envInt('AD_REWARD_MINE', 10),
  adDailyCap: envInt('AD_DAILY_CAP', 10),

  safetyRewardMine: 25,
};

module.exports = { config, envInt, envStr };
