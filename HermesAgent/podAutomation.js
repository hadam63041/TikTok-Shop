import { state, persist, logActivity } from "./store.js";
import { fetchTrends, fetchSerpFeeds, getSerpFeeds } from "./research.js";
import { printifyCatalog, printifyListToEtsy } from "./printify.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const NICHE_GROUPS = [
  { id: "pet-owners", name: "Pet owners", interests: ["dog mom", "cat dad", "rescue pets", "breed pride"], spendIndex: 94, products: ["T-Shirt", "Mug", "Sticker"], note: "Identity-driven buyers; gifts and breed-specific humor perform strongly." },
  { id: "sports-fans", name: "Sports fanbases", interests: ["local pride", "playoff runs", "tailgate humor"], spendIndex: 91, products: ["T-Shirt", "Hat", "Mug"], note: "High urgency around events, but avoid trademarked team names/logos unless licensed." },
  { id: "cultural-heritage", name: "Cultural heritage and community", interests: ["Black history", "freedom", "heritage", "community pride"], spendIndex: 89, products: ["T-Shirt", "Tote Bag", "Poster"], note: "Buyers respond to respectful identity, history, pride, and community-centered designs." },
  { id: "parents-family", name: "Parents and family gifting", interests: ["Father's Day", "Mother's Day", "new parents", "grandparents"], spendIndex: 88, products: ["Mug", "T-Shirt", "Tote Bag"], note: "Holiday-driven gift intent; short sentimental copy works well." },
  { id: "hobbyists", name: "Hobby communities", interests: ["fishing", "gardening", "gaming", "crafting"], spendIndex: 84, products: ["T-Shirt", "Hat", "Sticker"], note: "Buyers respond to insider jokes and activity-specific identity signals." },
  { id: "event-goers", name: "Event-goers and local culture", interests: ["local events", "festivals", "city pride", "community"], spendIndex: 82, products: ["T-Shirt", "Tote Bag", "Poster"], note: "Limited-time local/event merch works best when it captures place, date, mood, and shared attendance." },
  { id: "music-fandom", name: "Music and festival fans", interests: ["concert season", "festival outfits", "genre aesthetics"], spendIndex: 80, products: ["T-Shirt", "Tote Bag", "Poster"], note: "Aesthetic-led merch works well, but avoid artist names and protected marks." },
  { id: "teachers-nurses", name: "Profession identity groups", interests: ["teacher life", "nurse humor", "shift survival"], spendIndex: 78, products: ["T-Shirt", "Mug", "Tote Bag"], note: "Evergreen communities with seasonal spikes around appreciation weeks." },
];

