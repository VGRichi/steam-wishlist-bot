const db = require('../lib/db');
const steam = require('../lib/steam');
const tg = require('../lib/telegram');

const WELCOME = `👋 Welcome to <b>Steam Genie</b>!

I'll watch your Steam wishlist games and ping you the moment one goes on sale.

First, what's your region/country code? (e.g. <code>US</code>, <code>TR</code>, <code>AZ</code>, <code>DE</code>)
This makes sure prices are checked in your local currency.`;

const HELP = `Here's what I can do:

/addgame &lt;name&gt; — search and track a game (max ${db.MAX_GAMES_PER_USER})
/mylist — see your tracked games
/checknow — check current prices right now (doesn't wait for the daily check)
/removegame — stop tracking a game
/clearlist — remove ALL tracked games (asks to confirm)
/setregion — change your region/currency
/help — show this again`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');

  const update = req.body;

  try {
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
  } catch (err) {
    console.error('Webhook error:', err);
    // Still 200 - Telegram retries aggressively on non-200s, which would
    // just multiply the failure. Log and move on.
  }

  res.status(200).send('ok');
};

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (text.startsWith('/start')) {
    await db.setPendingAction(chatId, 'awaiting_region');
    await tg.sendMessage(chatId, WELCOME);
    return;
  }

  if (text.startsWith('/help')) {
    await tg.sendMessage(chatId, HELP);
    return;
  }

  if (text.startsWith('/setregion')) {
    await db.setPendingAction(chatId, 'awaiting_region');
    await tg.sendMessage(chatId, 'What region/country code should I use? (e.g. US, TR, AZ, DE)');
    return;
  }

  if (text.startsWith('/addgame')) {
    await handleAddGame(chatId, text.replace('/addgame', '').trim());
    return;
  }

  if (text.startsWith('/mylist')) {
    await handleMyList(chatId);
    return;
  }

  if (text.startsWith('/removegame')) {
    await handleRemoveGameMenu(chatId);
    return;
  }

  if (text.startsWith('/checknow')) {
    await handleCheckNow(chatId);
    return;
  }

  if (text.startsWith('/clearlist')) {
    await handleClearListConfirm(chatId);
    return;
  }

  // Not a command - check if we're mid-conversation waiting for a region code
  const user = await db.getUser(chatId);
  if (user && user.pending_action === 'awaiting_region') {
    await handleRegionInput(chatId, text);
    return;
  }

  await tg.sendMessage(chatId, "Not sure what you mean. Send /help to see what I can do.");
}

async function handleRegionInput(chatId, text) {
  const code = text.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    await tg.sendMessage(chatId, 'That doesn\'t look like a country code. Please send a 2-letter code, e.g. US, TR, AZ.');
    return;
  }
  if (!steam.isKnownRegion(code)) {
    await tg.sendMessage(chatId, `⚠️ I don't recognize "${code}" as a common region, but I'll use it anyway - let me know if prices look wrong.`);
  }
  await db.upsertUserRegion(chatId, code);
  await tg.sendMessage(chatId, `✅ Region set to ${code}.\n\n${HELP}`);
}

async function handleAddGame(chatId, query) {
  if (!query) {
    await tg.sendMessage(chatId, 'Usage: /addgame <name>\nExample: /addgame cyberpunk');
    return;
  }

  const user = await db.getUser(chatId);
  const region = (user && user.region_code) || 'US';

  const count = await db.countTrackedGames(chatId);
  if (count >= db.MAX_GAMES_PER_USER) {
    await tg.sendMessage(chatId, `You're already tracking the max of ${db.MAX_GAMES_PER_USER} games. Use /removegame to free up a slot.`);
    return;
  }

  let results;
  try {
    results = await steam.searchGames(query, region);
  } catch (err) {
    console.error('Search failed:', err);
    await tg.sendMessage(chatId, "Steam's search is being flaky right now - try again in a bit.");
    return;
  }

  if (!results.length) {
    await tg.sendMessage(chatId, `Couldn't find anything matching "${query}". Try a different search term.`);
    return;
  }

  const buttons = results.map((r) => ({
    text: r.name,
    callback_data: `addgame:${r.appId}`,
  }));

  await tg.sendMessage(chatId, `Found these matches for "${query}" - tap the right one:`, tg.inlineKeyboard(buttons));
}

async function handleMyList(chatId) {
  const games = await db.getTrackedGames(chatId);
  if (!games.length) {
    await tg.sendMessage(chatId, "You're not tracking any games yet. Use /addgame <name> to start.");
    return;
  }

  const lines = games.map((g) => `🎮 ${g.game_name}`);
  await tg.sendMessage(chatId, `<b>Your tracked games (${games.length}/${db.MAX_GAMES_PER_USER}):</b>\n\n${lines.join('\n')}`);
}

