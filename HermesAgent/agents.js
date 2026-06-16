// The Hermes agent team. Hermes is the orchestrator (all tools + delegation);
// it hands domain work to five specialist sub-agents, each scoped to a focused
// system prompt and a subset of the connector tools. Every agent is an
// independent Claude tool-use loop (its own conversation history) and is
// contactable directly from the dashboard's left menu, or via Hermes through the
// delegate_to_agent tool.

import { createAgent } from "./agent.js";
import { createOpenAIAgent } from "./agent-openai.js";
import { createHermesAgent } from "./agent-hermes.js";

// Pick the brain for the built-in agents:
//   anthropic (default) · openai (OPENAI_API_KEY) · hermes (the VPS Hermes
//   platform's OAuth brain over its WebSocket — set HERMES_URL/USERNAME/PASSWORD).
const BACKEND = (process.env.AGENT_BACKEND || "anthropic").toLowerCase();
const makeAgent = (cfg = {}) => {
  if (BACKEND === "hermes") return createHermesAgent({ systemPrompt: cfg.systemPrompt });
  if (BACKEND === "openai") return createOpenAIAgent(cfg);
  return createAgent(cfg);
};

const PORTFOLIO =
  "Portfolio: Etsy print-on-demand shops (candles, magnets, shirts, hats) fulfilled via Printify; " +
  "PetGear Plus (Shopify/Zendrop dropshipping); PixelForge (Fiverr thumbnails + video ads). " +
  "Designs are AI-generated — Higgsfield/Midjourney for images, Higgsfield/Runway for video.";

const RULES =
  "Rules: Ground every claim in tool results. Before spending money or any customer-visible action " +
  "(publishing listings, delivering gigs, raising ad budgets), state your intent and ask for confirmation " +
  "unless the user explicitly ordered exactly that. Replies render in a small chat console — be concise, " +
  "lead with the outcome, short lines, no markdown tables. Report actions as a short list.";

export const AGENT_SPECS = [
  {
    id: "research", name: "Research", icon: "🔎", color: "#02d7f2",
    blurb: "Product & market research",
    tools: ["get_dashboard_snapshot", "refresh_market_trends", "get_research_sources", "get_trend_competitors", "get_discovery_feeds"],
    prompt:
      "find demand. Surface trending products, search interest, upcoming events and holidays, and competitor " +
      "names/prices across search and marketplaces. Recommend WHAT to make and WHEN to list it, with the numbers " +
      "behind each call. You research and advise — you do not create or publish.",
  },
  {
    id: "design", name: "Design", icon: "🎨", color: "#b14aff",
    blurb: "Design creation",
    tools: ["generate_design", "generate_video_ad", "import_design", "set_ai_model_link", "etsy_list_designs"],
    prompt:
      "turn briefs and research into product designs and video ads using the linked AI models (Midjourney/SDXL for " +
      "images, Higgsfield/Runway for video), and import finished art into the design library. If a needed model " +
      "isn't linked, say so and offer to link it. You create — you do not publish to marketplaces.",
  },
  {
    id: "operations", name: "Operations", icon: "🚀", color: "#00ff9f",
    blurb: "Publishing & fulfillment",
    tools: ["printify_list_shops", "printify_list_products", "printify_list_to_etsy", "printify_sync_design", "etsy_publish_design", "import_design", "zendrop_import_product", "zendrop_draft_fulfillment", "fiverr_deliver_gig"],
    prompt:
      "upload APPROVED designs to the marketplaces (Etsy via Printify, etc.) and handle fulfillment drafts. " +
      "Listing/publishing is customer-visible and creates real, live products — always confirm the exact product, " +
      "price and design before you publish, and never auto-submit a paid order.",
  },
  {
    id: "revision", name: "Revision", icon: "📊", color: "#fcee0a",
    blurb: "Performance review",
    tools: ["get_dashboard_snapshot", "get_trend_competitors", "printify_list_products", "fiverr_list_gigs", "zendrop_list_orders", "etsy_list_designs", "get_discovery_feeds"],
    prompt:
      "evaluate the success of EVERY product, marketing channel, marketplace and vendor. Rank winners and losers " +
      "with real numbers (revenue, margin, conversion proxies), and recommend concrete actions: cut, double-down, " +
      "reprice, or switch vendor/channel. Be blunt and quantitative.",
  },
  {
    id: "accountant", name: "Accountant", icon: "🧮", color: "#ff7a1a",
    blurb: "Profit, costs & expenses",
    tools: ["get_dashboard_snapshot", "zendrop_list_orders"],
    prompt:
      "own the P&L. Track revenue and split costs into DIRECT (COGS, print/fulfillment, marketplace & payment fees, " +
      "shipping) and INDIRECT (ad spend, software/API subscriptions, LLM usage). Report profit and margin per " +
      "business and overall, and flag where money is leaking. State assumptions when a cost isn't in the data yet.",
  },
];

const HERMES_META = { id: "hermes", name: "Hermes", icon: "⚡", color: "#fcee0a", blurb: "Chief orchestrator" };

// External third-party agent: the Nous "Hermes" platform on your VPS, linked to
// OpenAI via OAuth. We reach it over its WebSocket (see agent-hermes.js) — the
// OAuth brain stays on the VPS, no key here. Always present as a menu entry so
// you can chat with it directly; also a delegation target.
const EXTERNAL_META = { id: "codex", name: "Codex", icon: "🛰️", color: "#10a37f", blurb: "VPS Hermes · OpenAI OAuth brain" };

export function createRoster() {
  const specialists = {};
  for (const s of AGENT_SPECS) {
    specialists[s.id] = makeAgent({
      toolNames: s.tools,
      systemPrompt:
        `You are the ${s.name} agent on the "Hermes Command" team, reporting to the Hermes orchestrator.\n` +
        `${PORTFOLIO}\n${RULES}\n\n` +
        `Your job — ${s.name}: ${s.prompt}`,
    });
  }

  // The external VPS Hermes agent (OAuth brain over WebSocket) — also a
  // delegation target. Independent of AGENT_BACKEND.
  const external = createHermesAgent();
  const delegatable = { ...specialists, [EXTERNAL_META.id]: external };

  // Hermes can hand a task to any specialist (or the external Codex agent).
  const delegateTool = {
    name: "delegate_to_agent",
    description:
      "Hand a task to a specialist sub-agent and return its result. Choose: research (market/product research & " +
      "timing), design (create designs or video ads), operations (publish/upload approved designs to marketplaces), " +
      "revision (evaluate performance of products/channels/marketplaces/vendors), accountant (profit & expense " +
      "tracking), codex (external VPS-hosted agent powered by OpenAI Codex — use for heavier reasoning/coding-style " +
      "tasks). Use this when a request clearly fits one agent's domain.",
    input_schema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: Object.keys(delegatable) },
        task: { type: "string", description: "The full task/question for the agent." },
      },
      required: ["agent", "task"],
    },
    handler: async ({ agent, task }) => {
      const a = delegatable[agent];
      if (!a) return `Unknown agent: ${agent}`;
      const res = await a.chat(String(task));
      return `[${agent}] ${res.reply}`;
    },
  };

  const hermes = makeAgent({ extraTools: [delegateTool] }); // default Hermes prompt + all tools + delegate
  const all = { hermes, ...specialists, [EXTERNAL_META.id]: external };

  return {
    get: (id) => all[id],
    list: () => [
      { ...HERMES_META, online: hermes.online },
      ...AGENT_SPECS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, color: s.color, blurb: s.blurb, tools: s.tools, online: specialists[s.id].online })),
      { ...EXTERNAL_META, online: external.online },
    ],
  };
}
