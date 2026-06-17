// Dropship suppliers (Zendrop, AliExpress…) + multi-channel listing.
//
// One implementation, many suppliers. Each keeps a seeded catalog/orders in
// state[supplierId]; channel listings live in state[id].listings (productId ->
// [channelIds]) so BOTH seeded and live-pulled products can be listed.
//
// Live data:
//   - AliExpress: REAL. We call the Open Platform DS API (api-sg gateway) with
//     MD5-signed requests (App Key + App Secret) — ds.feedname.get to find a
//     product feed, then ds.recommend.feed.get to pull products. Falls back to
//     the seeded catalog only if creds are missing or the call fails.
//   - Zendrop: best-effort Bearer pull; their endpoint returns SPA HTML (no
//     JSON feed), so it falls back to the seeded catalog, flagged SAMPLE.
//
// Listing to TikTok Shop / Facebook / Etsy / Amazon / eBay records intent per
// channel as DRAFTS (no publish, no spend) until each marketplace API is wired.

import { state, persist } from "./store.js";
import crypto from "node:crypto";
import { tiktokConnection } from "./tiktok.js";

// Sales channels a product can be listed to (shared across suppliers). A channel
// with `envKeys` can be CONNECTED by supplying those credentials (server-side);
// `authNote` explains what live publishing still needs beyond the app creds.
export const CHANNELS = [
  { id: "tiktok", name: "TikTok Shop", icon: "🛍️",
    envKeys: ["TIKTOK_SHOP_APP_KEY", "TIKTOK_SHOP_APP_SECRET"],
    authNote: "App key + secret linked. To publish live, authorize the app on your TikTok Shop (OAuth) to mint an access token." },
  { id: "facebook", name: "Facebook Marketplace", icon: "📘" },
  { id: "etsy",     name: "Etsy",                 icon: "🛒" },
  { id: "amazon",   name: "Amazon",               icon: "📦" },
  { id: "ebay",     name: "eBay",                 icon: "🏷️" },
];
const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
const CHANNEL_BY_NAME = Object.fromEntries(CHANNELS.map((c) => [c.name.toLowerCase(), c]));

// Channel connection state, driven by whether its API credentials are present.
export function channelConfigured(c) {
  return Array.isArray(c.envKeys) && c.envKeys.length > 0 && c.envKeys.every((k) => Boolean(process.env[k]));
}
export function channelStatus(channelId) {
  const c = CHANNEL_BY_ID[channelId];
  if (!c) return null;
  const primary = c.envKeys?.[0] ? (process.env[c.envKeys[0]] || "") : "";
  const base = {
    id: c.id, name: c.name, icon: c.icon, envKeys: c.envKeys ?? [],
    configured: channelConfigured(c),
    maskedKey: primary ? `${primary.slice(0, 4)}${"•".repeat(8)}${primary.slice(-4)}` : null,
    authNote: c.authNote ?? null,
  };
  // TikTok Shop carries an OAuth connection on top of the app credentials.
  if (c.id === "tiktok") base.oauth = tiktokConnection();
  return base;
}
export function channelsWithStatus() {
  return CHANNELS.map((c) => channelStatus(c.id));
}
export function channelKey(channelId) {
  const c = CHANNEL_BY_ID[channelId];
  return c?.envKeys?.[0] ? (process.env[c.envKeys[0]] || null) : null;
}

export const SUPPLIERS = [
  {
    id: "zendrop", name: "Zendrop", icon: "📦",
    envKeys: ["ZENDROP_API_KEY"],
    liveBases: ["https://api.zendrop.com/v1", "https://api.zendrop.com", "https://app.zendrop.com/api/v1"],
    liveLabel: "Zendrop API (live)",
    noFeedNote: "Zendrop returns no JSON product feed (HTML only)",
  },
  {
    id: "aliexpress", name: "AliExpress", icon: "🛒",
    envKeys: ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_TRACKING_ID"],
    liveLabel: "AliExpress DS API (live · shipping indicative)",
    noFeedNote: "needs ALIEXPRESS_APP_KEY + ALIEXPRESS_APP_SECRET",
  },
];
const SUPPLIER_BY_ID = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s]));

