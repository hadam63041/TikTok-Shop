// Persistent state for the Hermes agent. Seeded with the same data shape the
// dashboard's MOCK uses; once the agent is running, state.json is the single
// source of truth and every mutation (by you or by the agent) is saved here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// STATE_FILE is overridable so a container can persist to a mounted volume
// (e.g. STATE_FILE=/data/state.json) instead of inside the image.
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, "state.json");

function seed() {
  return {
    months: ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    businesses: [
      { id: "cozyglow", name: "Cozy Glow", platform: "Etsy + Printify", tagline: "AI-designed candles", agentLinked: false,
        monthlyRevenue: [3100, 3420, 3980, 4210, 4870, 5320, 5100, 5680, 6240, 6810, 7430, 8120], cogsPct: 0.42,
        adSpend: { "Etsy Ads": 410, "Pinterest": 220, "Facebook": 180, "Google": 0, "TikTok": 90 } },
      { id: "magnetmania", name: "MagnetMania", platform: "Etsy + Printify", tagline: "Fridge magnets & pins", agentLinked: false,
        monthlyRevenue: [980, 1040, 1190, 1320, 1280, 1510, 1620, 1750, 1890, 2010, 2240, 2380], cogsPct: 0.38,
        adSpend: { "Etsy Ads": 150, "Pinterest": 80, "Facebook": 60, "Google": 0, "TikTok": 40 } },
      { id: "threadcraft", name: "ThreadCraft", platform: "Etsy + Printify", tagline: "Shirts & hats", agentLinked: false,
        monthlyRevenue: [2200, 2350, 2180, 2540, 2890, 3120, 3480, 3260, 3710, 4050, 4480, 4910], cogsPct: 0.51,
        adSpend: { "Etsy Ads": 290, "Pinterest": 110, "Facebook": 240, "Google": 130, "TikTok": 160 } },
      { id: "petgear", name: "PetGear Plus", platform: "Shopify", tagline: "Pet accessories (dropship)", agentLinked: false,
        monthlyRevenue: [1500, 1620, 1480, 1810, 2040, 2310, 2150, 2480, 2620, 2940, 3180, 3460], cogsPct: 0.55,
        adSpend: { "Etsy Ads": 0, "Pinterest": 90, "Facebook": 520, "Google": 380, "TikTok": 310 } },
      { id: "pixelforge", name: "PixelForge", platform: "Fiverr", tagline: "AI thumbnails & video ads", agentLinked: false,
        monthlyRevenue: [620, 750, 890, 1040, 1230, 1380, 1560, 1820, 2100, 2350, 2680, 3050], cogsPct: 0.18,
        adSpend: { "Fiverr Promoted": 140, "TikTok": 60, "Google": 45 } },
    ],
    llm: {
      providers: [
        { name: "Anthropic (Claude)", model: "claude-opus-4-8", tokensUsed: 18400000, tokenBudget: 30000000,
          rpmUsed: 38, rpmLimit: 60, costMTD: 312.4, tasks: "Hermes agent core, design prompts, listing copy, research" },
        { name: "OpenAI", model: "gpt-image", tokensUsed: 6100000, tokenBudget: 12000000,
          rpmUsed: 12, rpmLimit: 50, costMTD: 148.9, tasks: "Image generation fallback" },
      ],
    },
    aiModels: [
      { id: "midjourney", name: "Midjourney", modality: "Image", provider: "Midjourney Inc.", linked: true,
        usedBy: ["Etsy designs", "Fiverr thumbnails"], costMTD: 96.0 },
      { id: "higgsfield", name: "Higgsfield AI", modality: "Video", provider: "Higgsfield", linked: false,
        usedBy: ["Fiverr video ads"], costMTD: 0 },
      { id: "runway", name: "Runway Gen-4", modality: "Video", provider: "Runway", linked: false,
        usedBy: ["Fiverr video ads"], costMTD: 0 },
      { id: "sdxl", name: "Stable Diffusion XL", modality: "Image", provider: "Stability AI", linked: true,
        usedBy: ["Etsy designs", "Fiverr thumbnails"], costMTD: 21.5 },
      { id: "claude", name: "Claude (Fable 5)", modality: "Text", provider: "Anthropic", linked: true,
        usedBy: ["Hermes agent core", "Listing copy", "Research"], costMTD: 312.4 },
      { id: "gptimage", name: "GPT Image", modality: "Image", provider: "OpenAI", linked: false,
        usedBy: ["Fallback image gen"], costMTD: 0 },
    ],
    etsy: {
      productTypes: ["Candles", "Magnets", "Shirts", "Hats"],
      designs: {
        Candles: [
          { id: "c1", title: "Sunset Gradient Soy", palette: ["#ff9a56", "#ff6b95"], emoji: "🕯️", status: "Listed", printify: "Synced", price: 24.99, sales30d: 47 },
          { id: "c2", title: "Lavender Dream", palette: ["#b39ddb", "#7e57c2"], emoji: "🪻", status: "Listed", printify: "Synced", price: 22.99, sales30d: 31 },
          { id: "c3", title: "Dopamine Swirl", palette: ["#ffd54f", "#4dd0e1"], emoji: "🌈", status: "Review", printify: "Draft", price: 26.99, sales30d: 0 },
          { id: "c4", title: "Midnight Forest", palette: ["#2e7d32", "#1b5e20"], emoji: "🌲", status: "Generating", printify: "—", price: null, sales30d: 0 },
        ],
        Magnets: [
          { id: "m1", title: "Pixel Sushi Set (x6)", palette: ["#ef5350", "#ffb74d"], emoji: "🍣", status: "Listed", printify: "Synced", price: 12.99, sales30d: 88 },
          { id: "m2", title: "Retro Gameboy Pack", palette: ["#9ccc65", "#558b2f"], emoji: "🎮", status: "Listed", printify: "Synced", price: 11.99, sales30d: 64 },
          { id: "m3", title: "Cottagecore Mushrooms", palette: ["#d7ccc8", "#8d6e63"], emoji: "🍄", status: "Review", printify: "Draft", price: 13.99, sales30d: 0 },
        ],
        Shirts: [
          { id: "s1", title: "Cat Dad Club", palette: ["#455a64", "#263238"], emoji: "🐱", status: "Listed", printify: "Synced", price: 21.99, sales30d: 53 },
          { id: "s2", title: "Plant Parent", palette: ["#66bb6a", "#33691e"], emoji: "🪴", status: "Listed", printify: "Synced", price: 21.99, sales30d: 29 },
          { id: "s3", title: "Coffee Then Chaos", palette: ["#8d6e63", "#4e342e"], emoji: "☕", status: "Review", printify: "Draft", price: 23.99, sales30d: 0 },
          { id: "s4", title: "Gorpcore Mountain Line", palette: ["#78909c", "#37474f"], emoji: "⛰️", status: "Generating", printify: "—", price: null, sales30d: 0 },
        ],
        Hats: [
          { id: "h1", title: "Trail Mix Dad Hat", palette: ["#a1887f", "#5d4037"], emoji: "🥾", status: "Listed", printify: "Synced", price: 27.99, sales30d: 41 },
          { id: "h2", title: "Embroidered Trout Cap", palette: ["#4fc3f7", "#0277bd"], emoji: "🐟", status: "Review", printify: "Draft", price: 28.99, sales30d: 0 },
        ],
      },
    },
    fiverr: {
      categories: ["Thumbnails", "Video Ads"],
      gigs: {
        Thumbnails: [
          { id: "f1", title: "YouTube Gaming Thumbnail Pack", client: "@StreamerNova", model: "Midjourney", status: "Delivered", price: 45, orders30d: 23, rating: 4.9, palette: ["#ff6b95", "#7e57c2"], emoji: "🎮" },
          { id: "f2", title: "Reaction-Style Viral Thumbs", client: "@ViralVistas", model: "Midjourney", status: "Generating", price: 35, orders30d: 17, rating: 4.8, palette: ["#ffd54f", "#ff7043"], emoji: "😱" },
          { id: "f3", title: "Podcast Cover Thumbnails", client: "@TalkTrackPod", model: "Stable Diffusion XL", status: "In Queue", price: 30, orders30d: 9, rating: 4.7, palette: ["#4dd0e1", "#1a237e"], emoji: "🎙️" },
          { id: "f4", title: "Twitch Panels + Offline Screens", client: "@PixelPaladin", model: "Stable Diffusion XL", status: "Delivered", price: 55, orders30d: 12, rating: 5.0, palette: ["#9575cd", "#311b92"], emoji: "🟣" },
        ],
        "Video Ads": [
          { id: "f5", title: "15s TikTok Product Ad", client: "GlowSkin Co.", model: "Higgsfield AI", status: "Delivered", price: 120, orders30d: 14, rating: 4.9, palette: ["#f06292", "#880e4f"], emoji: "✨" },
          { id: "f6", title: "UGC-Style Dropship Ad", client: "KitchenWiz", model: "Higgsfield AI", status: "Generating", price: 150, orders30d: 8, rating: 4.8, palette: ["#4db6ac", "#004d40"], emoji: "🍳" },
          { id: "f7", title: "30s YouTube Pre-Roll", client: "FitFuel Labs", model: "Runway Gen-4", status: "In Queue", price: 220, orders30d: 5, rating: 4.6, palette: ["#aed581", "#33691e"], emoji: "💪" },
          { id: "f8", title: "Etsy Listing Promo Reel", client: "Cozy Glow (internal)", model: "Higgsfield AI", status: "Delivered", price: 0, orders30d: 6, rating: 5.0, palette: ["#ff9a56", "#bf360c"], emoji: "🕯️" },
        ],
      },
    },
    research: {
      trends: [
        { id: "dopamine-decor", product: "Dopamine decor candles", category: "Home / Candles", source: "TikTok + Pinterest",
          impressions: 4200000, likes: 386000, growthPct: 64, successScore: 86,
          interest: [22, 28, 31, 38, 45, 52, 61, 72, 78, 85, 90, 96],
          note: "Bright multi-color aesthetic trending with 18-30 demo. Etsy search volume for \"colorful soy candle\" up 41% QoQ.",
          competitors: [
            { name: "BrightWick Co.", monthlyEst: 21000, channels: ["TikTok", "Etsy Ads"], price: 24.99, rating: 4.8 },
            { name: "NeonFlame Studio", monthlyEst: 14500, channels: ["Pinterest", "Instagram"], price: 19.5, rating: 4.6 },
            { name: "GlowHaus", monthlyEst: 9800, channels: ["Etsy Ads"], price: 27.0, rating: 4.9 },
          ] },
        { id: "retro-fridge", product: "Retro pixel-art magnets", category: "Kitchen / Magnets", source: "Etsy search + Instagram",
          impressions: 1100000, likes: 98000, growthPct: 38, successScore: 72,
          interest: [40, 42, 41, 45, 48, 51, 50, 55, 58, 61, 66, 70],
          note: "90s nostalgia cycle. Bundles of 6-8 outsell singles 3:1 historically.",
          competitors: [
            { name: "PixelPeach", monthlyEst: 7200, channels: ["Instagram", "Etsy Ads"], price: 12.99, rating: 4.7 },
            { name: "8BitFridge", monthlyEst: 5400, channels: ["Etsy Ads"], price: 9.99, rating: 4.5 },
          ] },
        { id: "gorpcore-hats", product: "Gorpcore embroidered caps", category: "Apparel / Hats", source: "TikTok",
          impressions: 6800000, likes: 542000, growthPct: 91, successScore: 79,
          interest: [10, 12, 15, 14, 22, 30, 38, 52, 60, 74, 88, 95],
          note: "Outdoor-aesthetic caps spiking. Historical pattern: apparel trends from TikTok hold ~2 quarters.",
          competitors: [
            { name: "TrailCap Supply", monthlyEst: 33000, channels: ["TikTok", "Facebook"], price: 29.0, rating: 4.6 },
            { name: "SummitStitch", monthlyEst: 18700, channels: ["TikTok", "Google"], price: 24.0, rating: 4.4 },
            { name: "BasecampGoods", monthlyEst: 11200, channels: ["Etsy Ads", "Pinterest"], price: 26.5, rating: 4.8 },
          ] },
        { id: "cat-dad-shirts", product: "\"Cat Dad\" graphic tees", category: "Apparel / Shirts", source: "Instagram + Etsy search",
          impressions: 2400000, likes: 201000, growthPct: 27, successScore: 68,
          interest: [55, 54, 58, 56, 60, 59, 63, 62, 66, 65, 69, 71],
          note: "Evergreen niche, steady rather than spiking. Father's Day (Jun 21) historically 2.4x baseline.",
          competitors: [
            { name: "WhiskerWear", monthlyEst: 12800, channels: ["Facebook", "Etsy Ads"], price: 21.99, rating: 4.7 },
            { name: "FelineThreads", monthlyEst: 8100, channels: ["Instagram"], price: 18.5, rating: 4.5 },
          ] },
      ],
    },
    zendrop: {
      // Dropshipping supplier integration. Sourced products carry the Zendrop
      // cost; you set retail and Zendrop fulfills + ships on each order.
      products: [
        { id: "zd1", name: "LED Sunset Projector Lamp", emoji: "🌅", category: "Home", cost: 8.40, retail: 29.99, shipDays: "6–9", orders30d: 142, imported: true, store: "PetGear Plus" },
        { id: "zd2", name: "Magnetic Phone Mount (3-pack)", emoji: "🧲", category: "Accessories", cost: 3.10, retail: 16.99, shipDays: "5–8", orders30d: 98, imported: true, store: "PetGear Plus" },
        { id: "zd3", name: "Collapsible Dog Travel Bowl", emoji: "🐕", category: "Pet", cost: 2.75, retail: 14.99, shipDays: "7–10", orders30d: 211, imported: true, store: "PetGear Plus" },
        { id: "zd4", name: "Posture Corrector Brace", emoji: "🦴", category: "Wellness", cost: 5.20, retail: 24.99, shipDays: "6–9", orders30d: 67, imported: false, store: null },
        { id: "zd5", name: "Mini Portable Blender", emoji: "🥤", category: "Kitchen", cost: 9.80, retail: 34.99, shipDays: "8–12", orders30d: 53, imported: false, store: null },
        { id: "zd6", name: "Self-Stirring Mug", emoji: "☕", category: "Kitchen", cost: 4.60, retail: 19.99, shipDays: "6–9", orders30d: 38, imported: false, store: null },
      ],
      orders: [
        { id: "ZD-10293", product: "Collapsible Dog Travel Bowl", qty: 2, customer: "A. Rivera", status: "Shipped", tracking: "LP847362910CN", revenue: 29.98, cost: 5.50, placedAt: "2026-06-09" },
        { id: "ZD-10288", product: "LED Sunset Projector Lamp", qty: 1, customer: "M. Chen", status: "Delivered", tracking: "LP847211883CN", revenue: 29.99, cost: 8.40, placedAt: "2026-06-04" },
        { id: "ZD-10301", product: "Magnetic Phone Mount (3-pack)", qty: 1, customer: "T. Okafor", status: "Processing", tracking: null, revenue: 16.99, cost: 3.10, placedAt: "2026-06-12" },
        { id: "ZD-10305", product: "Collapsible Dog Travel Bowl", qty: 3, customer: "S. Müller", status: "Processing", tracking: null, revenue: 44.97, cost: 8.25, placedAt: "2026-06-13" },
      ],
    },

    // Per-unit retail prices the user sets for Printify catalog products
    // (keyed by blueprintId). Printify's catalog API doesn't expose base cost.
    printifyPricing: {},

    // Saved design→product mockups from the Mockup Studio.
    mockups: [],

    // Imported design library (e.g. generated via Higgsfield AI). Shown in
    // the Printify → My Designs tab; each can be listed to Etsy via Printify.
    designLibrary: [],

    activity: [], // audit log of every action the agent takes

    // Per-agent conversation logs (agentId -> { messages, createdAt }). Drives
    // the full-screen agent workspace: the visible chat history plus the
    // derived "learning & evolution" stats. Survives restarts; Reset clears it.
    agentLogs: {},
  };
}

