# MineSwap — Build Spec (for the builder agent)

**Source of truth:** `~/workspace/your_files/mineswap-plan.md` — read it FIRST (Bengali plan, all rules).
**Design reference:** `~/workspace/imagine_media/media-generation-mineswap-design-all-sections-0-156f772e-c116-45e7-a3a9-b2b1335368ff.webp` — 5 phone screens (Mine, Market, Swap, Tasks, Profile), dark navy + green/gold. Mockup NUMBERS are illustrative only; real rates come from the plan.

## Hosting decision (user's order: NOT InfinityFree)

- **Vercel free Hobby, Node.js serverless** — `api/webhook.js` (Telegram webhook), `api/miniapp.js` (Mini App backend), static Mini App in `/public` (index.html, app.js, style.css).
- **Database: TiDB Cloud MySQL, existing cluster `orbit-earn`.** Connection details live in `~/workspace/orbit-earn-bot/config.php` — read host/user from there, use them ONLY to connect. **Create a NEW database `mineswap` on that cluster; NEVER touch the orbit database or its tables.** If TiDB is unreachable from here, STOP and report to the parent — do not silently switch providers.
- No cron available: the market price must update **lazily** (computed on each request from stored state + elapsed time + trade pressure), never via a scheduled job.

## Features (all from the plan — do not add extra earning systems)

1. **Mining:** Start Mining → accrues ~7 MINE/hour, claimable anytime, **daily cap 200 MINE**. Claim requires today's channel-post Like (see 3).
2. **Channel-join gate:** Swap/Withdraw checks `getChatMember` on the owner's channel (env `CHANNEL_USERNAME`, default `F67Drop` / Earnix.pro; numeric channel id resolved at deploy via env `CHANNEL_ID`). Not joined → Swap disabled with "join channel" prompt. Leaving = blocked on next check.
3. **Daily Like:** each channel post carries the bot's inline 👍 Like button (callback records the like in DB); in-app Tasks tab links to today's post. Real Telegram reaction likes CANNOT be verified by Bot API — use the bot's own button only. Like gates the daily Claim.
4. **Market price engine:** MINE/TON price, stored in DB, moves with swap pressure (more selling → down, more holding/buying → up) + small random walk; hard floor and cap (env-configurable, defaults: floor 0.00005 TON, cap 0.0005 TON, start 0.0001 TON per MINE). 24h high/low/volume tracked. Lazy update, no cron.
5. **Swap / Withdraw:** min **10,000 MINE**. Shows TON (Gram) at current price BEFORE confirming. Collects TON wallet address. Creates a manual withdrawal request (status pending). Admin approves (after sending + proof upload) or rejects with reason; every decision sends the user a bot message.
6. **Tasks tab:** channel join status, today's Like task, Watch Ad task.
7. **Ads (placeholders only — no real publisher IDs):** Monetag + Adsterra web slots in the Mini App; Adsgram + Giga.pub rewarded (Watch Ad → +10 MINE, optional, env-toggleable). SDK integration points + env vars (`MONETAG_ID`, `ADSTERRA_ID`, `ADSGRAM_BLOCK_ID`, `GIGAPUB_ID`); credit only after completion callback + server-side verification. Popunders NEVER.
8. **Admin:** `/admin` chat command opens ONLY for `OWNER_TG_ID=6826458047` (env), silent for everyone else. Web admin panel, password-gated (env `ADMIN_PASSWORD`, placeholder only in repo): mining rate/cap, channel, ad IDs, withdrawals list (approve/reject + proof upload), user ban.
9. **Anti-cheat:** Quick Safety Check (3-digit code, +25 MINE, before first earning), math captcha on task verify, 1 Telegram ID = 1 account, daily caps, admin ban.
10. **Profile tab:** balance, mining history, swap history, withdrawal status.

## Security (hard rules)

- **NO secrets in files, chat, logs, or tests.** `BOT_TOKEN`, DB password, `ADMIN_PASSWORD` exist ONLY as env vars. Ship `.env.example` with placeholder values only.
- Never print a secret, token, or DB password in any output, test log, or README.
- Original design/text only — do not copy any other site or bot.

## Deliverables (in `~/workspace/mineswap/`)

- Full code: `api/`, `public/`, `schema.sql` (MySQL, `mineswap` DB), `admin/`, `package.json`, `vercel.json`, `.env.example`, `README.md` (Vercel CLI deploy steps + env var list + how to set the Telegram webhook).
- `test/` — Node test script covering: mining accrual math, 200/day cap, Like-gates-Claim, channel-gate logic, price engine (floor/cap/pressure direction), swap validation (min 10,000, gates). Run it and report the pass count.
- **BUILD + LOCAL TEST ONLY. Do NOT deploy, do NOT create the bot in BotFather, do NOT create any external account, do NOT contact Telegram's API with a real token (there is none).** The parent handles BotFather + deploy.

## What to report back

- Files created, test results (pass/total), any rule from the plan you could not implement and why, and the exact env var names the deploy needs.
