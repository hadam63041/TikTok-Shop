// Connector registry — the place you "feed APIs" to Hermes.
//
// Each connector declares the env keys it needs and the tools it exposes to
// the agent. Until you supply real keys (via .env or POST /api/keys), a
// connector runs in SIMULATION: tools mutate local state.json so the whole
// loop is testable end-to-end. When a key is present, `configured` flips to
// true — swap the marked sections for real API calls as you onboard each
// service. The agent's tool surface never changes, only the backing.

import { state, persist, logActivity, findAsset } from "./store.js";
import { fetchTrends, researchSources } from "./research.js";

function requireModelLinked(name) {
  const model = state.aiModels.find((m) => m.name.toLowerCase().includes(name.toLowerCase()));
  if (!model) throw new Error(`Unknown AI model "${name}". Use list_ai_models to see options.`);
  if (!model.linked) throw new Error(`${model.name} is not linked. Link it first with set_ai_model_link.`);
  return model;
}

const newId = (prefix) => prefix + Math.random().toString(36).slice(2, 7);

export const connectors = [
  {
    id: "etsy",
    name: "Etsy",
    envKeys: ["ETSY_API_KEY", "ETSY_SHOP_ID"],
    tools: [
      {
        name: "etsy_list_designs",
        description: "List the Etsy product catalog. Call this before publishing or editing anything so you know current ids, statuses, and prices. Optionally filter by product type (Candles, Magnets, Shirts, Hats).",
        input_schema: {
          type: "object",
          properties: { product_type: { type: "string", description: "Optional filter: Candles | Magnets | Shirts | Hats" } },
          required: [],
        },
        async handler({ product_type }) {
          const designs = product_type
            ? { [product_type]: state.etsy.designs[product_type] ?? [] }
            : state.etsy.designs;
          return JSON.stringify(designs, null, 2);
        },
      },
      {
        name: "etsy_publish_design",
        description: "Publish a design to the Etsy shop (status -> Listed) at the given price. Call this when the user approves a design in Review. The design must already be synced to Printify.",
        input_schema: {
          type: "object",
          properties: {
            design_id: { type: "string", description: "Catalog id, e.g. c3" },
            price: { type: "number", description: "Listing price in USD" },
          },
          required: ["design_id", "price"],
        },
        async handler({ design_id, price }) {
          const found = findAsset(design_id);
          if (!found || found.kind !== "design") throw new Error(`No design with id ${design_id}`);
          // LIVE: POST https://api.etsy.com/v3/application/shops/{ETSY_SHOP_ID}/listings
          found.asset.status = "Listed";
          found.asset.price = price;
          persist();
          return `Published "${found.asset.title}" (${found.type}) at $${price}.`;
        },
      },
    ],
  },
  {
    id: "printify",
    name: "Printify",
    envKeys: ["PRINTIFY_API_TOKEN"],
    tools: [
      {
        name: "printify_sync_design",
        description: "Create/sync the white-label product on Printify for a design so it can be fulfilled. Required before publishing to Etsy.",
        input_schema: {
          type: "object",
          properties: { design_id: { type: "string" } },
          required: ["design_id"],
        },
        async handler({ design_id }) {
          const found = findAsset(design_id);
          if (!found || found.kind !== "design") throw new Error(`No design with id ${design_id}`);
          // LIVE: POST https://api.printify.com/v1/shops/{shop_id}/products.json
          found.asset.printify = "Synced";
          persist();
          return `Printify product synced for "${found.asset.title}".`;
        },
      },
    ],
  },
  {
    id: "midjourney",
    name: "Midjourney (image generation)",
    envKeys: ["MIDJOURNEY_API_KEY"],
    tools: [
      {
        name: "generate_design",
        description: "Generate a new AI product design image (Midjourney or Stable Diffusion XL) for an Etsy product type. The new design lands in the catalog with status Generating, then Review once done. Requires the model to be linked.",
        input_schema: {
          type: "object",
          properties: {
            product_type: { type: "string", description: "Candles | Magnets | Shirts | Hats" },
            title: { type: "string", description: "Short product title" },
            prompt: { type: "string", description: "The image-generation prompt" },
            model: { type: "string", description: "Midjourney or Stable Diffusion XL", default: "Midjourney" },
          },
          required: ["product_type", "title", "prompt"],
        },
        async handler({ product_type, title, prompt, model = "Midjourney" }) {
          requireModelLinked(model);
          if (!state.etsy.designs[product_type]) throw new Error(`Unknown product type ${product_type}`);
          // LIVE: submit `prompt` to the Midjourney/Stability API job queue
          const design = {
            id: newId(product_type[0].toLowerCase()),
            title, palette: ["#5e7884", "#0d141b"], emoji: "🎨",
            status: "Generating", printify: "—", price: null, sales30d: 0,
            promptUsed: prompt, model,
          };
          state.etsy.designs[product_type].push(design);
          persist();
          return `Design job queued: "${title}" (${product_type}, ${model}, id ${design.id}). Status: Generating.`;
        },
      },
    ],
  },
  {
    id: "higgsfield",
    name: "Higgsfield AI (video generation)",
    envKeys: ["HIGGSFIELD_API_KEY"],
    tools: [
      {
        name: "generate_video_ad",
        description: "Generate an AI video (Higgsfield AI or Runway Gen-4) for a Fiverr video-ad gig or an internal product promo. Requires the video model to be linked.",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            client: { type: "string", description: "Fiverr client handle, or 'internal' for own-shop promos" },
            brief: { type: "string", description: "Creative brief for the video" },
            model: { type: "string", description: "Higgsfield AI or Runway Gen-4", default: "Higgsfield AI" },
            price: { type: "number", description: "Gig price in USD; 0 for internal" },
          },
          required: ["title", "client", "brief"],
        },
        async handler({ title, client, brief, model = "Higgsfield AI", price = 0 }) {
          requireModelLinked(model);
          // LIVE: submit `brief` to the Higgsfield/Runway generation API
          const gig = {
            id: newId("f"), title, client, model, status: "Generating",
            price, orders30d: 0, rating: 0, palette: ["#13242c", "#02d7f2"], emoji: "🎬", briefUsed: brief,
          };
          state.fiverr.gigs["Video Ads"].push(gig);
          persist();
          return `Video job queued: "${title}" for ${client} (${model}, id ${gig.id}). Status: Generating.`;
        },
      },
    ],
  },
  {
    id: "fiverr",
    name: "Fiverr",
    envKeys: ["FIVERR_API_KEY"],
    tools: [
      {
        name: "fiverr_list_gigs",
        description: "List Fiverr gig deliverables and their statuses, optionally filtered by category (Thumbnails, Video Ads).",
        input_schema: {
          type: "object",
          properties: { category: { type: "string", description: "Optional: Thumbnails | Video Ads" } },
          required: [],
        },
        async handler({ category }) {
          const gigs = category ? { [category]: state.fiverr.gigs[category] ?? [] } : state.fiverr.gigs;
          return JSON.stringify(gigs, null, 2);
        },
      },
      {
        name: "fiverr_deliver_gig",
        description: "Mark a finished gig as delivered to the client on Fiverr.",
        input_schema: {
          type: "object",
          properties: { gig_id: { type: "string" } },
          required: ["gig_id"],
        },
        async handler({ gig_id }) {
          const found = findAsset(gig_id);
          if (!found || found.kind !== "gig") throw new Error(`No gig with id ${gig_id}`);
          // LIVE: deliver via Fiverr workflow/API
          found.asset.status = "Delivered";
          persist();
          return `Delivered "${found.asset.title}" to ${found.asset.client}.`;
        },
      },
    ],
  },
  {
    id: "zendrop",
    name: "Zendrop (dropshipping supplier & fulfillment)",
    envKeys: ["ZENDROP_API_KEY"],
    tools: [
      {
        name: "zendrop_list_products",
        description: "List Zendrop catalog products available for sourcing, with cost, retail price, and margin. Use to find products to import into a store.",
        input_schema: {
          type: "object",
          properties: { imported_only: { type: "boolean", description: "Only products already imported to a store" } },
          required: [],
        },
        async handler({ imported_only }) {
          // LIVE: GET {ZENDROP_API_BASE}/products  (header: Authorization: Bearer ZENDROP_API_KEY)
          // Endpoint/auth unverified — Zendrop's public base returned HTML, not JSON.
          let products = state.zendrop.products;
          if (imported_only) products = products.filter((p) => p.imported);
          return JSON.stringify(products.map((p) => ({
            ...p, marginPct: Math.round((1 - p.cost / p.retail) * 100),
          })), null, 2);
        },
      },
      {
        name: "zendrop_import_product",
        description: "Import a Zendrop product into one of your stores so it can be sold. No money is spent. Set the retail price.",
        input_schema: {
          type: "object",
          properties: {
            product_id: { type: "string", description: "e.g. zd4" },
            store: { type: "string", description: "Store name, e.g. PetGear Plus" },
            retail: { type: "number", description: "Retail price USD" },
          },
          required: ["product_id", "store"],
        },
        async handler({ product_id, store, retail }) {
          const p = state.zendrop.products.find((x) => x.id === product_id);
          if (!p) throw new Error(`No Zendrop product ${product_id}`);
          // LIVE: POST {ZENDROP_API_BASE}/products/{id}/import { store, price }
          p.imported = true;
          p.store = store;
          if (retail != null) p.retail = retail;
          persist();
          return `Imported "${p.name}" to ${store} at $${p.retail} (cost $${p.cost}, margin ${Math.round((1 - p.cost / p.retail) * 100)}%).`;
        },
      },
      {
        name: "zendrop_list_orders",
        description: "List Zendrop fulfillment orders with status, tracking, and profit.",
        input_schema: { type: "object", properties: {}, required: [] },
        async handler() {
          return JSON.stringify(state.zendrop.orders.map((o) => ({
            ...o, profit: Number((o.revenue - o.cost).toFixed(2)),
          })), null, 2);
        },
      },
      {
        name: "zendrop_draft_fulfillment",
        description: "Prepare (DRAFT, not submit) a Zendrop fulfillment order for a product. Spending money / placing the live order is left for the user to confirm and submit — this only drafts it.",
        input_schema: {
          type: "object",
          properties: {
            product_id: { type: "string" },
            qty: { type: "integer" },
            customer: { type: "string" },
          },
          required: ["product_id", "qty"],
        },
        async handler({ product_id, qty, customer = "—" }) {
          const p = state.zendrop.products.find((x) => x.id === product_id);
          if (!p) throw new Error(`No Zendrop product ${product_id}`);
          // NOTE: deliberately does NOT call a live order/payment endpoint.
          const order = {
            id: "ZD-DRAFT-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
            product: p.name, qty, customer, status: "Draft (needs your confirmation)",
            tracking: null, revenue: Number((p.retail * qty).toFixed(2)), cost: Number((p.cost * qty).toFixed(2)),
            placedAt: new Date().toISOString().slice(0, 10),
          };
          state.zendrop.orders.unshift(order);
          persist();
          return `Drafted order ${order.id}: ${qty}× ${p.name}. Cost $${order.cost}, revenue $${order.revenue}. NOT submitted — confirm and place it yourself in Zendrop.`;
        },
      },
    ],
  },
  {
    id: "ads",
    name: "Ad platforms (Meta / Google / TikTok / Pinterest / Etsy Ads)",
    envKeys: ["META_ADS_TOKEN", "GOOGLE_ADS_TOKEN", "TIKTOK_ADS_TOKEN"],
    tools: [
      {
        name: "set_ad_budget",
        description: "Set the monthly ad budget for one channel of one business. ALWAYS confirm with the user before increasing total spend. Channels: Etsy Ads, Pinterest, Facebook, Google, TikTok, Fiverr Promoted.",
        input_schema: {
          type: "object",
          properties: {
            business_id: { type: "string", description: "cozyglow | magnetmania | threadcraft | petgear | pixelforge" },
            channel: { type: "string" },
            monthly_budget: { type: "number", description: "USD per month" },
          },
          required: ["business_id", "channel", "monthly_budget"],
        },
        async handler({ business_id, channel, monthly_budget }) {
          const biz = state.businesses.find((b) => b.id === business_id);
          if (!biz) throw new Error(`Unknown business ${business_id}`);
          // LIVE: call the matching ad platform's budget endpoint
          const before = biz.adSpend[channel] ?? 0;
          biz.adSpend[channel] = monthly_budget;
          persist();
          return `${biz.name} / ${channel}: $${before} -> $${monthly_budget} per month.`;
        },
      },
    ],
  },
];

