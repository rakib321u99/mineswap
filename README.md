# MineSwap — Telegram Mini App Bot

Mine MINE tokens every day, watch the simulated MINE/TON market, and swap
to TON (Gram). Node.js serverless on **Vercel** + **TiDB Cloud MySQL**.
Original code and design — nothing copied from any other bot or site.

**The plan (source of truth):** `~/workspace/your_files/mineswap-plan.md`
**Bot:** @MineSwapEarnBot (created 2026-11-08; @MineSwapBot was taken)

## Rules (from the plan)

- **Mining:** ~7 MINE/hour, claimable anytime, **daily cap 200 MINE**.
  At the max rate the first withdrawal (10,000 MINE) takes ~60 days.
- **Swap / withdraw:** minimum **10,000 MINE**. The app shows the TON
  (Gram) amount at the current market price **before** confirming.
- **Channel gate:** swap requires the user to be joined in the owner's
  channel (Earnix.pro, `F67Drop`). Leaving the channel blocks the swap —
  checked fresh via `getChatMember` at swap time.
- **Daily Like:** every day the user must Like the channel post. The Like
  is tracked via the bot's own inline 👍 button on the post (real Telegram
  reaction likes **cannot** be verified by the Bot API). The Like gates the
  daily mining Claim.
- **Market:** the MINE/TON price is **simulated inside the bot** — the token
  is not listed on any real exchange. Price moves with swap pressure (more
  selling → down) + a small random walk, clamped to a floor and a cap.
  No cron: the price updates **lazily** on each read.
- **Payouts are manual:** the admin sends the TON, uploads proof, and
  approves; or rejects with a reason (MINE is refunded). Every decision is
  messaged to the user by the bot.
- **Ads:** Monetag + Adsterra (banner/native) + Adsgram + Giga.pub
  (rewarded). Popunders **never**. Rewarded credit (+10 MINE) needs a
  solved math captcha and is capped daily.
- **Anti-cheat:** Quick Safety Check (3-digit code, +25 MINE, before first
  earning), math captcha on task verify, 1 Telegram ID = 1 account, daily
  caps, admin ban.

## Project layout

```
mineswap/
  api/
    webhook.js    Telegram webhook: /start, /admin, 👍 Like callbacks
    miniapp.js    Mini App backend (state, mining, claim, market, swap, ads)
    admin.js      Admin panel backend (login, stats, withdrawals, users, post)
  lib/
    config.js     env parsing + defaults (no secrets in code)
    runtime.js    DB settings override env defaults (60s cache)
    db.js         mysql2 pool (TiDB, TLS)
    auth.js       Telegram WebApp initData validation (HMAC)
    mining.js     accrual math + daily cap (pure)
    price.js      price engine: drift, pressure, floor/cap (pure)
    gates.js      claim/swap gates, TON math (pure)
    ton.js        TON wallet address validation (pure)
    captcha.js    math captcha (pure)
    telegram.js   Bot API client
    ledger.js     every MINE movement goes through here
    marketStore.js market row persistence + lazy update
    users.js      users, safety codes, likes, settings
  public/
    index.html / app.js / style.css   Mini App (5 tabs: Mine, Market, Swap, Tasks, Profile)
  admin/
    index.html    Admin panel UI (password-gated)
  schema.sql      MySQL schema for the `mineswap` database
  test/test.js    Logic tests (pure Node, no DB/network)
  package.json / vercel.json / .env.example
```

## Environment variables (exact names)

Copy `.env.example` to `.env.local` for local runs, or set the same names
in **Vercel → Project → Settings → Environment Variables**. Never commit
real values.

