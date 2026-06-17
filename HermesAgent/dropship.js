// Dropship suppliers (Zendrop, AliExpress…) + multi-channel listing.
//
// One implementation, many suppliers. Each supplier keeps its catalog/orders in
// state[supplierId] (same shape) and differs only in its API creds + endpoints.
// The marketplace-listing logic (TikTok Shop, Facebook, Etsy, Amazon, eBay) is
// shared — it just toggles ids on a product's `channels`.
//
// Reality check (same as before): neither supplier exposes a simple JSON product
// feed to this key — Zendrop returns SPA HTML, and the AliExpress Open Platform
// requires signed requests (App Key + Secret + sign). So we ATTEMPT a live pull
// (and use it the instant real JSON comes back) but fall back to the seeded
// catalog, clearly flagged SAMPLE — never faked as live. Listing records intent
// per channel as DRAFTS (no publish, no spend) until each marketplace API is wired.

import { state, persist } from "./store.js";

// Sales channels a product can be listed to (shared across suppliers).
export const CHANNELS = [
  { id: "tiktok",   name: "TikTok Shop",          icon: "🛍️" },
  { id: "facebook", name: "Facebook Marketplace", icon: "📘" },
  { id: "etsy",     name: "Etsy",                 icon: "🛒" },
  { id: "amazon",   name: "Amazon",               icon: "📦" },
  { id: "ebay",     name: "eBay",                 icon: "🏷️" },
];
const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
const CHANNEL_BY_NAME = Object.fromEntries(CHANNELS.map((c) => [c.name.toLowerCase(), c]));

// Supplier registry. `id` is also the state key (state[id].products/orders).
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
    // AliExpress Open Platform (Affiliate / Dropshipping). Needs App Key + App
    // Secret and MD5/HMAC-signed requests through the TOP gateway.
    envKeys: ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_TRACKING_ID"],
    liveBases: ["https://api-sg.aliexpress.com/sync"],
    liveLabel: "AliExpress Open Platform (live)",
    noFeedNote: "AliExpress Open Platform needs signed requests (App Key + Secret) — live pull not yet wired",
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

const withMargin = (p) => ({ ...p, marginPct: p.retail ? Math.round((1 - p.cost / p.retail) * 100) : 0 });
function enrich(p) {
  const shipping = Array.isArray(p.shipping) && p.shipping.length ? p.shipping : [
    { method: "Standard", days: p.shipDays || "8–14", cost: 0 },
    { method: "Express", days: "5–8", cost: 4.99 },
  ];
  return withMargin({ ...p, shipping, channels: Array.isArray(p.channels) ? p.channels : [] });
}

// ----- live pull (best-effort; falls back to the seeded catalog) -----
const liveCache = {}; // supplierId -> { at, data }

function mapLive(p) {
  return enrich({
    id: String(p.id ?? p.sku ?? p.product_id ?? Math.random().toString(36).slice(2, 8)),
    name: p.name ?? p.title ?? "Product",
    emoji: "📦",
    category: p.category ?? p.type ?? "—",
    cost: Number(p.cost ?? p.wholesale_price ?? p.price ?? 0),
    retail: Number(p.retail ?? p.suggested_price ?? p.msrp ?? 0),
    shipping: Array.isArray(p.shipping) ? p.shipping : undefined,
    channels: [],
  });
}

async function tryLive(s) {
  const key = process.env[s.envKeys[0]];
  if (!key) return null;
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
        if (items.length) return items.map(mapLive);
      }
    } catch { /* try next base */ }
  }
  return null;
}

async function fetchLiveCached(id) {
  const c = liveCache[id];
  if (c && Date.now() - c.at < 300000) return c.data; // 5-min cache
  const data = await tryLive(supplier(id));
  liveCache[id] = { at: Date.now(), data };
  return data;
}

/** Catalog payload the dashboard renders: { live, source, products }. */
export async function supplierProductsPayload(id) {
  const s = supplier(id);
  const live = await fetchLiveCached(id);
  if (live && live.length) return { live: true, source: s.liveLabel, products: live };
  return {
    live: false,
    source: supplierConfigured(id)
      ? `Sample catalog — ${s.noFeedNote}`
      : `Sample catalog — set ${s.envKeys.join(" + ")}`,
    products: productsOf(id).map(enrich),
  };
}

/** Status block (connection, key mask, counts, channels). */
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
    channels: CHANNELS,
  };
}

export function supplierOrders(id) {
  return ordersOf(id).map((o) => ({ ...o, profit: Number((o.revenue - o.cost).toFixed(2)) }));
}

export function supplierKey(id) {
  return process.env[supplier(id).envKeys[0]] || null;
}

/** Honest live check — reports exactly what the supplier endpoint returns.
    JSON alone isn't success: gateways like AliExpress return a JSON *error*
    (e.g. MissingParameter) for an unsigned call, so we inspect the body. */
export async function supplierVerify(id) {
  const s = supplier(id);
  const key = process.env[s.envKeys[0]];
  if (!key) return { ok: false, detail: `No ${s.envKeys[0]} set.` };
  try {
    const res = await fetch(`${s.liveBases[0]}/products?limit=1`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return { ok: false, httpStatus: res.status, contentType: ct, detail: `Endpoint returned ${ct || "non-JSON"}, not JSON. ${s.noFeedNote}.` };
    }
    let body = null;
    try { body = await res.json(); } catch { /* not parseable */ }
    const err = body && (body.error_response || body.error || body.errors);
    if (err) {
      const msg = (err.msg || err.message || (typeof err === "string" ? err : JSON.stringify(err))).slice(0, 160);
      return { ok: false, httpStatus: res.status, contentType: ct, detail: `Reachable, but the API rejected the call: ${msg}. ${s.noFeedNote}.` };
    }
    return { ok: true, httpStatus: res.status, contentType: ct, detail: "Endpoint returned JSON product data — live API reachable." };
  } catch (err) {
    return { ok: false, detail: `Request failed: ${err.message}` };
  }
}

// ----- multi-channel listing (drafts) -----
export function listProductToChannels(id, productId, channelInput) {
  const p = productsOf(id).find((x) => x.id === productId);
  if (!p) throw new Error(`No ${supplier(id).name} product ${productId}`);
  if (!Array.isArray(p.channels)) p.channels = [];
  const ids = resolveChannels(channelInput);
  const added = [];
  for (const cid of ids) if (!p.channels.includes(cid)) { p.channels.push(cid); added.push(cid); }
  persist();
  return { product: enrich(p), added };
}

export function unlistProductFromChannel(id, productId, channelInput) {
  const p = productsOf(id).find((x) => x.id === productId);
  if (!p) throw new Error(`No ${supplier(id).name} product ${productId}`);
  const cid = resolveChannel(channelInput);
  const had = (p.channels ?? []).includes(cid);
  p.channels = (p.channels ?? []).filter((c) => c !== cid);
  persist();
  return { product: enrich(p), removed: had ? cid : null };
}
