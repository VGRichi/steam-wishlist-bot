const fetch = require('node-fetch');

// Common Steam-supported region codes. Not exhaustive, but covers the vast majority of real users.
// If someone's region isn't here, appdetails will still usually work with it - this is just a friendly upfront sanity check.
const KNOWN_REGIONS = new Set([
  'US', 'GB', 'DE', 'FR', 'TR', 'AZ', 'RU', 'UA', 'KZ', 'PL', 'NL', 'ES',
  'IT', 'CA', 'AU', 'BR', 'AR', 'MX', 'IN', 'JP', 'KR', 'CN', 'SE', 'NO',
  'FI', 'DK', 'CH', 'AT', 'BE', 'PT', 'GR', 'CZ', 'RO', 'HU', 'IL', 'ZA',
  'SG', 'MY', 'TH', 'PH', 'ID', 'VN', 'EG', 'SA', 'AE', 'GE', 'AM', 'UZ',
]);

function isKnownRegion(code) {
  return KNOWN_REGIONS.has((code || '').toUpperCase());
}

// Extracts an App ID from a raw number or a Steam store URL. Returns null if neither pattern matches.
function extractAppId(input) {
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const match = trimmed.match(/store\.steampowered\.com\/app\/(\d+)/);
  if (match) return parseInt(match[1], 10);
  return null;
}

async function searchGames(query, region = 'US') {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
    query
  )}&l=english&cc=${region}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`storesearch failed: ${res.status}`);
  const data = await res.json();
  // Storesearch returns items with type "app" for regular games/DLC/software and "bundle" for bundles - there's no separate "game" type. 
  // We exclude bundles here (bundle appids aren't valid for appdetails lookups) but otherwise keep results as-is; DLC/soundtracks are rare in a name search
  // for a specific title and the confirm-tap step catches any mismatch.
  return (data.items || [])
    .filter((item) => item.type !== 'bundle')
    .slice(0, 5)
    .map((item) => ({ appId: item.id, name: item.name }));
}

// Fetches price/discount details for a specific app in a specific region.
// Returns null if the app doesn't exist / isn't purchasable in that region.
async function getAppDetails(appId, region = 'US') {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${region}&l=english`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`appdetails failed: ${res.status}`);
  const data = await res.json();
  const entry = data[appId];
  if (!entry || !entry.success) return null;

  const d = entry.data;
  const priceOverview = d.price_overview; // absent for F2P games

  return {
    name: d.name,
    isFree: !!d.is_free,
    priceCents: priceOverview ? priceOverview.final : null,
    initialPriceCents: priceOverview ? priceOverview.initial : null,
    discountPercent: priceOverview ? priceOverview.discount_percent : 0,
    currency: priceOverview ? priceOverview.currency : null,
  };
}

function formatPrice(cents, currency) {
  if (cents == null) return 'unknown price';
  return `${(cents / 100).toFixed(2)} ${currency || ''}`.trim();
}

function appStoreUrl(appId) {
  return `https://store.steampowered.com/app/${appId}/`;
}

module.exports = {
  isKnownRegion,
  extractAppId,
  searchGames,
  getAppDetails,
  formatPrice,
  appStoreUrl,
};
