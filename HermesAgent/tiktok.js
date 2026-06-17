// TikTok Shop Partner API — OAuth connect + signed calls + live publish.
//
// Flow:
//   1. Seller authorizes the app on their shop (tiktokAuthUrl / Partner Center)
//      → TikTok redirects back with an auth_code.
//   2. tiktokExchange(authCode) swaps it for access + refresh tokens (stored in
//      state.tiktok, server-side, never sent to the browser).
//   3. Signed calls (HMAC-SHA256) hit open-api.tiktokglobalshop.com; tokens
//      auto-refresh. tiktokFetchShops() proves the connection and stores the
//      shop_cipher needed by every other call.
//   4. tiktokPublishProduct() creates a product on the connected shop.
//
// App key + secret come from env (TIKTOK_SHOP_APP_KEY/SECRET); the optional
// TIKTOK_SHOP_SERVICE_ID makes the authorize link clickable.

import crypto from "node:crypto";
import { state, persist } from "./store.js";

const AUTH_BASE = "https://auth.tiktok-shops.com";
const API_BASE = "https://open-api.tiktokglobalshop.com";

const env = () => ({
  key: process.env.TIKTOK_SHOP_APP_KEY,
  secret: process.env.TIKTOK_SHOP_APP_SECRET,
  serviceId: process.env.TIKTOK_SHOP_SERVICE_ID,
});
const now = () => Math.floor(Date.now() / 1000);

export function tiktokConfigured() {
  const { key, secret } = env();
  return Boolean(key && secret);
}
export function tiktokConnected() {
  const t = state.tiktok;
  return Boolean(t?.accessToken && (t.accessExpireAt || 0) > now() + 60);
}
/** Whether a refresh is still possible (access expired but refresh valid). */
function canRefresh() {
  const t = state.tiktok;
  return Boolean(t?.refreshToken && (t.refreshExpireAt || 0) > now() + 60);
}

/** The seller-facing authorization URL (needs TIKTOK_SHOP_SERVICE_ID). */
export function tiktokAuthUrl(stateParam = "hermes") {
  const { serviceId } = env();
  if (!serviceId) return null;
  return `https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(serviceId)}&state=${encodeURIComponent(stateParam)}`;
}

/** Connection snapshot for the dashboard (no secrets). */
export function tiktokConnection() {
  const t = state.tiktok || {};
  return {
    configured: tiktokConfigured(),
    connected: tiktokConnected() || canRefresh(),
    sellerName: t.sellerName ?? null,
    shop: t.shops?.[0]?.name ?? null,
    shopCount: t.shops?.length ?? 0,
    connectedAt: t.connectedAt ?? null,
    authUrl: tiktokAuthUrl(),
  };
}