| Variable | Required | Purpose |
|---|---|---|
| `BOT_TOKEN` | yes | From @BotFather (for @MineSwapEarnBot) |
| `BOT_USERNAME` | yes | `mineswapearnbot` (no @) |
| `WEBAPP_URL` | yes | `https://<project>.vercel.app` |
| `DB_HOST` | yes | TiDB Cloud host |
| `DB_PORT` | no (4000) | TiDB port |
| `DB_NAME` | no (`mineswap`) | Database name |
| `DB_USER` | yes | TiDB user |
| `DB_PASS` | yes | TiDB password |
| `DB_SSL` | no (`1`) | TLS on |
| `OWNER_TG_ID` | yes | Owner Telegram ID (`6826458047`) |
| `ADMIN_PASSWORD` | yes | Admin panel password (choose a strong one) |
| `CHANNEL_USERNAME` | no (`F67Drop`) | Gate channel |
| `CHANNEL_ID` | no | Numeric channel ID (optional, faster than @name) |
| `PRICE_START_NANO` | no (100000) | Start price, nanoTON per MINE (0.0001 TON) |
| `PRICE_FLOOR_NANO` | no (50000) | Price floor (0.00005 TON) |
| `PRICE_CAP_NANO` | no (500000) | Price cap (0.0005 TON) |
| `MINING_RATE_PER_HOUR` | no (7) | MINE per hour |
| `DAILY_CAP_MINE` | no (200) | Daily claim cap |
| `SWAP_MIN_MINE` | no (10000) | Minimum swap |
| `MONETAG_ID` / `MONETAG_SDK_SRC` | no | Monetag zone ID + SDK script URL |
| `ADSTERRA_ID` | no | Adsterra placement key |
| `ADSTERRA_INVOKE_DOMAIN` | no | Adsterra invoke domain |
| `ADSGRAM_BLOCK_ID` | no | Adsgram block ID |
| `GIGAPUB_ID` | no | Giga.pub project ID |
| `AD_REWARD_MINE` | no (10) | MINE per rewarded ad |
| `AD_DAILY_CAP` | no (10) | Rewarded ads per day |
| `TELEGRAM_WEBHOOK_SECRET` | no | Optional webhook shared secret |

## Local test

```bash
npm install
npm test          # node test/test.js — 50 pure-logic assertions, no DB/network
```

## Deploy (Vercel CLI)

```bash
npm i -g vercel
cd mineswap
vercel login
vercel            # preview deploy; answer the prompts
vercel env add BOT_TOKEN production
# ... repeat for every variable in the table above ...
vercel --prod
```

1. **Database (TiDB Cloud, cluster `orbit-earn`):**
   - Create a **new database named `mineswap`** on the existing cluster.
     Do NOT touch the `orbit_earn` database.
   - Apply `schema.sql` (it also creates the DB if missing):
     `mysql -h <host> -P 4000 -u <user> -p --ssl-mode=REQUIRED < schema.sql`
2. **Set the Telegram webhook** (replace `<TOKEN>` and `<URL>`):
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>/api/webhook"`
   Or in @BotFather: /setmenubutton → Web App URL = `<URL>`.
3. **Open the bot, press /start**, then open the Mini App and check the
   safety code arrives.
4. **Admin panel:** `<URL>/admin/` → sign in with `ADMIN_PASSWORD`.
   Set ad IDs (Settings), publish the first daily post (Daily Post tab),
   and approve the first test swap end-to-end.
5. **Channel:** make the bot an admin of the channel (needed for
   `getChatMember` checks on private channels; public channels work
   without it).

## Honest limitations (do not hide these)

- The market price is **simulated**, not a real exchange price. The TON
  paid out comes from ad revenue + the owner's reserve — swapping does
  not create real TON.
- Rewarded-ad credit currently trusts the provider SDK's client-side
  completion event + a solved captcha + daily caps. For production,
  wire each provider's **server-side callback** to the `ad_view` endpoint
  before enabling real payouts from ads.
- The daily Like is verified through the bot's own 👍 button, not through
  Telegram's native reactions (the Bot API cannot see those).
- `/admin` in chat answers only for `OWNER_TG_ID`; everyone else gets
  silence.
