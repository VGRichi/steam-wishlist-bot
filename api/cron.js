const db = require('../lib/db');
const steam = require('../lib/steam');
const tg = require('../lib/telegram');

const DELAY_MS = 300; // small gap between Steam requests to stay well under any rate limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPrice(cents, currency) {
  if (cents == null) return 'unknown price';
  return `${(cents / 100).toFixed(2)} ${currency || ''}`.trim();
}

module.exports = async (req, res) => {
  // Protect this endpoint - only Vercel Cron (or us) should be able to trigger it,
  // otherwise anyone with the URL could spam Steam's API through our job.
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('unauthorized');
  }

  const pairs = await db.getDistinctAppRegionPairs();
  const results = { checked: 0, notified: 0, errors: 0 };

  for (const { appId, region } of pairs) {
    try {
      const details = await steam.getAppDetails(appId, region);
      results.checked++;

      if (!details) {
        // Delisted, removed, or not available in this region - skip silently,
        // nothing sensible to notify about.
        await sleep(DELAY_MS);
        continue;
      }

     const rows = await db.getTrackedGameRowsForAppRegion(appId, region);
      const priceText = steam.formatPrice(details.priceCents, details.currency);

      for (const row of rows) {
        const conditionMet = steam.meetsCondition(
          row.threshold_percent,
          row.threshold_price_cents,
          details.discountPercent,
          details.priceCents
        );

        if (conditionMet && !row.last_condition_met) {
          let msg = `🔥 <b>${details.name}</b> matches your alert!\n`;
          msg += details.discountPercent > 0
            ? `${details.discountPercent}% off - now ${priceText}`
            : `Now ${priceText}`;
          await tg.sendMessage(row.chat_id, msg);
          await db.updateConditionMet(row.id, true);
          results.notified++;
        } else if (!conditionMet && row.last_condition_met) {
          await db.updateConditionMet(row.id, false);
        }
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