const STOPWORDS = new Set(["the", "and", "with", "for", "this", "that", "from", "your", "best", "sale", "deals", "gift"]);
const NICHE_BY_ID = Object.fromEntries(NICHE_GROUPS.map((n) => [n.id, n]));
const EVENT_CONTEXTS = [
  {
    match: /juneteenth|june\s*19/i,
    nicheId: "cultural-heritage",
    meaning: "Juneteenth commemorates June 19, 1865, when enslaved people in Galveston, Texas were informed of emancipation. It is about Black freedom, remembrance, resilience, heritage, and community celebration.",
    themes: ["freedom", "emancipation", "Black American heritage", "remembrance", "resilience", "community celebration"],
    palette: "red, black, green, gold, and warm celebratory accents",
    avoid: "Do not use pets, animals, trivial jokes, stereotypes, copyrighted marks, or unrelated party imagery.",
  },
  {
    match: /father'?s day|fathers day/i,
    nicheId: "parents-family",
    meaning: "Father's Day is a family gifting holiday focused on appreciation, humor, gratitude, and dad identity.",
    themes: ["dad pride", "family appreciation", "fatherhood", "giftable humor"],
    palette: "warm neutrals, navy, forest green, cream, and high-contrast lettering",
    avoid: "Avoid generic clipart clutter; keep the message giftable and readable.",
  },
  {
    match: /independence day|4th of july|fourth of july/i,
    nicheId: "event-goers",
    meaning: "Independence Day is a U.S. civic holiday centered on summer gatherings, fireworks, national colors, and community celebration.",
    themes: ["summer celebration", "fireworks", "cookouts", "community pride", "red white and blue"],
    palette: "red, white, blue, navy, and vintage cream",
    avoid: "Avoid official seals, military insignia, partisan slogans, or flag misuse.",
  },
  {
    match: /halloween/i,
    nicheId: "hobbyists",
    meaning: "Halloween merch is driven by playful spooky identity, parties, costumes, seasonal decor, and horror/comedy aesthetics.",
    themes: ["spooky season", "ghosts", "witchy humor", "pumpkins", "costume party energy"],
    palette: "orange, black, purple, slime green, and cream",
    avoid: "Avoid gore-heavy imagery for broad Etsy appeal.",
  },
  {
    match: /thanksgiving/i,
    nicheId: "parents-family",
    meaning: "Thanksgiving merch is family and hosting focused, centered on gratitude, food, autumn gatherings, and cozy seasonal humor.",
    themes: ["gratitude", "family gathering", "autumn hosting", "comfort food"],
    palette: "cranberry, copper, pumpkin, brown, cream, and muted green",
    avoid: "Avoid insensitive historical imagery or stereotypes.",
  },
  {
    match: /christmas/i,
    nicheId: "parents-family",
    meaning: "Christmas merch is gift-driven and seasonal, centered on family, cozy winter aesthetics, ornaments, humor, and celebration.",
    themes: ["cozy winter", "family gifts", "holiday humor", "ornaments", "festive typography"],
    palette: "red, pine green, gold, cream, and icy blue",
    avoid: "Avoid copyrighted characters, lyrics, or brand references.",
  },
];
const DEFAULT_HIGGSFIELD_CLI = path.join(__dirname, "..", ".tools", "node-v22.12.0-darwin-arm64", "bin", "higgsfield");
const DEFAULT_HIGGSFIELD_NODE_BIN = path.dirname(DEFAULT_HIGGSFIELD_CLI);

function defaultConfig() {
  return {
    enabled: process.env.POD_AUTOMATION_ENABLED === "true",
    intervalDays: Number(process.env.POD_AUTOMATION_INTERVAL_DAYS || 7),
    maxDesignsPerRun: Number(process.env.POD_AUTOMATION_MAX_DESIGNS || 3),
    autoPublish: process.env.POD_AUTOPUBLISH === "true",
    matchBackground: true,
    cropToFit: true,
    lastRunAt: null,
    nextRunAt: null,
  };
}

function ensureState() {
  if (!state.podAutomation) state.podAutomation = { config: defaultConfig(), runs: [], opportunities: [], nicheResearch: NICHE_GROUPS };
  if (!state.podAutomation.config) state.podAutomation.config = defaultConfig();
  if (!Array.isArray(state.podAutomation.runs)) state.podAutomation.runs = [];
  if (!Array.isArray(state.podAutomation.opportunities)) state.podAutomation.opportunities = [];
  if (!Array.isArray(state.podAutomation.nicheResearch)) state.podAutomation.nicheResearch = NICHE_GROUPS;
  return state.podAutomation;
}

function nextRunFrom(date, intervalDays) {
  return new Date(new Date(date).getTime() + Math.max(1, intervalDays) * DAY_MS).toISOString();
}

