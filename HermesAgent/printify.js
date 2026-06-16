// Printify integration — REAL calls to https://api.printify.com/v1/.
// Unlike Zendrop, Printify has a documented public REST API and this token
// authenticates live (verified: returns real shops). Reads are used freely;
// writes (create/publish/orders) are intentionally NOT auto-invoked here —
// they stay behind the agent's confirmation rules / explicit tools.

import { prepareDesign } from "./imagefx.js";
import { generateListingCopy, countryName } from "./describe.js";

const BASE = "https://api.printify.com/v1";
const TIMEOUT = 15000;

export const printifyConfigured = () => Boolean(process.env.PRINTIFY_API_TOKEN);

async function pf(path) {
  const token = process.env.PRINTIFY_API_TOKEN;
  if (!token) throw new Error("PRINTIFY_API_TOKEN not set");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "HermesCommand" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Printify ${res.status} on ${path}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

export async function printifyShops() {
  return pf("/shops.json"); // [{id, title, sales_channel}]
}

export async function printifyProducts(shopId, limit = 10) {
  const data = await pf(`/shops/${shopId}/products.json?limit=${limit}`);
  const items = data?.data ?? [];
  return {
    total: data?.total ?? items.length,
    products: items.map((p) => ({
      id: p.id,
      title: p.title,
      visible: p.visible,
      blueprintId: p.blueprint_id,
      variants: (p.variants ?? []).length,
      image: (p.images ?? []).find((i) => i.is_default)?.src ?? p.images?.[0]?.src ?? null,
      minPrice: Math.min(...((p.variants ?? []).filter((v) => v.is_enabled).map((v) => v.price / 100) || [0])) || null,
    })),
  };
}

const mask = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-6)} (JWT, ${t.length} chars)` : null);

/** Live status: real shops + product counts. Tolerant of API hiccups. */
export async function printifyStatus() {
  const token = process.env.PRINTIFY_API_TOKEN;
  if (!token) {
    return { configured: false, maskedToken: null, shops: [], detail: "No PRINTIFY_API_TOKEN set." };
  }
  try {
    const shops = await printifyShops();
    const withCounts = [];
    for (const s of shops) {
      let productCount = null;
      try { productCount = (await pf(`/shops/${s.id}/products.json?limit=1`)).total ?? null; } catch { /* skip */ }
      withCounts.push({ id: s.id, title: s.title, salesChannel: s.sales_channel, products: productCount });
    }
    return {
      configured: true,
      live: true,
      maskedToken: mask(token),
      scopes: decodeScopes(token),
      shops: withCounts,
      detail: `Connected — ${withCounts.length} shop(s).`,
    };
  } catch (err) {
    return { configured: true, live: false, maskedToken: mask(token), shops: [], detail: err.message };
  }
}

// ---------- Catalog (real product types you can put designs on) ----------
//
// Printify's catalog API does NOT expose base cost (verified: variants carry
// only id/title/options/placeholders). So the dashboard shows the real product
// + image + colors/sizes, plus a per-unit RETAIL price you set (default below).

const CATALOG_SPEC = [
  { category: "T-Shirt",    re: /\btee|t-shirt\b/i,        prefer: ["unisex.*cotton", "unisex"],            retail: 24.99 },
  { category: "Hoodie",     re: /hoodie/i,                 prefer: ["unisex.*hoodie", "pullover", "hoodie"], retail: 44.99 },
  { category: "Sweatshirt", re: /sweatshirt/i,             prefer: ["unisex", "crewneck"],                  retail: 39.99 },
  { category: "Mug",        re: /\bmug\b/i,                prefer: ["11oz", "white"],                       retail: 14.99 },
  { category: "Hat",        re: /\b(dad hat|snapback|trucker|cap|hat|beanie)\b/i, prefer: ["dad hat", "snapback", "trucker", "classic"], retail: 22.99 },
  { category: "Tote Bag",   re: /tote/i,                   prefer: ["canvas"],                              retail: 19.99 },
  { category: "Sticker",    re: /sticker/i,                prefer: ["kiss-cut", "die-cut", "square"],       retail: 4.99 },
  { category: "Poster",     re: /poster/i,                 prefer: ["matte", "satin"],                      retail: 16.99 },
  { category: "Phone Case", re: /phone case/i,             prefer: ["tough", "slim", "clear"],              retail: 21.99 },
  { category: "Tumbler",    re: /tumbler/i,                prefer: ["20oz", "stainless"],                   retail: 29.99 },
];

let _blueprintCache = null;
async function allBlueprints() {
  if (!_blueprintCache) _blueprintCache = await pf("/catalog/blueprints.json");
  return _blueprintCache;
}

function pickBlueprint(blueprints, spec) {
  const adult = blueprints.filter((b) => spec.re.test(b.title) && !/baby|kids|toddler|youth|infant/i.test(b.title));
  const pool = adult.length ? adult : blueprints.filter((b) => spec.re.test(b.title));
  for (const p of spec.prefer) { const m = pool.find((b) => new RegExp(p, "i").test(b.title)); if (m) return m; }
  return pool.find((b) => /unisex/i.test(b.title)) || pool[0];
}

/** Curated catalog: one real blueprint per common merch category. */
export async function printifyCatalog(pricingOverrides = {}) {
  const blueprints = await allBlueprints();
  return CATALOG_SPEC.map((spec) => {
    const b = pickBlueprint(blueprints, spec);
    if (!b) return null;
    return {
      category: spec.category,
      blueprintId: b.id,
      title: b.title,
      brand: b.brand,
      image: (b.images ?? [])[0] ?? null,
      retail: pricingOverrides[b.id] ?? spec.retail,
      defaultRetail: spec.retail,
    };
  }).filter(Boolean);
}

/** Blueprint detail for the mockup studio: front image, colors, sizes, print area. */
export async function printifyBlueprintDetail(blueprintId) {
  const blueprints = await allBlueprints();
  const b = blueprints.find((x) => String(x.id) === String(blueprintId));
  if (!b) throw new Error(`Unknown blueprint ${blueprintId}`);
  const providers = await pf(`/catalog/blueprints/${blueprintId}/print_providers.json`);
  const pid = providers[0]?.id;
  let colors = [], sizes = [], front = null;
  if (pid) {
    const v = await pf(`/catalog/blueprints/${blueprintId}/print_providers/${pid}/variants.json`);
    const variants = v.variants ?? [];
    colors = [...new Set(variants.map((x) => x.options?.color).filter(Boolean))];
    sizes = [...new Set(variants.map((x) => x.options?.size).filter(Boolean))];
    front = (variants[0]?.placeholders ?? []).find((p) => p.position === "front") ?? null;
  }
  return {
    blueprintId: b.id, title: b.title, brand: b.brand,
    images: (b.images ?? []).slice(0, 4),
    colors, sizes,
    printArea: front ? { width: front.width, height: front.height } : null,
    providerId: pid,
  };
}

/**
 * Real facts for the listing copy: the product's material (from the blueprint
 * description) and its country of manufacture (from the print provider's
 * location). Provider location only comes back from the GLOBAL provider
 * endpoint, not the per-blueprint one. providerId is resolved if omitted.
 */
export async function printifyListingFacts(blueprintId, providerId) {
  const blueprints = await allBlueprints();
  const b = blueprints.find((x) => String(x.id) === String(blueprintId));
  if (!providerId) {
    const providers = await pf(`/catalog/blueprints/${blueprintId}/print_providers.json`);
    providerId = providers[0]?.id;
  }
  let country = null, providerTitle = null;
  if (providerId) {
    try {
      const prov = await pf(`/catalog/print_providers/${providerId}.json`);
      country = countryName(prov?.location?.country);
      providerTitle = prov?.title || null;
    } catch { /* leave null → "imported" */ }
  }
  const description = (b?.description || "")
    .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ")
    .replace(/\.:/g, ". ")        // Printify uses ".:" as bullet markers
    .replace(/\s+/g, " ").replace(/\s+([.,;])/g, "$1").trim();
  return {
    blueprintId, providerId,
    productType: b?.title ?? null,
    brand: b?.brand ?? null,
    model: b?.model ?? null,
    blueprintDescription: description,
    material: null,           // describe.js extracts a material sentence from the description
    country,                  // friendly name, e.g. "Germany"
    providerTitle,
  };
}

// ---------- Listing to Etsy via Printify (real writes) ----------
//
// Full flow: upload design image → create product (with variants priced +
// the image placed in the front print area) → publish to the Etsy-connected
// shop. These are real, customer-visible writes, so the dashboard only fires
// them on an explicit user click; dryRun:true validates the payload first.

async function pfWrite(path, body) {
  const token = process.env.PRINTIFY_API_TOKEN;
  if (!token) throw new Error("PRINTIFY_API_TOKEN not set");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "HermesCommand", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Printify ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** The shop connected to Etsy (sales_channel: "etsy"), or null. */
export async function printifyEtsyShop() {
  const shops = await printifyShops();
  return shops.find((s) => s.sales_channel === "etsy") ?? null;
}

export async function printifyUploadImage(fileName, src) {
  // src is a public URL (Higgsfield CDN) → Printify fetches it.
  return pfWrite("/uploads/images.json", { file_name: fileName, url: src });
}
export async function printifyUploadBase64(fileName, base64) {
  return pfWrite("/uploads/images.json", { file_name: fileName, contents: base64 });
}

export async function printifyGetProduct(shopId, productId) {
  return pf(`/shops/${shopId}/products/${productId}.json`);
}

/** Delist a product from the connected store (e.g. Etsy) without deleting it. */
export async function printifyDelist(shopId, productId) {
  await pfWrite(`/shops/${shopId}/products/${productId}/unpublish.json`, {});
  return { delisted: true, productId, shopId, detail: `Unpublished product ${productId} from shop ${shopId}.` };
}

/**
 * Placement scale so a cropped design fills the print area without distortion
 * (contain-at-max). Printify scale is the image width as a fraction of the
 * print-area width; the image keeps its own aspect ratio.
 */
function fitScale(imgW, imgH, areaW, areaH) {
  if (!imgW || !imgH || !areaW || !areaH) return 0.92;
  const imgAspect = imgW / imgH, areaAspect = areaW / areaH;
  // wider-than-area → width-bound (scale 1); taller-than-area → height-bound (<1)
  return Math.min(1, imgAspect / areaAspect);
}

/**
 * List a design to Etsy via Printify.
 * opts: { imageUrl, title, description?, price, blueprintId, shopId?, designTitle?, designPrompt? }
 * options: { dryRun, publish (default true), matchBackground (default true), cropToFit (default true) }
 *   matchBackground removes the white background → transparent so the design
 *     matches the garment color on every variant.
 *   cropToFit trims empty margins and scales the design to fill the print area.
 *   If no description is supplied, one is generated (Claude → material/country/
 *     design inspiration, grounded in real Printify facts).
 * Returns the created/published product, or (dryRun) the prepared plan.
 */
export async function printifyListToEtsy(opts, { dryRun = false, publish = true, matchBackground = true, cropToFit = true } = {}) {
  const { imageUrl, title, price, blueprintId } = opts;
  let description = opts.description || "";
  if (!imageUrl || !title || !price || !blueprintId) {
    throw new Error("imageUrl, title, price and blueprintId are required.");
  }
  const etsyShop = opts.shopId ? { id: opts.shopId } : await printifyEtsyShop();
  if (!etsyShop) throw new Error("No Etsy-connected Printify shop found (sales_channel 'etsy').");

  // Provider + variants for the chosen blueprint.
  const providers = await pf(`/catalog/blueprints/${blueprintId}/print_providers.json`);
  const providerId = providers[0]?.id;
  if (!providerId) throw new Error(`No print provider for blueprint ${blueprintId}.`);
  const variantData = await pf(`/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`);
  const allVariants = variantData.variants ?? [];
  const chosen = allVariants.slice(0, 100); // cap so the listing stays manageable
  const priceCents = Math.round(Number(price) * 100);
  const front = (allVariants[0]?.placeholders ?? []).find((p) => p.position === "front") ?? null;

  const plan = {
    shopId: etsyShop.id, blueprintId, providerId,
    variantsEnabled: chosen.length, priceUsd: Number(price),
    imageUrl, title, matchBackground, cropToFit, publish, willPublishTo: publish ? "Etsy" : "(create only — not published)",
  };
  if (dryRun) return { dryRun: true, plan };

  // 0) Description — generate from real product facts if the caller didn't supply one.
  if (!description) {
    try {
      const facts = await printifyListingFacts(blueprintId, providerId);
      const copy = await generateListingCopy({ facts, productTitle: title, designTitle: opts.designTitle, designPrompt: opts.designPrompt });
      description = copy.description;
    } catch { description = title; }
  }

  // 1) Prepare + upload the design. Background-match → transparent, and/or crop
  //    to content so it fills the print area; uploaded as base64. Only fall back
  //    to the raw URL when both transforms are off.
  let upload, bgPctChanged = null, placement = { x: 0.5, y: 0.5, scale: 0.9, angle: 0 };
  const safeName = `${title}.png`.replace(/[^\w.\- ]/g, "");
  if (matchBackground || cropToFit) {
    const prepped = await prepareDesign(imageUrl, { matchBg: matchBackground, crop: cropToFit });
    bgPctChanged = matchBackground ? prepped.pctChanged : null;
    upload = await printifyUploadBase64(safeName, prepped.base64);
    if (cropToFit && front) placement.scale = fitScale(prepped.width, prepped.height, front.width, front.height);
  } else {
    upload = await printifyUploadImage(safeName, imageUrl);
  }

  // 2) Create the product.
  const product = await pfWrite(`/shops/${etsyShop.id}/products.json`, {
    title,
    description: description || title,
    blueprint_id: Number(blueprintId),
    print_provider_id: providerId,
    variants: chosen.map((v) => ({ id: v.id, price: priceCents, is_enabled: true })),
    print_areas: [{
      variant_ids: chosen.map((v) => v.id),
      placeholders: [{ position: "front", images: [{ id: upload.id, ...placement }] }],
    }],
  });

  // 3) Optionally publish to the connected Etsy store.
  if (publish) {
    await pfWrite(`/shops/${etsyShop.id}/products/${product.id}/publish.json`, {
      title: true, description: true, images: true, variants: true,
      tags: true, keyFeatures: true, shipping_template: true,
    });
  }

  // Mockups + the live Etsy URL generate async — re-fetch to grab them.
  let mockup = (product.images ?? []).find((i) => i.is_default)?.src ?? product.images?.[0]?.src ?? null;
  let etsyUrl = product.external?.handle ?? null;
  if (!mockup || (publish && !etsyUrl)) {
    try {
      const fresh = await printifyGetProduct(etsyShop.id, product.id);
      mockup = mockup ?? (fresh.images ?? [])[0]?.src ?? null;
      etsyUrl = etsyUrl ?? fresh.external?.handle ?? null;
    } catch { /* ok */ }
  }

  return {
    dryRun: false, productId: product.id, shopId: etsyShop.id, title: product.title,
    backgroundMatched: matchBackground, bgPctChanged, cropped: cropToFit, placementScale: Number(placement.scale.toFixed(3)),
    published: publish, mockup, etsyUrl, description,
    detail: `Created Printify product ${product.id}${publish ? " and published to Etsy" : " (not published)"} on shop ${etsyShop.id}.`,
  };
}

/** Pull the granted scopes out of the JWT payload (no verification needed — display only). */
function decodeScopes(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
    return payload.scopes ?? [];
  } catch { return []; }
}