function supplier(id) {
  const s = SUPPLIER_BY_ID[id];
  if (!s) throw new Error(`Unknown supplier "${id}". Options: ${SUPPLIERS.map((x) => x.id).join(", ")}`);
  return s;
}
const productsOf = (id) => state[id]?.products ?? [];
const ordersOf = (id) => state[id]?.orders ?? [];

export function supplierConfigured(id) {
  return supplier(id).envKeys.some((k) => Boolean(process.env[k]));
}
export const channelName = (cid) => CHANNEL_BY_ID[cid]?.name ?? cid;

function resolveChannel(input) {
  const s = String(input).trim().toLowerCase();
  if (CHANNEL_BY_ID[s]) return s;
  if (CHANNEL_BY_NAME[s]) return CHANNEL_BY_NAME[s].id;
  throw new Error(`Unknown channel "${input}". Options: ${CHANNELS.map((c) => c.id).join(", ")}, all`);
}
function resolveChannels(input) {
  if (input === "all" || (Array.isArray(input) && input.map(String).includes("all"))) {
    return CHANNELS.map((c) => c.id);
  }
  const arr = Array.isArray(input) ? input : String(input).split(",").map((x) => x.trim()).filter(Boolean);
  return [...new Set(arr.map(resolveChannel))];
}

// Per-supplier channel-listing map (productId -> [channelIds]); the source of
// truth for what's listed where, for both seeded and live products.
function listingsMap(id) {
  if (!state[id].listings) state[id].listings = {};
  return state[id].listings;
}
function channelsFor(id, p) {
  const m = state[id]?.listings;
  if (m && Array.isArray(m[p.id])) return m[p.id];
  return Array.isArray(p.channels) ? p.channels : []; // legacy fallback (seed)
}

const margOf = (p) => (p.retail ? Math.round((1 - p.cost / p.retail) * 100) : 0);
function enrich(id, p) {
  const shipping = Array.isArray(p.shipping) && p.shipping.length ? p.shipping : [
    { method: "Standard", days: p.shipDays || "8–14", cost: 0 },
    { method: "Express", days: "5–8", cost: 4.99 },
  ];
  return { ...p, shipping, channels: channelsFor(id, p), marginPct: margOf(p) };
}

// ----- AliExpress Open Platform (DS API), MD5-signed -----
const AE_GATEWAY = "https://api-sg.aliexpress.com/sync";
let aeFeed = { name: null, at: 0 };