/** Core tools that aren't tied to an external service. */
export const coreTools = [
  {
    name: "get_dashboard_snapshot",
    description: "Get the current business overview: per-business revenue (latest month), COGS, ad spend by channel, market trends summary, and AI model link status. Call this first for any question about performance or before planning actions.",
    input_schema: { type: "object", properties: {}, required: [] },
    async handler() {
      const snapshot = {
        businesses: state.businesses.map((b) => ({
          id: b.id, name: b.name, platform: b.platform,
          revenueThisMonth: b.monthlyRevenue.at(-1),
          revenueLastMonth: b.monthlyRevenue.at(-2),
          cogsPct: b.cogsPct, adSpend: b.adSpend,
        })),
        trends: state.research.trends.map((t) => ({
          product: t.product, successScore: t.successScore, growthPct: t.growthPct, note: t.note,
        })),
        aiModels: state.aiModels.map((m) => ({ name: m.name, modality: m.modality, linked: m.linked })),
      };
      return JSON.stringify(snapshot, null, 2);
    },
  },
  {
    name: "refresh_market_trends",
    description: "Pull fresh trending-product data from live sources (Google Trends always; SerpApi marketplace data and Etsy listings when their keys are configured). Updates the Research tab. Call this when the user asks what's trending now or to refresh research.",
    input_schema: { type: "object", properties: {}, required: [] },
    async handler() {
      const { sources, fetchedAt, trends } = await fetchTrends();
      const live = trends.filter((t) => t.live).length;
      return `Refreshed trends from: ${sources.join(", ")}. ${trends.length} trends (${live} live) as of ${fetchedAt}.`;
    },
  },
  {
    name: "get_research_sources",
    description: "List which research data sources are active (keyless) vs need an API key. Use this to tell the user how to get more real data.",
    input_schema: { type: "object", properties: {}, required: [] },
    async handler() {
      return JSON.stringify(researchSources(), null, 2);
    },
  },
  {
    name: "get_trend_competitors",
    description: "Get the competitor table for one market trend: estimated monthly revenue, ad channels, and price points. Use it to recommend pricing.",
    input_schema: {
      type: "object",
      properties: { trend_id: { type: "string", description: "e.g. dopamine-decor, gorpcore-hats" } },
      required: ["trend_id"],
    },
    async handler({ trend_id }) {
      const trend = state.research.trends.find((t) => t.id === trend_id);
      if (!trend) throw new Error(`Unknown trend ${trend_id}. Known: ${state.research.trends.map((t) => t.id).join(", ")}`);
      return JSON.stringify(trend.competitors, null, 2);
    },
  },
  {
    name: "set_ai_model_link",
    description: "Link or unlink a generative AI model (Midjourney, Higgsfield AI, Runway Gen-4, Stable Diffusion XL, GPT Image) for the agent to use.",
    input_schema: {
      type: "object",
      properties: {
        model_id: { type: "string", description: "midjourney | higgsfield | runway | sdxl | gptimage | claude" },
        linked: { type: "boolean" },
      },
      required: ["model_id", "linked"],
    },
    async handler({ model_id, linked }) {
      const model = state.aiModels.find((m) => m.id === model_id);
      if (!model) throw new Error(`Unknown model ${model_id}`);
      model.linked = linked;
      persist();
      return `${model.name} is now ${linked ? "linked" : "unlinked"}.`;
    },
  },
];

export function connectorStatus() {
  return connectors.map((c) => ({
    id: c.id,
    name: c.name,
    envKeys: c.envKeys.map((k) => ({ key: k, present: Boolean(process.env[k]) })),
    configured: c.envKeys.some((k) => Boolean(process.env[k])),
    mode: c.envKeys.some((k) => Boolean(process.env[k])) ? "live-ready" : "simulation",
    tools: c.tools.map((t) => t.name),
  }));
}

/** Flat tool list for the agent, with activity logging wrapped around every call. */
export function buildToolset() {
  const all = [...coreTools, ...connectors.flatMap((c) => c.tools)];
  return all.map((tool) => ({
    ...tool,
    async handler(input) {
      const result = await tool.handler(input);
      logActivity({ tool: tool.name, input, result: String(result).slice(0, 300) });
      return result;
    },
  }));
}