function safeSlug(s) {
  return String(s || "design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "design";
}

function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

function keywordTokens(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function contextFor(title, query = "") {
  const text = `${title || ""} ${query || ""}`;
  return EVENT_CONTEXTS.find((ctx) => ctx.match.test(text)) ?? null;
}

function cleanContext(ctx) {
  if (!ctx) return null;
  const { nicheId, meaning, themes, palette, avoid } = ctx;
  return { nicheId, meaning, themes, palette, avoid };
}

function nicheForText(text, fallbackId = "hobbyists") {
  const tokens = new Set(keywordTokens(text));
  const scored = NICHE_GROUPS.map((n) => {
    const hits = n.interests.reduce((s, phrase) => s + keywordTokens(phrase).filter((t) => tokens.has(t)).length, 0);
    return { niche: n, hits, score: hits * 12 + n.spendIndex / 10 };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.hits > 0 ? scored[0].niche : (NICHE_BY_ID[fallbackId] ?? NICHE_BY_ID.hobbyists);
}

function productForOpportunity(opp, catalog) {
  const preferred = opp.niche.products;
  for (const p of preferred) {
    const match = catalog.find((c) => c.category === p);
    if (match) return match;
  }
  return catalog.find((c) => c.category === "T-Shirt") ?? catalog[0];
}

function scoreOpportunity(base, niche, eventBoost = 0) {
  const growth = Number(base.growthPct ?? 0);
  const success = Number(base.successScore ?? 60);
  const traffic = Number(base.searchTraffic ?? base.impressions ?? 0);
  const trafficScore = traffic ? Math.min(25, Math.log10(Math.max(traffic, 10)) * 4) : 8;
  return Math.round(success * 0.45 + niche.spendIndex * 0.35 + Math.max(-10, Math.min(25, growth)) * 0.6 + trafficScore + eventBoost);
}

function buildOpportunities(trends, serp) {
  const out = [];
  for (const t of trends ?? []) {
    const text = [t.product, t.category, t.note].filter(Boolean).join(" ");
    const niche = nicheForText(text);
    out.push({
      id: `trend-${safeSlug(t.id || t.product)}`,
      type: "trend",
      title: t.product,
      query: t.product,
      source: t.source,
      niche,
      score: scoreOpportunity(t, niche),
      evidence: {
        successScore: t.successScore ?? null,
        growthPct: t.growthPct ?? null,
        searchTraffic: t.searchTraffic ?? t.impressions ?? null,
        competitors: (t.competitors ?? []).slice(0, 4),
      },
    });
  }
  for (const h of serp?.holidays ?? []) {
    const eventContext = contextFor(h.name, h.query);
    const niche = eventContext?.nicheId ? NICHE_BY_ID[eventContext.nicheId] : nicheForText(`${h.name} ${h.query}`, "event-goers");
    const eventBoost = h.daysUntil != null && h.daysUntil <= 45 ? 18 : 5;
    out.push({
      id: `holiday-${safeSlug(h.name)}`,
      type: "holiday",
      title: h.name,
      query: h.query || h.name,
      source: h.source,
      niche,
      eventContext: cleanContext(eventContext),
      score: scoreOpportunity({ growthPct: h.growthPct, successScore: h.live ? 72 : 55 }, niche, eventBoost),
      evidence: { date: h.date, daysUntil: h.daysUntil, growthPct: h.growthPct ?? null, interest: h.interest ?? [] },
    });
  }
  for (const e of serp?.events ?? []) {
    const eventContext = contextFor(e.title);
    const niche = eventContext?.nicheId ? NICHE_BY_ID[eventContext.nicheId] : nicheForText(`${e.title} ${e.venue} ${e.address}`, "event-goers");
    out.push({
      id: `event-${safeSlug(e.title)}`,
      type: "event",
      title: e.title,
      query: e.title,
      source: e.source,
      niche,
      eventContext: cleanContext(eventContext),
      score: scoreOpportunity({ successScore: 65 }, niche, 12),
      evidence: { when: e.when, venue: e.venue, address: e.address, link: e.link },
    });
  }
  return out
    .filter((o) => o.title && !/knicks|nba|nfl|mlb|nhl|disney|marvel|pokemon|taylor swift/i.test(o.title))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function promptFor(opp, product) {
  const ctx = opp.eventContext;
  return [
    "Generate a standalone print-ready graphic design only.",
    "Use a clean, flat, plain white (#ffffff) background.",
    "Do not show the artwork on a shirt, mug, hat, tote bag, product mockup, mannequin, hanger, model, room scene, or product photo.",
    `The final target product may be ${product.category}, but do not render the product itself.`,
    "Hermes will later convert the white background, including negative spaces inside letters and numbers, so the product fabric/color shows through.",
    `Trend/event: ${opp.title}.`,
    `Target niche: ${opp.niche.name}; interests: ${opp.niche.interests.join(", ")}.`,
    ctx ? `Event meaning/research: ${ctx.meaning}` : "Research guidance: match the real subject matter and buyer identity behind the trend, not just the keyword.",
    ctx ? `Design themes to use: ${ctx.themes.join(", ")}.` : `Design themes to use: ${opp.niche.interests.join(", ")}.`,
    ctx?.palette ? `Suggested palette: ${ctx.palette}.` : "Suggested palette: high contrast commercial POD colors.",
    ctx?.avoid ? `Avoid: ${ctx.avoid}` : "Avoid unrelated animals/pets unless the trend is actually pet-related. Avoid copyrighted logos, celebrity names, official team marks, and protected characters.",
    "Style: bold readable typography, original illustration, centered composition, scalable vector-poster look, commercial Etsy listing quality.",
  ].join(" ");
}

function svgDataUrl({ title, subtitle, palette = ["#fcee0a", "#02d7f2", "#ff003c"] }) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const words = titleCase(title).split(/\s+/).slice(0, 5);
  const top = words.slice(0, Math.ceil(words.length / 2)).join(" ");
  const bottom = words.slice(Math.ceil(words.length / 2)).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="0 0 1600 1600">
<rect width="1600" height="1600" fill="#ffffff"/>
<circle cx="800" cy="800" r="565" fill="none" stroke="${palette[1]}" stroke-width="34"/>
<path d="M225 720 C420 270 1140 270 1375 720" fill="none" stroke="${palette[2]}" stroke-width="42" stroke-linecap="round"/>
<path d="M260 925 C500 1260 1110 1260 1340 925" fill="none" stroke="${palette[0]}" stroke-width="42" stroke-linecap="round"/>
<text x="800" y="710" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-size="138" fill="#10151c" letter-spacing="2">${esc(top)}</text>
<text x="800" y="875" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-size="138" fill="#10151c" letter-spacing="2">${esc(bottom || "MERCH")}</text>
<text x="800" y="1010" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" fill="#10151c">${esc(subtitle)}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function generateWithHiggsfield(prompt, title) {
  let cliError = null;
  try {
    const cliResult = await generateWithHiggsfieldCli(prompt);
    if (cliResult) return cliResult;
  } catch (err) {
    cliError = err;
  }

  const url = process.env.HIGGSFIELD_API_URL;
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!url || !key) {
    if (cliError) throw cliError;
    return null;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ prompt, title, type: "image", transparent_background: true }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return data.imageUrl || data.image_url || data.url || data.output?.[0]?.url || null;
}

function firstUrl(value) {
  if (!value) return null;
  if (typeof value === "string") return /^https?:\/\//.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of ["url", "imageUrl", "image_url", "resultUrl", "result_url", "downloadUrl", "download_url", "src"]) {
      const found = firstUrl(value[key]);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = firstUrl(item);
      if (found) return found;
    }
  }
  return null;
}

async function generateWithHiggsfieldCli(prompt) {
  const cli = process.env.HIGGSFIELD_CLI_PATH || DEFAULT_HIGGSFIELD_CLI;
  const model = process.env.HIGGSFIELD_IMAGE_MODEL || "nano_banana_2";
  try {
    const { stdout } = await execFileAsync(cli, [
      "--json",
      "--no-color",
      "generate",
      "create",
      model,
      "--prompt",
      prompt,
      "--wait",
      "--wait-timeout",
      process.env.HIGGSFIELD_WAIT_TIMEOUT || "20m",
      "--wait-interval",
      process.env.HIGGSFIELD_WAIT_INTERVAL || "5s",
    ], {
      timeout: 25 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        PATH: `${DEFAULT_HIGGSFIELD_NODE_BIN}:${process.env.PATH || ""}`,
      },
    });
    const text = stdout.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return firstUrl(parsed);
    } catch {
      return text.match(/https?:\/\/\S+/)?.[0]?.replace(/[)\].,]+$/, "") ?? null;
    }
  } catch (err) {
    const msg = String(err.stderr || err.message || err).slice(0, 220);
    throw new Error(`Higgsfield CLI failed: ${msg}`);
  }
}

