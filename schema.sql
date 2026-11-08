-- MineSwap — MySQL schema (TiDB Cloud, database `mineswap`).
-- Apply AFTER creating the database:
--   mysql -h <host> -P 4000 -u <user> -p --ssl-mode=REQUIRED < schema.sql
-- Or from the TiDB Cloud console SQL editor.
-- All money is INTEGER: MINE is whole tokens, TON is nanoTON (1 TON = 1e9).
-- No secrets live in this file.

CREATE DATABASE IF NOT EXISTS mineswap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mineswap;

-- Users: one row per Telegram account (1 Telegram ID = 1 account).
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tg_id BIGINT NOT NULL,
  username VARCHAR(64) NOT NULL DEFAULT '',
  first_name VARCHAR(128) NOT NULL DEFAULT '',
  balance_mine INT NOT NULL DEFAULT 0,
  mining_active TINYINT(1) NOT NULL DEFAULT 0,
  mining_started_at DATETIME NULL,
  last_claim_at DATETIME NULL,
  claimed_today INT NOT NULL DEFAULT 0,
  claim_date DATE NULL,
  safety_passed TINYINT(1) NOT NULL DEFAULT 0,
  safety_code_hash CHAR(64) NOT NULL DEFAULT '',
  channel_status VARCHAR(32) NOT NULL DEFAULT '',
  channel_checked_at DATETIME NULL,
  banned TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_tg_id (tg_id),
  KEY idx_users_banned (banned)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily channel-post Likes (bot's own inline 👍 button). One per user per day.
CREATE TABLE IF NOT EXISTS likes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  like_date DATE NOT NULL,
  post_id VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_likes_user_date (user_id, like_date),
  KEY idx_likes_date (like_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ledger: every MINE movement (mining, safety, ad, swap lock/refund).
CREATE TABLE IF NOT EXISTS ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL,
  amount_mine INT NOT NULL,
  ref VARCHAR(128) NOT NULL DEFAULT '',
  ledger_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_user (user_id),
  KEY idx_ledger_date (ledger_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Market: singleton row (id = 1). Price in nanoTON per MINE.
CREATE TABLE IF NOT EXISTS market (
  id TINYINT UNSIGNED NOT NULL,
  price_nano BIGINT NOT NULL,
  floor_nano BIGINT NOT NULL,
  cap_nano BIGINT NOT NULL,
  high24_nano BIGINT NOT NULL,
  low24_nano BIGINT NOT NULL,
  vol24_mine BIGINT NOT NULL DEFAULT 0,
  window_start DATETIME NOT NULL,
  price_updated_at DATETIME NOT NULL,
  swaps24h INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price history for the chart (trimmed to the latest 288 points by the app).
CREATE TABLE IF NOT EXISTS price_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  price_nano BIGINT NOT NULL,
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ph_recorded (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Withdrawals (swaps): MINE locked on request, TON paid manually by admin.
CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  mine_amount INT NOT NULL,
  ton_nano BIGINT NOT NULL,
  price_nano BIGINT NOT NULL,
  wallet VARCHAR(100) NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  proof VARCHAR(512) NOT NULL DEFAULT '',
  admin_note VARCHAR(512) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_wd_user (user_id),
  KEY idx_wd_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings: admin-editable runtime values (override env defaults).
CREATE TABLE IF NOT EXISTS settings (
  skey VARCHAR(64) NOT NULL,
  svalue TEXT NOT NULL,
  PRIMARY KEY (skey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Math captchas for task verification (answer stored as SHA-256 hash only).
CREATE TABLE IF NOT EXISTS captchas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  question VARCHAR(64) NOT NULL,
  answer_hash CHAR(64) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_captcha_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rewarded ad views (daily cap enforcement).
CREATE TABLE IF NOT EXISTS ad_views (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(32) NOT NULL,
  view_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_user_date (user_id, view_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: market row + default settings (match the approved plan).
INSERT INTO market (id, price_nano, floor_nano, cap_nano, high24_nano, low24_nano,
  vol24_mine, window_start, price_updated_at, swaps24h)
VALUES (1, 100000, 50000, 500000, 100000, 100000, 0, NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE id = 1;

INSERT INTO settings (skey, svalue) VALUES
  ('mining_rate_per_hour', '7'),
  ('daily_cap_mine', '200'),
  ('swap_min_mine', '10000'),
  ('channel_username', 'F67Drop'),
  ('ad_reward_mine', '10'),
  ('ad_daily_cap', '10'),
  ('price_floor_nano', '50000'),
  ('price_cap_nano', '500000')
ON DUPLICATE KEY UPDATE svalue = VALUES(svalue);
