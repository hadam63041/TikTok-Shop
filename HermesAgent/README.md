# Hermes Agent

The AI agent behind the **Hermes Command** dashboard. It runs a Claude-powered
tool-use loop (`claude-opus-4-8`, adaptive thinking) over a registry of
business connectors — Etsy, Printify, Fiverr, ad platforms, and generative
models (Midjourney, Higgsfield AI, Runway, SDXL). You feed it API keys; it
automates the work and the dashboard renders what it does.

```
Dashboard (HermesDashboard/)            Agent (this folder)
┌──────────────────────────┐   HTTP    ┌─────────────────────────────┐
│ HermesBridge.api(...)    │──────────▶│ server.js  /api/* + static  │
│ Console chat UI          │           │ agent.js   Claude tool loop │
└──────────────────────────┘           │ connectors.js  tool registry│
                                       │ store.js   state.json       │
                                       └─────────────────────────────┘
```

## Run it

Requires Node 18+.

```sh
cd HermesAgent
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY at minimum
npm start                # ⚡ http://localhost:8787
```

Open **http://localhost:8787** — the agent serves the dashboard itself. The
header banner flips to green (`AGENT ONLINE // LIVE FEED`) and all data now
comes from `state.json` instead of browser mocks. Click **⌨️ Console** to talk
to the agent: *"How did ThreadCraft do this month?"*, *"Generate 3 gorpcore
hat designs and sync them to Printify"*, *"Cut PetGear's Facebook budget to
$300"*.

Without `ANTHROPIC_API_KEY` the data API still works (the dashboard goes
live), but chat/automation politely refuses until you add the key.

## Feeding it APIs

Two ways:

1. **`.env` file** — copy `.env.example`, fill in keys, restart.
2. **At runtime** — `POST /api/keys` with `{"key": "ETSY_API_KEY", "value": "..."}`
   (also appends to `.env` so it survives restarts).

Each connector reports `simulation` or `live-ready` in `GET /api/health`.
**Until a connector has keys, its tools run in simulation** — they mutate
`state.json` so the whole loop (agent decides → tool runs → dashboard updates)
works end-to-end today. When you're ready to go live, each simulated handler
in [connectors.js](connectors.js) has a `// LIVE:` comment marking exactly
where the real API call goes.

## What the agent can do (tool surface)

| Tool | Connector | Action |
|---|---|---|
| `get_dashboard_snapshot` | core | Revenue/COGS/ad spend across all businesses, trends, model status |
| `get_trend_competitors` | core | Competitor revenue, channels, price points for a trend |
| `set_ai_model_link` | core | Link/unlink Midjourney, Higgsfield, Runway, SDXL, GPT Image |
| `etsy_list_designs` / `etsy_publish_design` | Etsy | Read catalog; publish a design at a price |
| `printify_sync_design` | Printify | Create the white-label product for fulfillment |
| `generate_design` | Midjourney/SDXL | Queue a new AI product design (requires linked model) |
| `generate_video_ad` | Higgsfield/Runway | Queue an AI video ad (requires linked model) |
| `fiverr_list_gigs` / `fiverr_deliver_gig` | Fiverr | Read gig queue; deliver to client |
| `set_ad_budget` | Ad platforms | Change a channel budget (asks you before raising spend) |
| `zendrop_list_products` / `zendrop_import_product` | Zendrop | Browse the supplier catalog; import a product to a store (no spend) |
| `zendrop_list_orders` / `zendrop_draft_fulfillment` | Zendrop | View fulfillment orders; **draft** an order (never auto-submits / spends) |

Every tool call is appended to the activity log (`GET /api/activity`).

## Research: real trending data

The Research tab pulls live data through a provider registry ([research.js](research.js)),
tiered by what's actually obtainable:

| Source | Key | What it gives |
|---|---|---|
| **Google Trends RSS** | none — works now | Live US trending searches with traffic + related news (green ● LIVE cards) |
| **SerpApi** | `SERPAPI_KEY` | Real interest-over-time sparklines + Google Shopping / Amazon / eBay competitors & prices for your niches |
| **Etsy API** | `ETSY_API_KEY` | Real Etsy listings & prices for the candle/magnet/shirt/hat niches |

Cards from a live provider are tagged **LIVE**; anything without a live key is
tagged **SAMPLE** so invented numbers are never passed off as real. The Refresh
button (or the agent's `refresh_market_trends` tool) re-pulls; the data-sources
strip shows which providers are active vs. which key would unlock them.

**Honest limitation:** TikTok/Instagram impressions & likes for arbitrary
products have no free API (those platforms locked their APIs; Reddit's `.json`
is bot-blocked too). Google Trends interest + marketplace sales rank are the
real substitutes used here. Top Google Trends searches skew toward news/sports/
people — that's genuine live search data, not curated to products.

## API quick reference

```
GET  /api/health                     agent + connector status
GET  /api/businesses | /months | /llm | /trends | /models | /activity
GET  /api/etsy/types                 GET /api/etsy/designs?type=Candles
GET  /api/fiverr/categories          GET /api/fiverr/gigs?category=Video%20Ads
GET  /api/research/sources           which trend sources are live vs need keys
GET  /api/research/meta              {fetchedAt, activeSources}
POST /api/trends/refresh             pull fresh trending data → {trends, sources, fetchedAt}
GET  /api/zendrop/status             masked key + catalog/order counts
GET  /api/zendrop/products | /orders Zendrop catalog and fulfillment orders
GET  /api/zendrop/verify             honest live-endpoint check (JSON vs HTML)
GET  /api/zendrop/key                full token (localhost reveal, on demand)
POST /api/models/:id/link            {"linked": true}
POST /api/designs/:id/approve        POST /api/designs/:id/regenerate
POST /api/keys                       {"key": "ETSY_API_KEY", "value": "..."}
POST /api/agent/chat                 {"message": "..."} → {reply, actions}
POST /api/agent/reset                clear conversation history
```

## Safety rails

- The system prompt requires confirmation before money-spending or
  customer-visible actions unless you explicitly ordered exactly that action.
- Every tool call is logged to `state.activity` with input + result.
- API keys live in `.env` / `process.env` only — they are never sent to the
  model or the browser; the agent calls providers server-side. The ZenDrop tab
  shows a **masked** token by default; the full value is fetched from the local
  agent only when you click "Reveal API code". The `zendrop_draft_fulfillment`
  tool deliberately never submits a live order (no money is moved).
- `state.json` is plain JSON — delete it to reset to seed data.

## Extending

Add a connector in [connectors.js](connectors.js): `{id, name, envKeys,
tools: [{name, description, input_schema, handler}]}`. The tool description
is what Claude reads to decide when to call it — state *when* to use the tool,
not just what it does. New tools appear in the agent automatically on restart.
