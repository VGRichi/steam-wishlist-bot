# Steam Wishlist Bot 

A free Telegram bot that watches your Steam wishlist and pings you the
moment a game goes on sale - with custom alert rules per game, so you only
hear about the deals you actually care about.

## Get started

Just open the bot on Telegram and send `/start`. You'll be asked for your
region/country code (e.g. `US`, `TR`, `AZ`, `DE`) so prices are checked in
your local currency, then you're ready to go.

Everything after that is done through the button menu - no commands to
memorize.

## What it does

- **📋 My List** - see your tracked games and their last-known sale status
- **➕ Add Game** - search for a game by name, tap the right match, then
  choose how you want to be alerted:
  - 🔔 **Any discount** - notify the moment it's on sale at all
  - 📊 **% threshold** - only notify at, say, 30% off or more
  - 💰 **Price threshold** - only notify once it drops under a price you set
  - 🎯 **Both** - either condition triggers the alert
- **🔄 Check Now** - check all your tracked games against Steam live, right
  now, instead of waiting for the next daily check. Discounted games are
  shown first, sorted by biggest discount, with a direct "Buy now!" link
  for anything 50%+ off.
- **➖ Remove Game** - tap a game to stop tracking it
- **🗑 Clear List** - remove everything you're tracking at once (asks you
  to confirm first)
- **🌍 Set Region** - your current region shows as a flag right on the
  button; tap to change it any time

The bot checks prices once a day and only notifies you the first time your
alert condition becomes true - not every single day a sale happens to still
be running.

## Limits

- Up to 10 tracked games per person
- Prices checked once daily
- To change a game's alert threshold, remove it and add it again with new
  settings

## A note on data

The bot only stores what it needs to do its job: your Telegram chat ID,
your chosen region, and the games/thresholds you set up. Nothing else.

## Feedback / issues

Found a bug or have an idea? Contact me!