async function generateDesign(opp, product) {
  const prompt = promptFor(opp, product);
  let imageUrl = null;
  let source = "Hermes local generator";
  try {
    imageUrl = await generateWithHiggsfield(prompt, opp.title);
    if (imageUrl) source = "Higgsfield AI";
  } catch (err) {
    if (process.env.HIGGSFIELD_CLI_PATH || process.env.HIGGSFIELD_API_URL) {
      throw err;
    }
    source = `Higgsfield unavailable (${err.message}); Hermes local generator`;
  }
  if (!imageUrl) {
    imageUrl = svgDataUrl({
      title: opp.title,
      subtitle: opp.niche.name,
      palette: opp.type === "holiday" ? ["#fcee0a", "#00ff9f", "#ff003c"] : ["#02d7f2", "#fcee0a", "#b14aff"],
    });
  }
  const design = {
    id: `auto${Date.now()}${Math.floor(Math.random() * 1000)}`,
    title: `${titleCase(opp.title)} ${product.category}`,
    imageUrl,
    thumbUrl: imageUrl,
    prompt,
    source,
    productTag: product.category,
    status: "Ready",
    listings: [],
    createdAt: new Date().toISOString(),
    automation: { opportunityId: opp.id, niche: opp.niche.name, score: opp.score },
  };
  state.designLibrary.unshift(design);
  persist();
  return design;
}

