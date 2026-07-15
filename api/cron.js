const db = require('../lib/db');
const steam = require('../lib/steam');
const tg = require('../lib/telegram');

const DELAY_MS = 300; // small gap between Steam requests to stay well under any rate limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async (req, res) => {
  // Protect this endpoint - only Vercel Cron (or us) should be able to trigger it,
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('unauthorized');
  }

  const pairs = await db.getDistinctAppRegionPairs();
  const results = { checked: 0, notified: 0, errors: 0, baselined: 0 };

  for (const { appId, region } of pairs) {
    try {
      const details = await steam.getAppDetails(appId, region);
      results.checked++;

      if (!details) {
        // Delisted, removed, or not available in this region - skip silently,
        await sleep(DELAY_MS);
        continue;
      }

      const cache = await db.getPriceCache(appId, region);
      const wasOnSale = cache ? cache.last_discount_percent > 0 : null;
      const isOnSale = details.discountPercent > 0;

      // First time we've ever checked this (app, region) pair - record it as a baseline only. Notifying here would falsely alert on games that were already on sale before anyone started tracking them.
      if (cache === null) {
        results.baselined++;
      } else if (!wasOnSale && isOnSale) {
        // Transition from not-on-sale to on-sale - this is the real signal.
        const chatIds = await db.getUsersTrackingGameInRegion(appId, region);
        const priceText = steam.formatPrice(details.priceCents, details.currency);
        const msg = `🔥 <b>${details.name}</b> is on sale!\n${details.discountPercent}% off - now ${priceText}`;
        for (const chatId of chatIds) {
          await tg.sendMessage(chatId, msg);
        }
        results.notified += chatIds.length;
      }

      await db.upsertPriceCache(appId, region, details.priceCents, details.discountPercent);
    } catch (err) {
      console.error(`Error checking app ${appId} (${region}):`, err);
      results.errors++;
    }

    await sleep(DELAY_MS);
  }

  res.status(200).json(results);
};
