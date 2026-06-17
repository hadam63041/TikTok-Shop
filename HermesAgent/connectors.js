// Connector registry — the place you "feed APIs" to Hermes.
//
// Each connector declares the env keys it needs and the tools it exposes to
// the agent. Until you supply real keys (via .env or POST /api/keys), a
// connector runs in SIMULATION: tools mutate local state.json so the whole
// loop is testable end-to-end. When a key is present, `configured` flips to
// true — swap the marked sections for real API calls as you onboard each
// service. The agent's tool surface never changes, only the backing.

import { state, persist, logActivity, findAsset } from "./store.js";
import { fetchTrends, researchSources, getSerpFeeds } from "./research.js";
import { printifyShops, printifyProducts, printifyConfigured, printifyListToEtsy } from "./printify.js";
import { CHANNELS, SUPPLIERS, listProductToChannels, channelName } from "./dropship.js";

function requireModelLinked(name) {
  const model = state.aiModels.find((m) => m.name.toLowerCase().includes(name.toLowerCase()));
  if (!model) throw new Error(`Unknown AI model "${name}". Use list_ai_models to see options.`);
  if (!model.linked) throw new Error(`${model.name} is not linked. Link it first with set_ai_model_link.`);
  return model;
}

const newId = (prefix) => prefix + Math.random().toString(36).slice(2, 7);