const loaded = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : seed();

// Backfill any top-level sections added since this state.json was written
// (so new features like zendrop apply without wiping existing data).
const defaults = seed();
let backfilled = false;
for (const key of Object.keys(defaults)) {
  if (loaded[key] === undefined) { loaded[key] = defaults[key]; backfilled = true; }
}

export const state = loaded;
if (backfilled) persist();

export function persist() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function logActivity(entry) {
  state.activity.unshift({ ...entry, at: new Date().toISOString() });
  state.activity = state.activity.slice(0, 200);
  persist();
}

/** Append one user→agent exchange to an agent's persistent conversation log. */
export function recordAgentTurn(agentId, { user, reply, actions = [] }) {
  if (!state.agentLogs) state.agentLogs = {};
  const log = (state.agentLogs[agentId] ??= { messages: [], createdAt: new Date().toISOString() });
  const at = new Date().toISOString();
  log.messages.push({ who: "you", text: String(user ?? ""), at });
  log.messages.push({
    who: "agent",
    text: String(reply ?? ""),
    actions: (actions ?? []).map((a) => ({ tool: a.tool, ok: a.ok !== false })),
    at,
  });
  log.messages = log.messages.slice(-300); // keep the tail bounded
  log.lastAt = at;
  persist();
}

/** The persisted conversation log for one agent (empty shell if none yet). */
export function getAgentLog(agentId) {
  return (state.agentLogs && state.agentLogs[agentId]) || { messages: [], createdAt: null };
}

/** Wipe an agent's persisted conversation log (paired with reset()). */
export function clearAgentLog(agentId) {
  if (state.agentLogs && state.agentLogs[agentId]) {
    delete state.agentLogs[agentId];
    persist();
  }
}

/** Find a design or gig anywhere in the catalog by id. */
export function findAsset(id) {
  for (const [type, designs] of Object.entries(state.etsy.designs)) {
    const design = designs.find((d) => d.id === id);
    if (design) return { kind: "design", type, asset: design };
  }
  for (const [category, gigs] of Object.entries(state.fiverr.gigs)) {
    const gig = gigs.find((g) => g.id === id);
    if (gig) return { kind: "gig", category, asset: gig };
  }
  return null;
}
