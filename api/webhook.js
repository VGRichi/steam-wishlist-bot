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

const MENU = {
  LIST: '📋 My List',
  ADD: '➕ Add Game',
  CHECK: '🔄 Check Now',
  REMOVE: '➖ Remove Game',
  CLEAR: '🗑 Clear List',
  REGION_PREFIX: '🌍 Set Region',
};

async function buildMainMenu(chatId) {
  const user = await db.getUser(chatId);
  const flag = user && user.region_code ? tg.flagEmoji(user.region_code) : '🏳️';
  return tg.replyKeyboard([
    [MENU.LIST, MENU.ADD],
    [MENU.CHECK, MENU.REMOVE],
    [MENU.CLEAR, `${MENU.REGION_PREFIX} ${flag}`],
  ]);
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (text === '/start') {
    await db.setPendingAction(chatId, 'awaiting_region');
    await tg.sendMessage(chatId, WELCOME);
    return;
  }

  if (text === MENU.LIST) {
    await handleMyList(chatId);
    return;
  }

  if (text === MENU.ADD) {
    await db.setPendingAction(chatId, 'awaiting_addgame_query');
    await tg.sendMessage(chatId, 'Type the name of the game to search for:');
    return;
  }

  if (text === MENU.CHECK) {
    await handleCheckNow(chatId);
    return;
  }

  if (text === MENU.REMOVE) {
    await handleRemoveGameMenu(chatId);
    return;
  }

  if (text === MENU.CLEAR) {
    await handleClearListConfirm(chatId);
    return;
  }

  if (text.startsWith(MENU.REGION_PREFIX)) {
    await db.setPendingAction(chatId, 'awaiting_region');
    await tg.sendMessage(chatId, 'What region/country code should I use? (e.g. US, TR, AZ, DE)');
    return;
  }

  const user = await db.getUser(chatId);
  if (user && user.pending_action === 'awaiting_region') {
    await handleRegionInput(chatId, text);
    return;
  }
  if (user && user.pending_action === 'awaiting_addgame_query') {
    await db.setPendingAction(chatId, null);
    await handleAddGame(chatId, text);
    return;
  }

if (user && user.pending_action === 'awaiting_percent_value') {
    await handlePercentInput(chatId, text, user.pending_data);
    return;
  }
  if (user && user.pending_action === 'awaiting_price_value') {
    await handlePriceInput(chatId, text, user.pending_data);
    return;
  }

  await tg.sendMessage(chatId, "Not sure what you mean - use the menu buttons below.", await buildMainMenu(chatId));
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
  await tg.sendMessage(chatId, `✅ Region set to ${code}.`, await buildMainMenu(chatId));
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

async function handleFilterChoice(chatId, choice, callbackQueryId) {
  const user = await db.getUser(chatId);
  const pending = user && user.pending_data;
  if (!pending || !pending.appId) {
    await tg.answerCallbackQuery(callbackQueryId, 'Something went wrong - try adding the game again.');
    return;
  }

  await tg.answerCallbackQuery(callbackQueryId);

  if (choice === 'filter:any') {
    await finalizeAddGame(chatId, pending.appId, pending.gameName, null, null);
    return;
  }
  if (choice === 'filter:percent') {
    await db.setPendingAction(chatId, 'awaiting_percent_value', { ...pending, needsPriceAfter: false });
    await tg.sendMessage(chatId, 'Type the discount % to notify at (e.g. 30 for 30% off or more):');
    return;
  }
  if (choice === 'filter:price') {
    await db.setPendingAction(chatId, 'awaiting_price_value', { ...pending, needsPriceAfter: false });
    await tg.sendMessage(chatId, "Type the price to notify below, in your region's currency (e.g. 15):");
    return;
  }
  if (choice === 'filter:both') {
    await db.setPendingAction(chatId, 'awaiting_percent_value', { ...pending, needsPriceAfter: true });
    await tg.sendMessage(chatId, 'Type the discount % threshold first (e.g. 30):');
    return;
  }
}

async function finalizeAddGame(chatId, appId, gameName, thresholdPercent, thresholdPriceCents) {
  const user = await db.getUser(chatId);
  const region = (user && user.region_code) || 'US';

  let initialConditionMet = false;
  try {
    const details = await steam.getAppDetails(appId, region);
    if (details) {
      initialConditionMet = steam.meetsCondition(thresholdPercent, thresholdPriceCents, details.discountPercent, details.priceCents);
    }
  } catch (err) {
    console.error('finalizeAddGame price check failed:', err);
  }

  const result = await db.addTrackedGame(chatId, appId, gameName, {
    thresholdPercent,
    thresholdPriceCents,
    initialConditionMet,
  });

  await db.setPendingAction(chatId, null, null);

  if (result.reason === 'duplicate') {
    await tg.sendMessage(chatId, `Already tracking <b>${gameName}</b>.`);
    return;
  }
  if (result.reason === 'limit') {
    await tg.sendMessage(chatId, `You're at the max of ${db.MAX_GAMES_PER_USER} games. Remove one first with /removegame.`);
    return;
  }

  let msg = `✅ Now tracking: <b>${gameName}</b>`;
  if (thresholdPercent != null) msg += `\nNotify at ${thresholdPercent}%+ off`;
  if (thresholdPriceCents != null) msg += `\nNotify below ${steam.formatPrice(thresholdPriceCents, '')}`;
  if (thresholdPercent == null && thresholdPriceCents == null) msg += `\nNotify on any discount`;
  if (initialConditionMet) msg += `\n\n🔥 Heads up - it already meets this right now!`;

  await tg.sendMessage(chatId, msg);
}

async function handlePercentInput(chatId, text, pending) {
  const value = parseInt(text.trim().replace('%', ''), 10);
  if (isNaN(value) || value <= 0 || value > 100) {
    await tg.sendMessage(chatId, 'Please type a number between 1 and 100 (e.g. 30).');
    return;
  }
  if (pending.needsPriceAfter) {
    await db.setPendingAction(chatId, 'awaiting_price_value', { ...pending, thresholdPercent: value, needsPriceAfter: false });
    await tg.sendMessage(chatId, `Got it - ${value}%. Now type the price threshold too (e.g. 15):`);
    return;
  }
  await finalizeAddGame(chatId, pending.appId, pending.gameName, value, null);
}

async function handlePriceInput(chatId, text, pending) {
  const value = parseFloat(text.trim().replace(/[^0-9.]/g, ''));
  if (isNaN(value) || value <= 0) {
    await tg.sendMessage(chatId, 'Please type a valid price (e.g. 15 or 15.99).');
    return;
  }
  const cents = Math.round(value * 100);
  const percentAlreadySet = pending.thresholdPercent != null ? pending.thresholdPercent : null;
  await finalizeAddGame(chatId, pending.appId, pending.gameName, percentAlreadySet, cents);
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

if (data.startsWith('filter:')) {
    await handleFilterChoice(chatId, data, callbackQuery.id);
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

  const checked = [];
  for (const game of games) {
    try {
      const details = await steam.getAppDetails(game.app_id, region);
      checked.push({ game, details, error: false });
    } catch (err) {
      console.error(`checknow error for app ${game.app_id}:`, err);
      checked.push({ game, details: null, error: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // Discounted games first (biggest discount on top), then everything else in the order they were originally tracked.
  checked.sort((a, b) => {
    const discountA = a.details ? a.details.discountPercent : -1;
    const discountB = b.details ? b.details.discountPercent : -1;
    return discountB - discountA;
  });

  const lines = checked.map((entry, index) => {
    const num = index + 1;
    const { game, details, error } = entry;
    if (error || !details) {
      return `${num}. ❓ ${game.game_name} — couldn't fetch right now`;
    }
    if (details.discountPercent > 0) {
      const priceText = steam.formatPrice(details.priceCents, details.currency);
      let line = `${num}. 🔥 ${details.name} — ${details.discountPercent}% off, now ${priceText}`;
      if (details.discountPercent >= 50) {
        line += ` — Buy now: ${steam.appStoreUrl(game.app_id)}`;
      }
      return line;
    }
    const priceText = details.isFree ? 'Free' : steam.formatPrice(details.priceCents, details.currency);
    return `${num}. — ${details.name} — no sale (${priceText})`;
  });

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

  const already = await db.isTrackingGame(chatId, appId);
  if (already) {
    await tg.answerCallbackQuery(callbackQueryId);
    await tg.sendMessage(chatId, `Already tracking <b>${details.name}</b>.`);
    return;
  }

  const count = await db.countTrackedGames(chatId);
  if (count >= db.MAX_GAMES_PER_USER) {
    await tg.answerCallbackQuery(callbackQueryId);
    await tg.sendMessage(chatId, `You're at the max of ${db.MAX_GAMES_PER_USER} games. Remove one first with /removegame.`);
    return;
  }

  await tg.answerCallbackQuery(callbackQueryId);
  await db.setPendingAction(chatId, 'awaiting_filter_choice', { appId, gameName: details.name });

  await tg.sendMessage(
    chatId,
    `<b>${details.name}</b> - how should I notify you?`,
    tg.inlineKeyboard([
      { text: '🔔 Any discount', callback_data: 'filter:any' },
      { text: '📊 % threshold', callback_data: 'filter:percent' },
      { text: '💰 Price threshold', callback_data: 'filter:price' },
      { text: '🎯 Both (either triggers)', callback_data: 'filter:both' },
    ])
  );
}