async function handleRemoveGameMenu(chatId) {
  const games = await db.getTrackedGames(chatId);
  if (!games.length) {
    await tg.sendMessage(chatId, "You're not tracking anything to remove.");
    return;
  }

  const buttons = games.map((g) => ({
    text: g.game_name,
    callback_data: `removegame:${g.app_id}`,
  }));

  await tg.sendMessage(chatId, 'Tap a game to stop tracking it:', tg.inlineKeyboard(buttons));
}

async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data || '';

  if (data.startsWith('addgame:')) {
    const appId = parseInt(data.split(':')[1], 10);
    await confirmAddGame(chatId, appId, callbackQuery.id);
    return;
  }

  if (data.startsWith('removegame:')) {
    const appId = parseInt(data.split(':')[1], 10);
    await db.removeTrackedGame(chatId, appId);
    await tg.answerCallbackQuery(callbackQuery.id, 'Removed.');
    await tg.sendMessage(chatId, '✅ Stopped tracking that game.');
    return;
  }

  if (data === 'clearlist:confirm') {
    await db.clearTrackedGames(chatId);
    await tg.answerCallbackQuery(callbackQuery.id, 'Cleared.');
    await tg.sendMessage(chatId, '✅ Your tracked games list is now empty.');
    return;
  }

  if (data === 'clearlist:cancel') {
    await tg.answerCallbackQuery(callbackQuery.id, 'Cancelled.');
    await tg.sendMessage(chatId, 'No changes made.');
    return;
  }

  await tg.answerCallbackQuery(callbackQuery.id);
}

async function handleCheckNow(chatId) {
  const games = await db.getTrackedGames(chatId);
  if (!games.length) {
    await tg.sendMessage(chatId, "You're not tracking any games yet. Use /addgame <name> to start.");
    return;
  }

  const user = await db.getUser(chatId);
  const region = (user && user.region_code) || 'US';

  await tg.sendMessage(chatId, `Checking ${games.length} game(s), one sec...`);

  const lines = [];
  for (const game of games) {
    try {
      const details = await steam.getAppDetails(game.app_id, region);
      if (!details) {
        lines.push(`❓ ${game.game_name} — couldn't fetch right now`);
      } else if (details.discountPercent > 0) {
        const priceText = steam.formatPrice(details.priceCents, details.currency);
        lines.push(`🔥 ${details.name} — ${details.discountPercent}% off, now ${priceText}`);
      } else {
        const priceText = details.isFree ? 'Free' : steam.formatPrice(details.priceCents, details.currency);
        lines.push(`— ${details.name} — no sale (${priceText})`);
      }
    } catch (err) {
      console.error(`checknow error for app ${game.app_id}:`, err);
      lines.push(`❓ ${game.game_name} — error checking`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await tg.sendMessage(chatId, lines.join('\n'));
}

async function handleClearListConfirm(chatId) {
  const games = await db.getTrackedGames(chatId);
  if (!games.length) {
    await tg.sendMessage(chatId, "You're not tracking anything - nothing to clear.");
    return;
  }
  await tg.sendMessage(
    chatId,
    `This will remove all ${games.length} tracked game(s). Are you sure?`,
    tg.inlineKeyboard([
      { text: '✅ Yes, clear my list', callback_data: 'clearlist:confirm' },
      { text: '❌ Cancel', callback_data: 'clearlist:cancel' },
    ])
  );
}

async function confirmAddGame(chatId, appId, callbackQueryId) {
  const user = await db.getUser(chatId);
  const region = (user && user.region_code) || 'US';

  const details = await steam.getAppDetails(appId, region);
  if (!details) {
    await tg.answerCallbackQuery(callbackQueryId, 'Could not find that game.');
    return;
  }

  const result = await db.addTrackedGame(chatId, appId, details.name);
  await tg.answerCallbackQuery(callbackQueryId);

  if (result.reason === 'duplicate') {
    await tg.sendMessage(chatId, `Already tracking <b>${details.name}</b>.`);
    return;
  }
  if (result.reason === 'limit') {
    await tg.sendMessage(chatId, `You're at the max of ${db.MAX_GAMES_PER_USER} games. Remove one first with /removegame.`);
    return;
  }

  await tg.sendMessage(chatId, `✅ Now tracking: <b>${details.name}</b>\nI'll ping you here when it goes on sale.`);
}