// Build the connector for a dropship supplier (Zendrop, AliExpress…). Every
// supplier exposes the same tool surface, parameterized by supplier id, so the
// agent operates them identically. Tools are named `<id>_<verb>` (e.g.
// zendrop_import_product, aliexpress_list_to_channels).
function makeSupplierConnector(s) {
  const sid = s.id, name = s.name;
  const find = (pid) => state[sid].products.find((x) => x.id === pid);
  const margin = (p) => (p.retail ? Math.round((1 - p.cost / p.retail) * 100) : 0);
  return {
    id: sid,
    name: `${name} (dropshipping supplier & fulfillment)`,
    envKeys: s.envKeys,
    tools: [
      {
        name: `${sid}_list_products`,
        description: `List ${name} catalog products available for sourcing, with cost, retail price, margin and shipping options. Use to find products to import or list.`,
        input_schema: { type: "object", properties: { imported_only: { type: "boolean", description: "Only products already imported to a store" } }, required: [] },
        async handler({ imported_only }) {
          let products = state[sid].products;
          if (imported_only) products = products.filter((p) => p.imported);
          return JSON.stringify(products.map((p) => ({ ...p, marginPct: margin(p) })), null, 2);
        },
      },
      {
        name: `${sid}_import_product`,
        description: `Import a ${name} product into one of your stores so it can be sold. No money is spent. Set the retail price.`,
        input_schema: { type: "object", properties: { product_id: { type: "string" }, store: { type: "string", description: "Store name, e.g. PetGear Plus" }, retail: { type: "number", description: "Retail price USD" } }, required: ["product_id", "store"] },
        async handler({ product_id, store, retail }) {
          const p = find(product_id);
          if (!p) throw new Error(`No ${name} product ${product_id}`);
          // LIVE: POST the supplier's import endpoint { store, price }.
          p.imported = true; p.store = store; if (retail != null) p.retail = retail;
          persist();
          return `Imported "${p.name}" to ${store} at $${p.retail} (cost $${p.cost}, margin ${margin(p)}%).`;
        },
      },
      {
        name: `${sid}_list_orders`,
        description: `List ${name} fulfillment orders with status, tracking, and profit.`,
        input_schema: { type: "object", properties: {}, required: [] },
        async handler() {
          return JSON.stringify(state[sid].orders.map((o) => ({ ...o, profit: Number((o.revenue - o.cost).toFixed(2)) })), null, 2);
        },
      },
      {
        name: `${sid}_draft_fulfillment`,
        description: `Prepare (DRAFT, not submit) a ${name} fulfillment order. Spending money / placing the live order is left for the user to confirm and submit — this only drafts it.`,
        input_schema: { type: "object", properties: { product_id: { type: "string" }, qty: { type: "integer" }, customer: { type: "string" } }, required: ["product_id", "qty"] },
        async handler({ product_id, qty, customer = "—" }) {
          const p = find(product_id);
          if (!p) throw new Error(`No ${name} product ${product_id}`);
          // NOTE: deliberately does NOT call a live order/payment endpoint.
          const order = {
            id: `${sid.slice(0, 2).toUpperCase()}-DRAFT-` + Math.random().toString(36).slice(2, 6).toUpperCase(),
            product: p.name, qty, customer, status: "Draft (needs your confirmation)",
            tracking: null, revenue: Number((p.retail * qty).toFixed(2)), cost: Number((p.cost * qty).toFixed(2)),
            placedAt: new Date().toISOString().slice(0, 10),
          };
          state[sid].orders.unshift(order); persist();
          return `Drafted order ${order.id}: ${qty}× ${p.name}. Cost $${order.cost}, revenue $${order.revenue}. NOT submitted — confirm and place it yourself in ${name}.`;
        },
      },
      {
        name: `${sid}_list_to_channels`,
        description: `List a ${name} product to one or more sales channels (TikTok Shop, Facebook Marketplace, Etsy, Amazon, eBay) — pass channel ids or 'all'. QUEUES a draft listing per channel; does not publish live or spend money (each marketplace's API must be connected to publish). Safe to call.`,
        input_schema: { type: "object", properties: { product_id: { type: "string", description: `${name} product id` }, channels: { type: "array", items: { type: "string", enum: [...CHANNELS.map((c) => c.id), "all"] }, description: "Channel ids (tiktok, facebook, etsy, amazon, ebay) or ['all']" } }, required: ["product_id", "channels"] },
        async handler({ product_id, channels }) {
          const { product, added } = listProductToChannels(sid, product_id, channels);
          // LIVE: for each connected channel, POST the listing to its marketplace API.
          return added.length
            ? `Queued draft listings for "${product.name}" on: ${added.map(channelName).join(", ")}. Connect each marketplace's API to publish live.`
            : `"${product.name}" was already listed on those channels.`;
        },
      },
    ],
  };
}

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
        name: "printify_list_shops",
        description: "List the REAL shops connected to the Printify account (live API), with sales channel and product count.",
        input_schema: { type: "object", properties: {}, required: [] },
        async handler() {
          if (!printifyConfigured()) throw new Error("Printify not configured — set PRINTIFY_API_TOKEN.");
          const shops = await printifyShops();
          return JSON.stringify(shops, null, 2);
        },
      },
      {
        name: "printify_list_products",
        description: "List REAL products in a Printify shop (live API). Pass the shop_id from printify_list_shops.",
        input_schema: {
          type: "object",
          properties: {
            shop_id: { type: "string", description: "Printify shop id, e.g. 7604471" },
            limit: { type: "integer", description: "Max products (default 10)" },
          },
          required: ["shop_id"],
        },
        async handler({ shop_id, limit = 10 }) {
          if (!printifyConfigured()) throw new Error("Printify not configured — set PRINTIFY_API_TOKEN.");
          const { total, products } = await printifyProducts(shop_id, limit);
          return JSON.stringify({ total, products }, null, 2);
        },
      },
      {
        name: "import_design",
        description: "Add a generated design (e.g. from Higgsfield AI) to the design library so it shows in Printify → My Designs and can be listed. Pass the image URL.",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            image_url: { type: "string", description: "Public URL of the design image" },
            source: { type: "string", description: "e.g. 'Higgsfield (nano_banana_2)'" },
          },
          required: ["image_url"],
        },
        async handler({ title, image_url, source }) {
          const design = {
            id: "dsn" + Date.now(), title: title || "Untitled design",
            imageUrl: image_url, thumbUrl: image_url, source: source || "Imported",
            productTag: "Any", status: "Ready", listings: [], createdAt: new Date().toISOString(),
          };
          state.designLibrary.unshift(design);
          persist();
          return `Imported "${design.title}" to the design library (id ${design.id}).`;
        },
      },
      {
        name: "printify_list_to_etsy",
        description: "List a design to Etsy via Printify: removes the white background (transparent), crops the design to fill the product's print area, creates the product with priced variants, and PUBLISHES it live to the connected Etsy store. If you omit description, one is auto-written from real product facts (material, country of manufacture, design inspiration). This is customer-visible — confirm the product, price, and design with the user before calling. Pass dry_run:true first to preview the plan.",
        input_schema: {
          type: "object",
          properties: {
            image_url: { type: "string" },
            title: { type: "string" },
            description: { type: "string", description: "Optional — leave empty to auto-generate the listing copy" },
            design_prompt: { type: "string", description: "Optional generation prompt/notes, used to ground the auto-written design-inspiration line" },
            price: { type: "number", description: "Retail price USD per unit" },
            blueprint_id: { type: "integer", description: "Printify blueprint, e.g. 5 = Unisex Cotton Crew Tee" },
            dry_run: { type: "boolean", description: "Preview the plan without creating/publishing" },
          },
          required: ["image_url", "title", "price", "blueprint_id"],
        },
        async handler({ image_url, title, description, design_prompt, price, blueprint_id, dry_run }) {
          const result = await printifyListToEtsy(
            { imageUrl: image_url, title, description, designTitle: title, designPrompt: design_prompt, price, blueprintId: blueprint_id },
            { dryRun: Boolean(dry_run) });
          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: "printify_sync_design",
        description: "Mark an internal AI design as synced to Printify in the local pipeline. (Real product CREATION needs a blueprint + print provider + variants — left as an explicit, confirmed step, not auto-created here.)",
        input_schema: {
          type: "object",
          properties: { design_id: { type: "string" } },
          required: ["design_id"],
        },
        async handler({ design_id }) {
          const found = findAsset(design_id);
          if (!found || found.kind !== "design") throw new Error(`No design with id ${design_id}`);
          // Real creation: POST /v1/shops/{shop_id}/products.json with blueprint_id,
          // print_provider_id, variants, print_areas — gated behind explicit confirmation.
          found.asset.printify = "Synced";
          persist();
          return `Marked "${found.asset.title}" as synced in the local pipeline. (Live product creation is a confirmed step — say the word and I'll prepare the blueprint/variant payload.)`;
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
  // Dropship suppliers (Zendrop, AliExpress) — one tool surface, generated per
  // supplier from the registry in dropship.js.
  ...SUPPLIERS.map(makeSupplierConnector),
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
    name: "get_discovery_feeds",
    description: "Get the latest SerpApi discovery feeds: trending shopping products with real prices, upcoming events drawing crowds, and upcoming holidays with rising search interest. Use to spot demand and time product launches.",
    input_schema: { type: "object", properties: {}, required: [] },
    async handler() {
      return JSON.stringify(getSerpFeeds(), null, 2);
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