// auth_code can be pasted raw or as the full redirected URL — pull it out.
export function extractAuthCode(input) {
  const s = String(input || "").trim();
  const m = s.match(/[?&](?:code|auth_code)=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : s;
}

export async function tiktokExchange(authCodeInput) {
  const { key, secret } = env();
  if (!key || !secret) throw new Error("TikTok Shop app key/secret not set");
  const authCode = extractAuthCode(authCodeInput);
  if (!authCode) throw new Error("auth_code required");
  const url = `${AUTH_BASE}/api/v2/token/get?app_key=${encodeURIComponent(key)}&app_secret=${encodeURIComponent(secret)}&auth_code=${encodeURIComponent(authCode)}&grant_type=authorized_code`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  if (j.code !== 0 || !j.data?.access_token) throw new Error(`TikTok token exchange failed: ${j.message || "no token"} (code ${j.code})`);
  const d = j.data;
  state.tiktok = {
    accessToken: d.access_token, refreshToken: d.refresh_token,
    accessExpireAt: Number(d.access_token_expire_in) || 0,
    refreshExpireAt: Number(d.refresh_token_expire_in) || 0,
    sellerName: d.seller_name ?? null, openId: d.open_id ?? null,
    shops: [], connectedAt: new Date().toISOString(),
  };
  persist();
  try { await tiktokFetchShops(); } catch { /* surfaced separately */ }
  return tiktokConnection();
}

export async function tiktokRefresh() {
  const { key, secret } = env();
  const rt = state.tiktok?.refreshToken;
  if (!rt) throw new Error("TikTok Shop not connected");
  const url = `${AUTH_BASE}/api/v2/token/refresh?app_key=${encodeURIComponent(key)}&app_secret=${encodeURIComponent(secret)}&refresh_token=${encodeURIComponent(rt)}&grant_type=refresh_token`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  if (j.code !== 0 || !j.data?.access_token) throw new Error(`TikTok token refresh failed: ${j.message} (code ${j.code})`);
  const d = j.data;
  state.tiktok.accessToken = d.access_token;
  state.tiktok.accessExpireAt = Number(d.access_token_expire_in) || 0;
  if (d.refresh_token) state.tiktok.refreshToken = d.refresh_token;
  if (d.refresh_token_expire_in) state.tiktok.refreshExpireAt = Number(d.refresh_token_expire_in);
  persist();
}

export function tiktokDisconnect() {
  state.tiktok = { accessToken: null, refreshToken: null, accessExpireAt: 0, refreshExpireAt: 0, sellerName: null, openId: null, shops: [], connectedAt: null };
  persist();
}

// TikTok Shop request signing: HMAC-SHA256 over
//   secret + path + (sorted {key}{value} of query, minus sign/access_token) + body + secret
function sign(path, query, body, secret) {
  const base = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");
  const str = `${secret}${path}${base}${body || ""}${secret}`;
  return crypto.createHmac("sha256", secret).update(str).digest("hex");
}

async function apiCall(method, path, { query = {}, body = null, useShop = true } = {}) {
  if (!tiktokConnected()) {
    if (canRefresh()) await tiktokRefresh();
    else throw new Error("TikTok Shop not connected — authorize the app on your shop first.");
  }
  const { key, secret } = env();
  const q = { app_key: key, timestamp: String(now()), ...query };
  if (useShop && state.tiktok.shops?.[0]?.cipher) q.shop_cipher = state.tiktok.shops[0].cipher;
  const bodyStr = body ? JSON.stringify(body) : "";
  q.sign = sign(path, q, bodyStr, secret);
  const url = `${API_BASE}${path}?${new URLSearchParams(q).toString()}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "x-tts-access-token": state.tiktok.accessToken },
    body: body ? bodyStr : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}

export async function tiktokFetchShops() {
  const r = await apiCall("GET", "/authorization/202309/shops", { useShop: false });
  if (r.code !== 0) throw new Error(`TikTok shops fetch failed: ${r.message} (code ${r.code})`);
  const shops = (r.data?.shops || []).map((s) => ({ id: s.id, name: s.name, region: s.region, cipher: s.cipher, code: s.code }));
  state.tiktok.shops = shops;
  persist();
  return shops;
}

/** Best-effort live publish of a product to the connected shop. Returns the raw
 *  TikTok response so the dashboard can surface exactly what happened (product
 *  creation needs a leaf category + warehouse + images; we send what we have
 *  and report what's missing rather than pretend success). */
export async function tiktokPublishProduct(product) {
  if (!tiktokConnected() && !canRefresh()) throw new Error("TikTok Shop not connected.");
  if (!state.tiktok.shops?.length) await tiktokFetchShops();
  const body = {
    save_mode: "AS_DRAFT",
    title: String(product.name || "Product").slice(0, 255),
    description: `<p>${(product.name || "")}</p>`,
    package_weight: { value: "0.5", unit: "KILOGRAM" },
    main_images: product.image ? [{ uri: product.image }] : [],
    skus: [{
      inventory: [{ quantity: 99 }],
      price: { amount: String(product.retail ?? product.cost ?? 0), currency: "USD" },
    }],
  };
  const r = await apiCall("POST", "/product/202309/products", { body });
  return r; // { code, message, data }
}
