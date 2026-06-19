// Dropship suppliers (Zendrop, CJ Dropshipping…) + multi-channel listing.
//
// One implementation, many suppliers. Each keeps a seeded catalog/orders in
// state[supplierId]; channel listings live in state[id].listings (productId ->
// [channelIds]) so BOTH seeded and live-pulled products can be listed.
//
// Live data:
//   - CJ Dropshipping: REAL. We exchange CJ_API_KEY for a CJ access token, then
//     call /product/listV2. Falls back to the seeded catalog only if creds are
//     missing or the call fails. The route id remains "aliexpress" so existing
//     dashboard state keeps working while that tab is repointed to CJ.
//   - Zendrop: best-effort Bearer pull; their endpoint returns SPA HTML (no
//     JSON feed), so it falls back to the seeded catalog, flagged SAMPLE.
//
// Listing to TikTok Shop / Facebook / Etsy / Amazon / eBay records intent per
// channel as DRAFTS (no publish, no spend) until each marketplace API is wired.

import { state, persist } from "./store.js";
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
    id: "aliexpress", name: "CJ Dropshipping", icon: "🛒",
    envKeys: ["CJ_API_KEY", "CJ_MCP_TOKEN"],
    liveLabel: "CJ Dropshipping OpenAPI (live)",
    noFeedNote: "needs CJ_API_KEY",
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

// ----- CJ Dropshipping OpenAPI -----
const CJ_API_BASE = "https://developers.cjdropshipping.com";
const CJ_API_PREFIX = "/api2.0/v1";
let cjSession = { apiKey: null, token: null, expiry: 0 };

