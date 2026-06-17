// Zendrop supplier integration + multi-channel listing.
//
// Reality check: Zendrop has no confirmed public product API. Every candidate
// endpoint (api.zendrop.com/v1, /products, app.zendrop.com/api, graphql)
// returns their SPA HTML, not JSON, even with a Bearer key. So we ATTEMPT a
// live pull (and will use it the instant a JSON feed is reachable), but fall
// back to the seeded catalog — clearly flagged SAMPLE, never faked as live.
//
// "List to a marketplace" records the intent per product/channel. TikTok Shop,
// Facebook Marketplace, Etsy, Amazon and eBay don't have listing APIs wired
// here, so these are DRAFTS (no publish, no spend) until each channel's API is
// connected — same honest posture as zendrop_draft_fulfillment.

import { state, persist } from "./store.js";

// The sales channels a product can be listed to. `id` is the stable key stored
// on each product's `channels`; `name`/`icon` are for display.
export const CHANNELS = [
  { id: "tiktok",   name: "TikTok Shop",          icon: "🛍️" },
  { id: "facebook", name: "Facebook Marketplace", icon: "📘" },
  { id: "etsy",     name: "Etsy",                 icon: "🛒" },
  { id: "amazon",   name: "Amazon",               icon: "📦" },
  { id: "ebay",     name: "eBay",                 icon: "🏷️" },
];
const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
const CHANNEL_BY_NAME = Object.fromEntries(CHANNELS.map((c) => [c.name.toLowerCase(), c]));

export function zendropConfigured() {
  return Boolean(process.env.ZENDROP_API_KEY);
}

/** Resolve a channel id OR display name to a canonical id (throws if unknown). */
function resolveChannel(input) {
  const s = String(input).trim().toLowerCase();
  if (CHANNEL_BY_ID[s]) return s;
  if (CHANNEL_BY_NAME[s]) return CHANNEL_BY_NAME[s].id;
  throw new Error(`Unknown channel "${input}". Options: ${CHANNELS.map((c) => c.id).join(", ")}, all`);
}

/** Expand "all" / arrays / comma lists into a deduped array of channel ids. */
function resolveChannels(input) {
  if (input === "all" || (Array.isArray(input) && input.map(String).includes("all"))) {
    return CHANNELS.map((c) => c.id);
  }
  const arr = Array.isArray(input) ? input : String(input).split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set(arr.map(resolveChannel))];
}

const withMargin = (p) => ({ ...p, marginPct: p.retail ? Math.round((1 - p.cost / p.retail) * 100) : 0 });

// Defensive enrichment so the UI always has cost/shipping/channels, whatever
// the source (seed or a future live feed missing fields).
function enrich(p) {
  const shipping = Array.isArray(p.shipping) && p.shipping.length ? p.shipping : [
    { method: "Standard", days: p.shipDays || "8–14", cost: 0 },
    { method: "Express", days: "5–8", cost: 4.99 },
  ];
  return withMargin({ ...p, shipping, channels: Array.isArray(p.channels) ? p.channels : [] });
}

// ----- live pull (best-effort; currently always falls back) -----
const LIVE_BASES = ["https://api.zendrop.com/v1", "https://api.zendrop.com", "https://app.zendrop.com/api/v1"];
let liveCache = { at: 0, data: null };

function mapLive(p) {
  // Best-effort map of an unknown live schema into our product shape.
  return enrich({
    id: String(p.id ?? p.sku ?? p.product_id ?? Math.random().toString(36).slice(2, 8)),
    name: p.name ?? p.title ?? "Zendrop product",
    emoji: "📦",
    category: p.category ?? p.type ?? "—",
    cost: Number(p.cost ?? p.wholesale_price ?? p.price ?? 0),
    retail: Number(p.retail ?? p.suggested_price ?? p.msrp ?? 0),
    shipping: Array.isArray(p.shipping) ? p.shipping : undefined,
    channels: [],
  });
}

async function tryLive() {
  const key = process.env.ZENDROP_API_KEY;
  if (!key) return null;
  for (const base of LIVE_BASES) {
    try {
      const res = await fetch(`${base}/products?limit=50`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(9000),
      });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.products ?? data.data ?? []);
        if (items.length) return items.map(mapLive);
      }
    } catch { /* try next base */ }
  }
  return null;
}

async function fetchLiveCached() {
  const now = Date.now();
  if (liveCache.data && now - liveCache.at < 300000) return liveCache.data; // 5-min cache
  const live = await tryLive();
  liveCache = { at: now, data: live };
  return live;
}

/** The catalog payload the dashboard renders: { live, source, products }. */
export async function zendropProductsPayload() {
  const live = await fetchLiveCached();
  if (live && live.length) {
    return { live: true, source: "Zendrop API (live)", products: live };
  }
  return {
    live: false,
    source: zendropConfigured()
      ? "Sample catalog — Zendrop returns no JSON product feed (HTML only)"
      : "Sample catalog — set ZENDROP_API_KEY",
    products: state.zendrop.products.map(enrich),
  };
}

// ----- multi-channel listing (drafts) -----

/** List a product to one/more channels (or "all"). Returns {product, added}. */
export function listProductToChannels(productId, channelInput) {
  const p = state.zendrop.products.find((x) => x.id === productId);
  if (!p) throw new Error(`No Zendrop product ${productId}`);
  if (!Array.isArray(p.channels)) p.channels = [];
  const ids = resolveChannels(channelInput);
  const added = [];
  for (const id of ids) if (!p.channels.includes(id)) { p.channels.push(id); added.push(id); }
  persist();
  return { product: enrich(p), added };
}

/** Remove a product from one channel. Returns {product, removed}. */
export function unlistProductFromChannel(productId, channelInput) {
  const p = state.zendrop.products.find((x) => x.id === productId);
  if (!p) throw new Error(`No Zendrop product ${productId}`);
  const id = resolveChannel(channelInput);
  const had = (p.channels ?? []).includes(id);
  p.channels = (p.channels ?? []).filter((c) => c !== id);
  persist();
  return { product: enrich(p), removed: had ? id : null };
}

export const channelName = (id) => CHANNEL_BY_ID[id]?.name ?? id;
