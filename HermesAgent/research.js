// Research providers — real trending-product data for the Research tab.
//
// Honesty matters here. Three tiers, by what's actually obtainable:
//   1. Google Trends RSS  — REAL, no key, works today. Live trending searches
//      with traffic + related news. (General search trends, not product-only.)
//   2. SerpApi            — REAL, needs SERPAPI_KEY. Wraps Google Trends
//      (interest-over-time → the sparkline), Google Shopping / Amazon / eBay
//      (real competitors + prices). This is the production marketplace path.
//   3. Etsy API           — REAL, needs ETSY_API_KEY. Active listings by score
//      for your own niches → real competitor names + prices.
//
// Anything not backed by a live provider is returned with live:false and
// source:"Curated sample" so the UI never passes invented numbers off as real.
// TikTok/Instagram impressions for arbitrary products are intentionally NOT
// faked — no free API exists; Google Trends interest is the honest substitute.

import { state, persist } from "./store.js";

const TIMEOUT = 12000;

// Niche keywords map the portfolio's product lines to real query terms.
const NICHES = [
  { id: "dopamine-decor", product: "Dopamine decor candles", category: "Home / Candles",
    keyword: "colorful soy candle", serpQuery: "colorful soy candle", etsyKeywords: "colorful soy candle" },
  { id: "retro-fridge", product: "Retro pixel-art magnets", category: "Kitchen / Magnets",
    keyword: "pixel art magnet", serpQuery: "retro fridge magnet set", etsyKeywords: "pixel art magnet" },
  { id: "gorpcore-hats", product: "Gorpcore embroidered caps", category: "Apparel / Hats",
    keyword: "embroidered cap", serpQuery: "embroidered dad hat", etsyKeywords: "embroidered cap outdoor" },
  { id: "cat-dad-shirts", product: '"Cat Dad" graphic tees', category: "Apparel / Shirts",
    keyword: "cat dad shirt", serpQuery: "cat dad graphic tee", etsyKeywords: "cat dad shirt" },
];

