const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_GAMES_PER_USER = 10;

// ---------- Users ----------

async function getUser(chatId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertUserRegion(chatId, regionCode) {
  const { error } = await supabase
    .from('users')
    .upsert({ chat_id: chatId, region_code: regionCode.toUpperCase(), pending_action: null, pending_data: null });
  if (error) throw error;
}

// pending_action is a tiny piece of conversation state (e.g. "awaiting_region") so the webhook knows how to interpret the next plain-text message from a
// user, since Vercel functions have no memory between requests.
async function setPendingAction(chatId, action, data = null) {
  const { error } = await supabase
    .from('users')
    .upsert({ chat_id: chatId, pending_action: action, pending_data: data });
  if (error) throw error;
}

// ---------- Tracked games ----------

async function getTrackedGames(chatId) {
  const { data, error } = await supabase
    .from('tracked_games')
    .select('*')
    .eq('chat_id', chatId)
    .order('added_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function countTrackedGames(chatId) {
  const { count, error } = await supabase
    .from('tracked_games')
    .select('*', { count: 'exact', head: true })
    .eq('chat_id', chatId);
  if (error) throw error;
  return count;
}

async function isTrackingGame(chatId, appId) {
  const { data, error } = await supabase
    .from('tracked_games')
    .select('id')
    .eq('chat_id', chatId)
    .eq('app_id', appId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Returns { ok: true } or { ok: false, reason: 'limit' | 'duplicate' }
async function addTrackedGame(chatId, appId, gameName, options = {}) {
  const { thresholdPercent = null, thresholdPriceCents = null, initialConditionMet = false } = options;

  const already = await isTrackingGame(chatId, appId);
  if (already) return { ok: false, reason: 'duplicate' };

  const count = await countTrackedGames(chatId);
  if (count >= MAX_GAMES_PER_USER) return { ok: false, reason: 'limit' };

  const { error } = await supabase
    .from('tracked_games')
    .insert({
      chat_id: chatId,
      app_id: appId,
      game_name: gameName,
      threshold_percent: thresholdPercent,
      threshold_price_cents: thresholdPriceCents,
      last_condition_met: initialConditionMet,
    });
  if (error) throw error;
  return { ok: true };
}

async function removeTrackedGame(chatId, appId) {
  const { error } = await supabase
    .from('tracked_games')
    .delete()
    .eq('chat_id', chatId)
    .eq('app_id', appId);
  if (error) throw error;
}

// ---------- Cron / price-check support ----------

// Every distinct (app_id, region_code) pair currently being tracked by anyone
async function getDistinctAppRegionPairs() {
  const { data, error } = await supabase
    .from('tracked_games')
    .select('app_id, users!inner(region_code)');
  if (error) throw error;

  const seen = new Map();
  for (const row of data) {
    const region = row.users.region_code;
    const key = `${row.app_id}|${region}`;
    if (!seen.has(key)) {
      seen.set(key, { appId: row.app_id, region });
    }
  }
  return Array.from(seen.values());
}

// All chat_ids tracking a given app_id within a given region
async function getUsersTrackingGameInRegion(appId, region) {
  const { data, error } = await supabase
    .from('tracked_games')
    .select('chat_id, users!inner(region_code)')
    .eq('app_id', appId)
    .eq('users.region_code', region);
  if (error) throw error;
  return data.map((r) => r.chat_id);
}

async function getTrackedGameRowsForAppRegion(appId, region) {
  const { data, error } = await supabase
    .from('tracked_games')
    .select('id, chat_id, threshold_percent, threshold_price_cents, last_condition_met, game_name, users!inner(region_code)')
    .eq('app_id', appId)
    .eq('users.region_code', region);
  if (error) throw error;
  return data;
}

async function updateConditionMet(trackedGameId, met) {
  const { error } = await supabase
    .from('tracked_games')
    .update({ last_condition_met: met })
    .eq('id', trackedGameId);
  if (error) throw error;
}

async function getPriceCache(appId, region) {
  const { data, error } = await supabase
    .from('price_cache')
    .select('*')
    .eq('app_id', appId)
    .eq('region_code', region)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertPriceCache(appId, region, priceCents, discountPercent) {
  const { error } = await supabase
    .from('price_cache')
    .upsert({
      app_id: appId,
      region_code: region,
      last_price_cents: priceCents,
      last_discount_percent: discountPercent,
      last_checked_at: new Date().toISOString(),
    });
  if (error) throw error;
}

module.exports = {
  MAX_GAMES_PER_USER,
  getUser,
  upsertUserRegion,
  setPendingAction,
  getTrackedGames,
  countTrackedGames,
  isTrackingGame,
  addTrackedGame,
  removeTrackedGame,
  getDistinctAppRegionPairs,
  getUsersTrackingGameInRegion,
  getPriceCache,
  upsertPriceCache,
  getTrackedGameRowsForAppRegion,
  updateConditionMet,
};