function cjApiKey() {
  return process.env.CJ_API_KEY || process.env.CJ_MCP_TOKEN || "";
}
function cjOk(response) {
  return response?.result === true || response?.success === true || response?.code === 200 || response?.code === 0;
}
async function cjAccessToken() {
  const apiKey = cjApiKey();
  if (!apiKey) throw new Error("missing CJ_API_KEY");
  const fresh = (e) => e > Date.now() + 60000;
  // 1) in-memory token
  if (cjSession.apiKey === apiKey && cjSession.token && fresh(cjSession.expiry)) return cjSession.token;
  // 2) persisted token (survives restarts; avoids CJ's 1/5-min auth limit)
  if (state.cj?.token && state.cj.apiKey === apiKey && fresh(state.cj.expiry || 0)) {
    cjSession = { apiKey, token: state.cj.token, expiry: state.cj.expiry };
    return cjSession.token;
  }
  // 3) mint a new one
  let json = null;
  try {
    const res = await fetch(`${CJ_API_BASE}${CJ_API_PREFIX}/authentication/getAccessToken`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }), signal: AbortSignal.timeout(20000),
    });
    json = await res.json();
  } catch { /* network — fall through to any stale token */ }
  if (!cjOk(json) || !json?.data?.accessToken) {
    // rate-limited / transient — reuse a persisted token even if near-expiry
    if (state.cj?.token && state.cj.apiKey === apiKey) {
      cjSession = { apiKey, token: state.cj.token, expiry: state.cj.expiry || Date.now() + 3600000 };
      return cjSession.token;
    }
    throw new Error(json?.message || "CJ auth failed");
  }
  const expiry = Date.parse(json.data.accessTokenExpiryDate || "") || Date.now() + 23 * 3600000;
  cjSession = { apiKey, token: json.data.accessToken, expiry };
  state.cj = { token: json.data.accessToken, expiry, apiKey };
  persist();
  return cjSession.token;
}
async function cjCall(endpoint, { method = "GET", params = {}, body = null } = {}) {
  const token = await cjAccessToken();
  const url = new URL(`${CJ_API_PREFIX}${endpoint}`, CJ_API_BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "CJ-Access-Token": token },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (!cjOk(json)) throw new Error(json?.message || `CJ request failed with HTTP ${res.status}`);
  return json;
}
function getProductUrl(id, name) {
  const slug = String(name || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
  return `https://www.cjdropshipping.com/product/${slug}-p-${id}.html`;
}
function mapCjProduct(p) {
  const cost = Number(p.sellPrice ?? p.nowPrice ?? p.productPrice ?? p.price ?? 0);
  const retail = cost > 0 ? Number((Math.ceil(cost * 2.5) - 0.01).toFixed(2)) : 0;
  const name = p.nameEn || p.productNameEn || p.productName || p.name || "CJ product";
  const img = p.bigImage || p.productImage || p.image || p.productImageSet?.[0] || null;
  const id = String(p.id || p.pid || p.productId || p.productSku || Math.random().toString(36).slice(2, 8));
  return {
    id,
    name,
    image: img,
    link: p.productUrl || getProductUrl(id, name),
    emoji: "📦",
    category: p.categoryName || p.category || p.productType || "—",
    cost, retail,
    shipping: [
      { method: "CJPacket", days: "7–15", cost: 0 },
      { method: "Standard", days: "10–20", cost: 0 },
    ],
  };
}
// CJ's general catalog includes adult/NSFW items — keep the dashboard clean.
const CJ_BLOCK = /\b(adult|chastity|penis|vagina|sex|sexy|erotic|fishnet|panties|panty|lingerie|vibrator|dildo|bondage|binding toy|nsfw|condom|nipple|butt plug|massage oil|fetish|thong|crotchless)\b/i;

async function cjFetch(keyWord = "pet") {
  const r = await cjCall("/product/listV2", {
    method: "GET",
    params: { page: "1", size: "40", keyWord, startWarehouseInventory: "1" },
  });
  const chunks = Array.isArray(r?.data?.content) ? r.data.content : [];
  const list = chunks
    .flatMap((chunk) => Array.isArray(chunk?.productList) ? chunk.productList : [])
    .map(mapCjProduct)
    .filter((p) => p.cost > 0 && p.name && !CJ_BLOCK.test(p.name));
  return list.length ? list.slice(0, 24) : null;
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

async function tryLiveFor(s, keyWord) {
  try {
    return s.id === "aliexpress" ? await cjFetch(keyWord || "pet") : await bearerFetch(s);
  } catch { return null; }
}

const liveCache = {}; // `${id}:${keyWord}` -> { at, data }
async function fetchLiveCached(id, keyWord) {
  const cacheKey = `${id}:${keyWord || ""}`;
  const c = liveCache[cacheKey];
  if (c && Date.now() - c.at < 300000) return c.data; // 5-min cache
  const data = await tryLiveFor(supplier(id), keyWord);
  liveCache[cacheKey] = { at: Date.now(), data };
  return data;
}

/** Catalog payload the dashboard renders: { live, source, products }.
 *  `keyWord` is the live search term for keyword-searchable suppliers (CJ). */
export async function supplierProductsPayload(id, keyWord = "") {
  const s = supplier(id);
  // CJ is keyword-searchable and defaults to pet products.
  const effKeyWord = keyWord || (id === "aliexpress" ? "pet" : "");
  const live = await fetchLiveCached(id, effKeyWord);
  if (live && live.length) {
    const term = effKeyWord ? ` · “${effKeyWord}”` : "";
    return { live: true, source: `${s.liveLabel}${term}`, products: live.map((p) => enrich(id, p)), keyWord: effKeyWord };
  }
  return {
    live: false,
    source: supplierConfigured(id)
      ? `Sample catalog — ${s.noFeedNote}`
      : `Sample catalog — set ${s.envKeys.join(" + ")}`,
    products: productsOf(id).map((p) => enrich(id, p)),
    keyWord,
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

/** Honest live check. CJ: token + product search. Zendrop: inspect the body. */
export async function supplierVerify(id) {
  const s = supplier(id);
  if (!supplierConfigured(id)) return { ok: false, detail: `No ${s.envKeys[0]} set.` };
  if (id === "aliexpress") {
    try {
      const r = await cjCall("/product/listV2", {
        method: "GET",
        params: { page: "1", size: "1", startWarehouseInventory: "1" },
      });
      const n = r?.data?.totalRecords ?? r?.data?.total ?? "?";
      return { ok: true, detail: `Live — CJ Dropshipping OpenAPI reachable (${n} catalog records visible). Products pull live.` };
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