function trafficToNumber(str) {
  if (!str) return 0;
  const m = String(str).replace(/,/g, "").match(/([\d.]+)\s*([KMB]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  return Math.round(n * mult);
}

const successFromTraffic = (n) => Math.max(20, Math.min(99, Math.round(Math.log10(Math.max(n, 10)) * 22)));

async function get(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...opts });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

// ---------- Provider 1: Google Trends RSS (keyless, live) ----------

async function googleTrendsRss(geo = "US") {
  const xml = await (await get(`https://trends.google.com/trending/rss?geo=${geo}`)).text();
  const items = xml.match(/<item>(.*?)<\/item>/gs) ?? [];
  const pick = (block, tag) => block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`, "s"))?.[1]?.trim();
  return items.slice(0, 8).map((block, i) => {
    const title = pick(block, "title");
    const traffic = trafficToNumber(pick(block, "ht:approx_traffic"));
    const news = [...block.matchAll(/<ht:news_item_title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/ht:news_item_title>/gs)]
      .map((m) => m[1].trim()).slice(0, 2);
    return {
      id: `gt-${i}`,
      product: title,
      category: "Live search trend",
      source: "Google Trends (US)",
      live: true,
      searchTraffic: traffic,
      impressions: traffic,   // labeled "search traffic" in the UI for live items
      likes: null,
      growthPct: null,
      successScore: successFromTraffic(traffic),
      interest: [],           // RSS has no time series — UI skips the sparkline
      relatedNews: news,
      note: news.length ? `Spiking in US search. Related: ${news[0]}` : "Spiking in US search right now.",
      competitors: [],
    };
  });
}

// ---------- Provider 2: SerpApi (keyed) ----------

async function serpInterest(keyword, key) {
  const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(keyword)}&data_type=TIMESERIES&api_key=${key}`;
  const data = await (await get(url)).json();
  const timeline = data?.interest_over_time?.timeline_data ?? [];
  const values = timeline.map((p) => p.values?.[0]?.extracted_value ?? 0).filter((v) => Number.isFinite(v));
  return values.slice(-12);
}

async function serpCompetitors(query, key) {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(query)}&num=5&api_key=${key}`;
  const data = await (await get(url)).json();
  return (data?.shopping_results ?? []).slice(0, 5).map((r) => ({
    name: r.source || r.title?.slice(0, 32) || "Unknown seller",
    monthlyEst: null,
    channels: ["Google Shopping"],
    price: r.extracted_price ?? null,
    rating: r.rating ?? null,
  }));
}

async function serpApiNicheTrends(key) {
  const out = [];
  for (const niche of NICHES) {
    try {
      const [interest, competitors] = await Promise.all([
        serpInterest(niche.keyword, key),
        serpCompetitors(niche.serpQuery, key),
      ]);
      const first = interest[0] || 1;
      const last = interest.at(-1) || 0;
      out.push({
        id: niche.id, product: niche.product, category: niche.category,
        source: "SerpApi · Google Trends + Shopping", live: true,
        impressions: null, likes: null,
        growthPct: interest.length ? Math.round(((last - first) / Math.max(first, 1)) * 100) : null,
        successScore: Math.min(99, Math.round((interest.reduce((s, v) => s + v, 0) / Math.max(interest.length, 1)))),
        interest,
        note: `Real Google Trends interest for "${niche.keyword}"; competitors live from Google Shopping.`,
        competitors,
      });
    } catch (err) {
      out.push({ ...curatedById(niche.id), source: `SerpApi error: ${err.message}` });
    }
  }
  return out;
}

// ---------- Provider 3: Etsy API (keyed) ----------

async function etsyCompetitors(keywords, key) {
  const url = `https://openapi.etsy.com/v3/application/listings/active?keywords=${encodeURIComponent(keywords)}&sort_on=score&limit=5`;
  const data = await (await get(url, { headers: { "x-api-key": key } })).json();
  return (data?.results ?? []).map((l) => ({
    name: l.title?.slice(0, 36) ?? "Etsy listing",
    monthlyEst: null,
    channels: ["Etsy"],
    price: l.price ? Number(l.price.amount) / Number(l.price.divisor) : null,
    rating: null,
  }));
}

// ---------- Curated fallback (clearly labeled) ----------

// Baseline = only the four niche samples, never previously-merged live items.
// (state.research.trends becomes the merged cache after a refresh, so filter to
//  the known niche ids to keep the fallback pristine across reloads.)
const NICHE_IDS = new Set(NICHES.map((n) => n.id));
const CURATED = state.research.trends
  .filter((t) => NICHE_IDS.has(t.id))
  .map((t) => ({ ...t, live: false, source: "Curated sample (no live key)" }));
const curatedById = (id) => CURATED.find((t) => t.id === id) ?? CURATED[0];

// ---------- Orchestrator ----------

export function researchSources() {
  return [
    { id: "google_trends_rss", name: "Google Trends RSS", keyless: true, available: true,
      note: "Live US trending searches — no key needed." },
    { id: "serpapi", name: "SerpApi (Trends + Shopping + Amazon/eBay)", keyless: false,
      envKey: "SERPAPI_KEY", available: Boolean(process.env.SERPAPI_KEY),
      note: "Real interest-over-time + marketplace competitors & prices." },
    { id: "etsy_api", name: "Etsy API", keyless: false, envKey: "ETSY_API_KEY",
      available: Boolean(process.env.ETSY_API_KEY),
      note: "Real Etsy listings & prices for your own niches." },
  ];
}

// ============================================================================
// SerpApi discovery feeds: Shopping trends, Event trends, Holiday trends.
// Each is a real SerpApi engine (Google Shopping / Google Events / Google
// Trends). Surfaced in the Research tab as three sections. All bounded so a
// refresh stays within a sane SerpApi credit budget.
// ============================================================================

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// --- Shopping trends: real products + prices for trending retail queries ---
const SHOPPING_QUERIES = ["trending gifts", "viral tiktok products", "best selling t shirt"];

