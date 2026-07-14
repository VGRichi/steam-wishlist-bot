# Steam Genie Bot

A Telegram bot that watches your Steam wishlist and pings you the moment a
tracked game goes on sale. Runs entirely on free tiers (Vercel + Supabase +
Telegram) - no server to pay for, no API keys to buy.

## How it works

- `/api/webhook` - responds instantly when a user messages the bot
  (add/remove games, set region). Deployed as a Vercel serverless function.
- `/api/cron` - runs every 12 hours, checks Steam prices for every tracked
  game (once per app+region combo, shared across all users), and notifies
  anyone whose game just went on sale.
- Supabase (Postgres) stores users, tracked games, and last-known prices.

## Setup

### 1. Supabase

1. Create a free project at supabase.com
2. Go to the SQL editor, paste the contents of `schema.sql`, run it
3. Go to Project Settings > API, copy the **Project URL** and the
   **service_role key** (not the anon key - we need write access)

### 2. Environment variables

Copy `.env.example` to `.env` and fill in:

```
TELEGRAM_BOT_TOKEN=<from @BotFather>
SUPABASE_URL=<from Supabase>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase>
CRON_SECRET=<generate with: openssl rand -hex 16>
```

Never commit `.env` - it's already in `.gitignore`.

### 3. Deploy to Vercel

1. Push this repo to GitHub
2. Import it in Vercel (vercel.com > New Project)
3. Add the same environment variables from `.env` in Vercel's Project
   Settings > Environment Variables
4. Deploy

Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` to
scheduled jobs when a `CRON_SECRET` env var is set on the project - this is
what `/api/cron` checks against, so no extra wiring needed.

### 4. Register the webhook

After your first deploy, tell Telegram where to send messages:

```
npm install
node scripts/set-webhook.js https://your-project.vercel.app
```

You should get back `{"ok":true,"result":true,...}`.

### 5. Test it

Message your bot on Telegram: `/start`

## Limits (MVP1)

- 10 tracked games per user
- Price checks every 12 hours
- Region is set once per user and applies to all their tracked games

## Notes on the unofficial Steam endpoints

`storesearch` and `appdetails` are not officially documented/supported by
Valve, but they're the same endpoints Steam's own store website uses, so
they're stable in practice. If Valve ever changes them, the fix is isolated
to `lib/steam.js`.