function aeSign(params, secret) {
  const concat = Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHash("md5").update(secret + concat + secret).digest("hex").toUpperCase();
}
async function aeCall(method, biz) {
  const key = process.env.ALIEXPRESS_APP_KEY, secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!key || !secret) throw new Error("missing ALIEXPRESS_APP_KEY/SECRET");
  const all = { app_key: key, method, format: "json", v: "2.0", sign_method: "md5", timestamp: String(Date.now()), ...biz };
  all.sign = aeSign(all, secret);
  const res = await fetch(AE_GATEWAY, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(all).toString(), signal: AbortSignal.timeout(20000),
  });
  return res.json();
}
async function aeChooseFeed() {
  if (aeFeed.name && Date.now() - aeFeed.at < 3600000) return aeFeed.name; // 1-hour cache
  const r = await aeCall("aliexpress.ds.feedname.get", {});
  const promos = r?.aliexpress_ds_feedname_get_response?.resp_result?.result?.promos?.promo ?? [];
  const best = promos.filter((p) => p.promo_name).sort((a, b) => (b.product_num || 0) - (a.product_num || 0))[0];
  aeFeed = { name: best?.promo_name ?? null, at: Date.now() };
  return aeFeed.name;
}
function mapAeProduct(p) {
  // cost = what you actually pay AliExpress (the sale price). Retail is a
  // SUGGESTED resale at ~2.5× markup, rounded to a .99 price — AliExpress's
  // own `original_price` is an inflated anchor, useless as a real resale price.
  const cost = Number(p.target_sale_price ?? p.sale_price ?? p.original_price ?? 0);
  const retail = cost > 0 ? Number((Math.ceil(cost * 2.5) - 0.01).toFixed(2)) : 0;
  const img = p.product_main_image_url || p.product_small_image_urls?.string?.[0] || null;
  return {
    id: String(p.product_id),
    name: p.product_title ?? "AliExpress product",
    image: img,
    link: p.product_detail_url || null,
    emoji: "📦",
    category: p.second_level_category_name || p.first_level_category_name || "—",
    cost, retail,
    // The feed doesn't return per-item freight; show AliExpress's standard tiers
    // (indicative). Exact rates are computed per destination at checkout.
    shipping: [
      { method: "AliExpress Standard", days: "15–30", cost: 0 },
      { method: "AliExpress Saver", days: "20–40", cost: 0 },
    ],
  };
}
async function aliexpressFetch() {
  const feed = await aeChooseFeed();
  if (!feed) return null;
  const r = await aeCall("aliexpress.ds.recommend.feed.get", {
    feed_name: feed, page_no: "1", page_size: "12",
    target_currency: "USD", target_language: "EN", country: "US",
  });
  const result = r?.aliexpress_ds_recommend_feed_get_response?.result ?? {};
  let list = result.products?.traffic_product_d_t_o ?? result.products?.product ?? result.products ?? [];
  if (!Array.isArray(list)) list = [];
  return list.length ? list.map(mapAeProduct) : null;
}

// ----- Zendrop best-effort Bearer pull (falls back to SAMPLE) -----
async function bearerFetch(s) {
  const key = process.env[s.envKeys[0]];
  if (!key || !s.liveBases) return null;
  for (const base of s.liveBases) {
    try {
      const res = await fetch(`${base}/products?limit=50`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(9000),
      });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.products ?? data.data ?? []);
        if (items.length) return items.map((p) => ({
          id: String(p.id ?? p.sku ?? Math.random().toString(36).slice(2, 8)),
          name: p.name ?? p.title ?? "Product", emoji: "📦",
          category: p.category ?? "—", cost: Number(p.cost ?? p.price ?? 0),
          retail: Number(p.retail ?? p.msrp ?? 0),
        }));
      }
    } catch { /* try next */ }
  }
  return null;
}

async function tryLiveFor(s) {
  try {
    return s.id === "aliexpress" ? await aliexpressFetch() : await bearerFetch(s);
  } catch { return null; }
}

const liveCache = {}; // supplierId -> { at, data }
async function fetchLiveCached(id) {
  const c = liveCache[id];
  if (c && Date.now() - c.at < 300000) return c.data; // 5-min cache
  const data = await tryLiveFor(supplier(id));
  liveCache[id] = { at: Date.now(), data };
  return data;
}

/** Catalog payload the dashboard renders: { live, source, products }. */
export async function supplierProductsPayload(id) {
  const s = supplier(id);
  const live = await fetchLiveCached(id);
  if (live && live.length) {
    return { live: true, source: s.liveLabel, products: live.map((p) => enrich(id, p)) };
  }
  return {
    live: false,
    source: supplierConfigured(id)
      ? `Sample catalog — ${s.noFeedNote}`
      : `Sample catalog — set ${s.envKeys.join(" + ")}`,
    products: productsOf(id).map((p) => enrich(id, p)),
  };
}

export function supplierStatus(id) {
  const s = supplier(id);
  const primary = process.env[s.envKeys[0]] || "";
  return {
    id, provider: s.name, icon: s.icon, envKeys: s.envKeys,
    configured: supplierConfigured(id),
    maskedKey: primary ? `${primary.slice(0, 4)}${"•".repeat(8)}${primary.slice(-4)}` : null,
    storedIn: "HermesAgent/.env (server-side; never sent to the browser by default)",
    products: productsOf(id).length,
    imported: productsOf(id).filter((p) => p.imported).length,
    openOrders: ordersOf(id).filter((o) => o.status.startsWith("Processing") || o.status.startsWith("Draft")).length,
    channels: channelsWithStatus(), // each carries configured/maskedKey/authNote
  };
}