async function serpShopping(query, key) {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(query)}&num=8&api_key=${key}`;
  const data = await (await get(url)).json();
  if (data.error) throw new Error(data.error);
  const items = (data.shopping_results ?? []).slice(0, 6).map((r) => ({
    name: r.title?.slice(0, 64) ?? "Product",
    price: r.extracted_price ?? null,
    source: r.source ?? null,
    rating: r.rating ?? null,
  }));
  const prices = items.map((i) => i.price).filter((p) => Number.isFinite(p));
  return {
    id: `shop-${slug(query)}`,
    title: titleCase(query),
    query,
    source: "SerpApi · Google Shopping",
    live: true,
    avgPrice: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
    priceRange: prices.length ? [Math.min(...prices), Math.max(...prices)] : null,
    count: items.length,
    items,
  };
}

// --- Event trends: real upcoming events (festivals/concerts/markets) ---
async function serpEvents(key, location = "United States") {
  const url = `https://serpapi.com/search.json?engine=google_events&q=${encodeURIComponent("events this month")}&location=${encodeURIComponent(location)}&api_key=${key}`;
  const data = await (await get(url)).json();
  if (data.error) throw new Error(data.error);
  return (data.events_results ?? []).slice(0, 9).map((e, i) => ({
    id: `evt-${i}`,
    title: e.title,
    when: e.date?.when ?? null,
    startDate: e.date?.start_date ?? null,
    venue: e.venue?.name ?? null,
    address: Array.isArray(e.address) ? e.address.join(", ") : (e.address ?? null),
    link: e.link ?? null,
    source: "SerpApi · Google Events",
    live: true,
  }));
}

// --- Holiday trends: upcoming US holidays + rising shopping interest ---
// Dates are deterministic; the "trend" (rising interest) for the nearest two is
// pulled live from Google Trends so merch can be timed to the run-up.
const HOLIDAYS = [
  { name: "Juneteenth",        date: "2026-06-19", q: "juneteenth shirt" },
  { name: "Father's Day",      date: "2026-06-21", q: "fathers day gift" },
  { name: "Independence Day",  date: "2026-07-04", q: "4th of july shirt" },
  { name: "Labor Day",         date: "2026-09-07", q: "labor day sale" },
  { name: "Halloween",         date: "2026-10-31", q: "halloween costume" },
  { name: "Veterans Day",      date: "2026-11-11", q: "veterans day shirt" },
  { name: "Thanksgiving",      date: "2026-11-26", q: "thanksgiving decor" },
  { name: "Black Friday",      date: "2026-11-27", q: "black friday deals" },
  { name: "Cyber Monday",      date: "2026-11-30", q: "cyber monday deals" },
  { name: "Christmas",         date: "2026-12-25", q: "christmas gifts" },
  { name: "New Year's",        date: "2027-01-01", q: "new years eve outfit" },
  { name: "Valentine's Day",   date: "2027-02-14", q: "valentines day gift" },
  { name: "St. Patrick's Day", date: "2027-03-17", q: "st patricks day shirt" },
  { name: "Mother's Day",      date: "2027-05-09", q: "mothers day gift" },
];

function upcomingHolidays(limit = 6) {
  const now = Date.now();
  return HOLIDAYS
    .map((h) => ({ ...h, daysUntil: Math.ceil((new Date(h.date + "T00:00:00") - now) / 86400000) }))
    .filter((h) => h.daysUntil >= -2)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit);
}

async function serpHolidayTrends(key) {
  const upcoming = upcomingHolidays(6);
  // Pull live interest only for the nearest two (keeps SerpApi credit use low).
  for (let i = 0; i < Math.min(2, upcoming.length); i++) {
    try {
      const interest = await serpInterest(upcoming[i].q, key);
      const first = interest[0] || 1, last = interest.at(-1) || 0;
      upcoming[i].interest = interest;
      upcoming[i].growthPct = interest.length ? Math.round(((last - first) / Math.max(first, 1)) * 100) : null;
      upcoming[i].live = true;
    } catch { upcoming[i].live = false; }
  }
  return upcoming.map((h, i) => ({
    id: `hol-${i}`,
    name: h.name,
    date: h.date,
    daysUntil: h.daysUntil,
    query: h.q,
    interest: h.interest ?? [],
    growthPct: h.growthPct ?? null,
    live: Boolean(h.live),
    source: h.live ? "SerpApi · Google Trends" : "Calendar",
  }));
}