async function listDesign(design, opp, product, config) {
  const inspiration = opp.eventContext?.meaning || `Inspired by ${opp.title} and the buying interests of ${opp.niche.name}.`;
  const description = [
    `${design.title} is an original print-on-demand design created for ${opp.niche.name}.`,
    `Design inspiration: ${inspiration}`,
    `It uses a clean high-contrast layout built as standalone artwork first, then placed on ${product.category.toLowerCase()} merchandise.`,
    "The generated artwork starts on a white background; during Printify upload Hermes converts that background to transparent so the product color shows through.",
    `${opp.niche.note}`,
  ].join("\n\n");
  const result = await printifyListToEtsy({
    designId: design.id,
    imageUrl: design.imageUrl,
    title: design.title,
    description,
    designTitle: design.title,
    designPrompt: design.prompt,
    price: Number(product.retail),
    blueprintId: product.blueprintId,
  }, {
    dryRun: !config.autoPublish,
    publish: Boolean(config.autoPublish),
    matchBackground: config.matchBackground !== false,
    cropToFit: config.cropToFit !== false,
  });
  if (!result.dryRun) {
    design.status = result.published ? "Listed on Etsy" : "On Printify (draft)";
    design.listings.push({ productId: result.productId, shopId: result.shopId, published: result.published, at: new Date().toISOString(), automation: true });
    persist();
  } else {
    design.status = "Automation dry-run";
    persist();
  }
  return result;
}

export function podAutomationStatus() {
  const auto = ensureState();
  auto.opportunities = buildOpportunities(state.research?.trends ?? [], getSerpFeeds());
  persist();
  return {
    config: auto.config,
    lastRun: auto.runs[0] ?? null,
    runs: auto.runs.slice(0, 10),
    opportunities: auto.opportunities.slice(0, 12),
    nicheResearch: auto.nicheResearch,
  };
}