export function supplierOrders(id) {
  return ordersOf(id).map((o) => ({ ...o, profit: Number((o.revenue - o.cost).toFixed(2)) }));
}
export function supplierKey(id) {
  return process.env[supplier(id).envKeys[0]] || null;
}

/** Honest live check. AliExpress: signed DS ping. Zendrop: inspect the body. */
export async function supplierVerify(id) {
  const s = supplier(id);
  if (!supplierConfigured(id)) return { ok: false, detail: `No ${s.envKeys[0]} set.` };
  if (id === "aliexpress") {
    try {
      const r = await aeCall("aliexpress.ds.feedname.get", {});
      if (r?.error_response) return { ok: false, detail: `Reachable, but the API rejected the call: ${r.error_response.msg}.` };
      const n = r?.aliexpress_ds_feedname_get_response?.resp_result?.result?.current_record_count;
      return { ok: true, detail: `Live — AliExpress DS API reachable (${n ?? "?"} product feeds available). Products pull live.` };
    } catch (err) { return { ok: false, detail: `Request failed: ${err.message}` }; }
  }
  try {
    const res = await fetch(`${s.liveBases[0]}/products?limit=1`, {
      headers: { Authorization: `Bearer ${process.env[s.envKeys[0]]}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return { ok: false, httpStatus: res.status, contentType: ct, detail: `Endpoint returned ${ct || "non-JSON"}, not JSON. ${s.noFeedNote}.` };
    }
    let body = null; try { body = await res.json(); } catch { /* */ }
    const err = body && (body.error_response || body.error || body.errors);
    if (err) {
      const msg = (err.msg || err.message || JSON.stringify(err)).slice(0, 160);
      return { ok: false, httpStatus: res.status, contentType: ct, detail: `Reachable, but the API rejected the call: ${msg}. ${s.noFeedNote}.` };
    }
    return { ok: true, httpStatus: res.status, contentType: ct, detail: "Endpoint returned JSON product data — live API reachable." };
  } catch (err) {
    return { ok: false, detail: `Request failed: ${err.message}` };
  }
}

// ----- multi-channel listing (drafts; works for seed AND live products) -----
function findProduct(id, productId) {
  return productsOf(id).find((x) => x.id === productId)
    || (Array.isArray(liveCache[id]?.data) ? liveCache[id].data.find((x) => x.id === productId) : null);
}
/** Look up one product (seed or live-cached) — used by the publish route. */
export function getSupplierProduct(id, productId) {
  return findProduct(id, productId);
}
export function listProductToChannels(id, productId, channelInput) {
  const prod = findProduct(id, productId);
  if (!prod) throw new Error(`No ${supplier(id).name} product ${productId}`);
  const m = listingsMap(id);
  const current = Array.isArray(m[productId]) ? m[productId] : (Array.isArray(prod.channels) ? prod.channels : []);
  const set = [...current];
  const added = [];
  for (const cid of resolveChannels(channelInput)) if (!set.includes(cid)) { set.push(cid); added.push(cid); }
  m[productId] = set;
  persist();
  return { product: { ...prod, channels: set, marginPct: margOf(prod) }, added };
}
export function unlistProductFromChannel(id, productId, channelInput) {
  const prod = findProduct(id, productId);
  if (!prod) throw new Error(`No ${supplier(id).name} product ${productId}`);
  const m = listingsMap(id);
  const cid = resolveChannel(channelInput);
  const current = Array.isArray(m[productId]) ? m[productId] : (Array.isArray(prod.channels) ? prod.channels : []);
  const had = current.includes(cid);
  m[productId] = current.filter((c) => c !== cid);
  persist();
  return { product: { ...prod, channels: m[productId], marginPct: margOf(prod) }, removed: had ? cid : null };
}
