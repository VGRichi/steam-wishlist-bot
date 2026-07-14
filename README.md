# Steam Wishlist Bot

A Telegram bot that watches your Steam wishlist and pings you the moment a
specific tracked game goes on sale.

## How it works

- `/api/webhook` - responds instantly when a user messages the bot
  (add/remove games, set region). Deployed as a Vercel serverless function.
- `/api/cron` - runs every 24 hours, checks Steam prices for every tracked
  game (once per app+region combo, shared across all users), and notifies
  anyone whose game just went on sale.
- Supabase (Postgres) stores users, tracked games, and last-known prices.

## Test it

Message your bot on Telegram: `/start`

## Limits (MVP1)

- 10 tracked games per user
- Price checks every 24 hours
- Region is set once per user and applies to all their tracked games

## Notes on the unofficial Steam endpoints

`storesearch` and `appdetails` are not officially documented/supported by
Valve, but they're the same endpoints Steam's own store website uses, so
they're stable in practice. If Valve ever changes them, the fix is isolated
to `lib/steam.js`.