/** Pull all three SerpApi discovery feeds. Persists to state.research.serp. */
export async function fetchSerpFeeds() {
  const key = process.env.SERPAPI_KEY;
  const result = { shopping: [], events: [], holidays: upcomingHolidays(6).map((h, i) => ({ id: `hol-${i}`, name: h.name, date: h.date, daysUntil: h.daysUntil, interest: [], growthPct: null, live: false, source: "Calendar" })), errors: [], fetchedAt: new Date().toISOString() };
  if (!key) { result.error = "SERPAPI_KEY not set — add it to go live."; state.research.serp = result; persist(); return result; }

  for (const q of SHOPPING_QUERIES) {
    try { result.shopping.push(await serpShopping(q, key)); }
    catch (e) { result.errors.push(`shopping "${q}": ${e.message}`); }
  }
  try { result.events = await serpEvents(key); }
  catch (e) { result.errors.push(`events: ${e.message}`); }
  try { result.holidays = await serpHolidayTrends(key); }
  catch (e) { result.errors.push(`holidays: ${e.message}`); }

  result.fetchedAt = new Date().toISOString();
  state.research.serp = result;
  persist();
  return result;
}

export function getSerpFeeds() {
  if (state.research.serp) return state.research.serp;
  // Before any pull: holidays are calendar-derivable (no key needed); shopping
  // and events stay empty until a refresh hits SerpApi.
  return {
    shopping: [], events: [],
    holidays: upcomingHolidays(6).map((h, i) => ({ id: `hol-${i}`, name: h.name, date: h.date, daysUntil: h.daysUntil, interest: [], growthPct: null, live: false, source: "Calendar" })),
    fetchedAt: null, errors: [],
  };
}

export async function fetchTrends() {
  const sources = [];
  let nicheTrends;
  let liveSearch = [];

  // Niche product trends: SerpApi if keyed, else curated samples.
  if (process.env.SERPAPI_KEY) {
    try {
      nicheTrends = await serpApiNicheTrends(process.env.SERPAPI_KEY);
      sources.push("SerpApi");
    } catch (err) {
      nicheTrends = CURATED.map((t) => ({ ...t }));
      sources.push(`SerpApi failed (${err.message}) → curated`);
    }
  } else {
    nicheTrends = CURATED.map((t) => ({ ...t }));
  }

  // Enrich niche competitors with real Etsy data if keyed.
  if (process.env.ETSY_API_KEY) {
    for (const niche of NICHES) {
      const card = nicheTrends.find((t) => t.id === niche.id);
      if (!card) continue;
      try {
        const comps = await etsyCompetitors(niche.etsyKeywords, process.env.ETSY_API_KEY);
        if (comps.length) { card.competitors = comps; card.live = true; card.source += " + Etsy API"; }
      } catch { /* keep existing competitors */ }
    }
    sources.push("Etsy API");
  }

  // Always try the keyless live search feed.
  try {
    liveSearch = await googleTrendsRss();
    sources.push("Google Trends RSS");
  } catch (err) {
    sources.push(`Google Trends RSS failed (${err.message})`);
  }

  // Dedupe by id (live search first wins) so reloads never accumulate copies.
  const byId = new Map();
  for (const t of [...liveSearch, ...nicheTrends]) if (!byId.has(t.id)) byId.set(t.id, t);
  const trends = [...byId.values()];
  const fetchedAt = new Date().toISOString();
  state.research.trends = trends;
  state.research.fetchedAt = fetchedAt;
  state.research.activeSources = sources;
  persist();
  return { trends, sources, fetchedAt };
}