export function updatePodAutomationConfig(patch = {}) {
  const auto = ensureState();
  auto.config = {
    ...auto.config,
    ...patch,
    intervalDays: Math.max(1, Number(patch.intervalDays ?? auto.config.intervalDays ?? 7)),
    maxDesignsPerRun: Math.max(1, Math.min(10, Number(patch.maxDesignsPerRun ?? auto.config.maxDesignsPerRun ?? 3))),
    autoPublish: Boolean(patch.autoPublish ?? auto.config.autoPublish),
    enabled: Boolean(patch.enabled ?? auto.config.enabled),
  };
  if (!auto.config.nextRunAt) auto.config.nextRunAt = nextRunFrom(new Date().toISOString(), auto.config.intervalDays);
  persist();
  return podAutomationStatus();
}

export async function runPodAutomation({ manual = false } = {}) {
  const auto = ensureState();
  const startedAt = new Date().toISOString();
  const run = { id: `podrun-${Date.now()}`, manual, startedAt, status: "running", decisions: [], errors: [] };
  auto.runs.unshift(run);
  auto.runs = auto.runs.slice(0, 30);
  persist();

  try {
    const [trendResult, serp, catalog] = await Promise.all([
      fetchTrends().catch((e) => ({ trends: state.research.trends ?? [], error: e.message })),
      fetchSerpFeeds().catch((e) => ({ ...getSerpFeeds(), errors: [e.message] })),
      printifyCatalog(state.printifyPricing),
    ]);
    const opportunities = buildOpportunities(trendResult.trends ?? state.research.trends ?? [], serp);
    auto.opportunities = opportunities;
    auto.nicheResearch = NICHE_GROUPS;

    const selected = opportunities.slice(0, auto.config.maxDesignsPerRun);
    for (const opp of selected) {
      try {
        const product = productForOpportunity(opp, catalog);
        if (!product) throw new Error("No Printify catalog product available");
        const design = await generateDesign(opp, product);
        const listing = await listDesign(design, opp, product, auto.config);
        run.decisions.push({
          opportunity: { id: opp.id, title: opp.title, type: opp.type, score: opp.score, source: opp.source },
          eventContext: opp.eventContext ? { meaning: opp.eventContext.meaning, themes: opp.eventContext.themes, avoid: opp.eventContext.avoid } : null,
          niche: { id: opp.niche.id, name: opp.niche.name, spendIndex: opp.niche.spendIndex, interests: opp.niche.interests },
          product: { category: product.category, blueprintId: product.blueprintId, title: product.title, retail: product.retail },
          design: { id: design.id, title: design.title, source: design.source },
          listing,
        });
      } catch (err) {
        run.errors.push(`${opp.title}: ${err.message}`);
      }
    }

    run.status = run.errors.length && !run.decisions.length ? "failed" : "complete";
    run.finishedAt = new Date().toISOString();
    auto.config.lastRunAt = run.finishedAt;
    auto.config.nextRunAt = nextRunFrom(run.finishedAt, auto.config.intervalDays);
    logActivity({
      actor: "pod-automation",
      action: auto.config.autoPublish ? "weekly POD research + live Etsy publish" : "weekly POD research dry-run",
      detail: `${run.decisions.length} design(s), ${run.errors.length} error(s)`,
    });
    persist();
    return run;
  } catch (err) {
    run.status = "failed";
    run.errors.push(err.message);
    run.finishedAt = new Date().toISOString();
    auto.config.lastRunAt = run.finishedAt;
    auto.config.nextRunAt = nextRunFrom(run.finishedAt, auto.config.intervalDays);
    persist();
    return run;
  }
}

export function startPodAutomationScheduler() {
  const auto = ensureState();
  if (!auto.config.nextRunAt) {
    auto.config.nextRunAt = nextRunFrom(auto.config.lastRunAt || new Date().toISOString(), auto.config.intervalDays);
    persist();
  }
  setInterval(async () => {
    const current = ensureState();
    if (!current.config.enabled) return;
    if (current.config.nextRunAt && new Date(current.config.nextRunAt).getTime() > Date.now()) return;
    await runPodAutomation({ manual: false });
  }, 60 * 60 * 1000).unref();
}
