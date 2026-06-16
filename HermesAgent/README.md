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

## The agent team ([agents.js](agents.js))

Hermes is the orchestrator; it leads five specialist sub-agents, each its own
Claude tool-use loop (own conversation history) scoped to a focused role and a
subset of the tools. They're contactable directly from the dashboard's left
menu, or Hermes can hand off via the `delegate_to_agent` tool.

| Agent | Role | Scoped tools |
|---|---|---|
| ⚡ **Hermes** | Chief orchestrator — answers directly or delegates | all tools + `delegate_to_agent` |
| 🔎 **Research** | Product & market research; what to make and when | dashboard snapshot, market trends, discovery feeds, competitors |
| 🎨 **Design** | Create product designs & video ads from briefs | generate design/video, import design, link models |
| 🚀 **Operations** | Upload **approved** designs to marketplaces + fulfillment | Printify list/publish, Etsy publish, Zendrop/Fiverr |
| 📊 **Revision** | Evaluate every product, channel, marketplace, vendor | snapshot, products, gigs, orders, competitors, discovery |
| 🧮 **Accountant** | P&L — revenue, direct & indirect costs, margins | dashboard snapshot, Zendrop orders |

Each agent goes "online" once `ANTHROPIC_API_KEY` is set; until then they answer
that they need the key. Conversations are per-agent and reset independently.

## Linking an external agent (VPS-hosted, Codex-backed)

The roster also accepts agents that don't run on Anthropic. **The external agent
is a third-party AI agent hosted in Docker on a VPS, and it is already linked to
OpenAI Codex** — Codex is its brain, on the VPS side. So from this dashboard
there is **one** thing to link: the VPS agent's HTTP endpoint. You do **not** add
an `OPENAI_API_KEY` here or build a local OpenAI client — Codex is reached
*through* the VPS agent.

```
Browser (localhost) → HermesAgent (localhost:8787) → [TLS] → VPS:443 (Docker) → OpenAI Codex
```

HermesAgent calls the VPS server-to-server, so the Codex/VPS credentials never
touch the browser and there's no CORS/mixed-content to deal with.

**1. VPS / Docker side** — expose the container port, put it behind TLS
(Caddy/Traefik/nginx + Let's Encrypt → `https://agent.yourdomain.com`), require a
bearer token, and firewall inbound to 443 only. The VPS agent already holds the
OpenAI Codex key; HermesAgent never sees it.

**2. HermesAgent side** — add the endpoint + token to `.env` (server-side,
gitignored), or POST them to `/api/keys` at runtime:

```
VPS_AGENT_URL=https://agent.yourdomain.com/chat
VPS_AGENT_KEY=…            # the bearer token the VPS expects (NOT the OpenAI key)
```

**3. Register it in the roster** — add a factory in [agents.js](agents.js) that
returns the standard agent interface (`chat → {reply, actions}`, `reset`,
`online`, `status`) but `fetch`es the VPS instead of calling Anthropic, then drop
it into `createRoster()`'s `all` map and `list()` so it gets a left-menu row and
its own chat thread (and into the `delegate_to_agent` enum if Hermes should hand
it tasks). The only endpoint-specific code is normalizing the VPS response into
`{reply, actions}` — if the VPS returns OpenAI chat-completions shape, read
`choices[0].message.content`.

```js
function createHttpAgent({ url, key }) {
  let history = [];
  return {
    async chat(message) {
      history.push({ role: "user", content: message });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ message, history }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`VPS agent ${res.status}`);
      const data = await res.json();
      const reply = data.reply ?? data.choices?.[0]?.message?.content ?? "(no reply)";
      history.push({ role: "assistant", content: reply });
      return { reply, actions: data.actions ?? [] };
    },
    reset() { history = []; },
    get online() { return Boolean(url && key); },
    status() { return { backend: "vps-codex", url }; },
  };
}
```

That agent then goes "online" when `VPS_AGENT_URL` + `VPS_AGENT_KEY` are set —
independent of `ANTHROPIC_API_KEY`, since its reasoning happens on the VPS via
Codex. If you want it to *act* on the dashboard (run tools) rather than just
advise, have the VPS call back into `http://<this-host>:8787/api/...`, which
requires exposing this host to the VPS (e.g. a Tailscale/ngrok tunnel).

## What the agent can do (tool surface)

| Tool | Connector | Action |
|---|---|---|
| `get_dashboard_snapshot` | core | Revenue/COGS/ad spend across all businesses, trends, model status |
| `get_trend_competitors` | core | Competitor revenue, channels, price points for a trend |
| `set_ai_model_link` | core | Link/unlink Midjourney, Higgsfield, Runway, SDXL, GPT Image |
| `etsy_list_designs` / `etsy_publish_design` | Etsy | Read catalog; publish a design at a price |
| `printify_list_shops` / `printify_list_products` | Printify | **Live API** — real connected shops & products |
| `import_design` | Printify | Add a Higgsfield-generated design to the library |
| `printify_list_to_etsy` | Printify | **Live** — match background + crop-to-fit + auto-write description + upload + create product + publish to Etsy (confirm first; supports dry_run) |

## Background matching & crop-to-fit ([imagefx.js](imagefx.js))

Designs are generated on a white background. Before listing, the agent:

1. **Matches the background** — a border flood-fill turns the background
   **transparent** (interior whites preserved). On a garment, transparent = the
   fabric color shows through, so the design matches the product color on every
   variant.
2. **Crops to fit** — trims the now-empty margins to the design's bounding box,
   then scales the placement so it **fills the product's print area** without
   distortion (contain-at-max, computed from the blueprint's real print-area
   dimensions).

Both are on by default and can be toggled per listing. Pure-JS via `jimp`, ~1s
for a 1024² image.

## Auto-written descriptions ([describe.js](describe.js))

When you list a design, the description is generated **grounded in real Printify
facts** — the blueprint's material (parsed from its catalog description) and the
print provider's **country of manufacture** (from the provider's location). With
`ANTHROPIC_API_KEY` set, **Claude** writes warm, conversion-focused copy with a
one-line hook, a design-inspiration overview, the material, and the country;
without the key it falls back to a clean template built from the same facts — so
specs are never invented. The dashboard pre-fills it on open, lets you edit it,
and offers **✨ Regenerate with Claude**.
| `printify_sync_design` | Printify | Mark a design synced in the local pipeline (live product creation is a confirmed step) |
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

### SerpApi discovery feeds (Shopping / Event / Holiday trends)

With `SERPAPI_KEY` set, the Research tab adds three live sections below the
market-trend cards:

| Section | SerpApi engine | What it shows |
|---|---|---|
| 🛍️ **Shopping trends** | `google_shopping` | Real trending products + prices/sources for a set of retail queries (avg price, range, expandable product table) |
| 🎉 **Event trends** | `google_events` | Real upcoming events (festivals, concerts, markets) with date, venue, address, link |
| 📅 **Holiday trends** | `google_trends` | Upcoming US holidays with days-to-go; the nearest two get **live** rising-search-interest sparklines so merch can be timed to the run-up |

Holidays come from a deterministic calendar (no key needed), so that column is
populated even before a pull; shopping + events fill in on Refresh. The whole
feed is bounded (3 shopping queries + 1 events + 2 holiday-interest calls) to
keep SerpApi credit use modest — each Refresh costs ~6 SerpApi searches on top
of the niche trends. Feeds persist to `state.research.serp`.

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
GET  /api/research/serp              SerpApi discovery feeds → {shopping, events, holidays}
POST /api/research/serp/refresh      re-pull shopping/event/holiday trends from SerpApi
GET  /api/zendrop/status             masked key + catalog/order counts
GET  /api/zendrop/products | /orders Zendrop catalog and fulfillment orders
GET  /api/zendrop/verify             honest live-endpoint check (JSON vs HTML)
GET  /api/zendrop/key                full token (localhost reveal, on demand)
GET  /api/printify/status            LIVE — real shops, product counts, scopes, masked token
GET  /api/printify/shops             LIVE — connected Printify shops
GET  /api/printify/products?shop=ID  LIVE — real products in a shop
GET  /api/printify/catalog           LIVE — curated catalog (10 merch types) + retail/unit
GET  /api/printify/blueprint?id=ID   LIVE — blueprint detail (colors, sizes, print area)
POST /api/printify/price             set your retail $/unit for a blueprint
GET  /api/mockups  ·  POST /api/mockups   saved design-on-merch mockups
GET  /api/designs                    design library (Higgsfield imports)
POST /api/designs                    add a design {title, imageUrl, source}
POST /api/designs/delete             remove a design {id}
POST /api/printify/describe          write listing copy {blueprintId, title, designTitle?, designPrompt?}
                                       → {description, material, country, source: claude|template}
POST /api/printify/list              LIST to Etsy via Printify {imageUrl,title,price,blueprintId}
                                       opts: dryRun (validate), publish (default true → live),
                                       matchBackground (default true — white bg → transparent),
                                       cropToFit (default true — trim + fill print area),
                                       description? (auto-generated if omitted), designTitle?, designPrompt?
                                       flow: describe → prepare image (bg-match + crop) → upload → create → publish
POST /api/printify/delist            DELIST from Etsy {shopId, productId} (Printify unpublish)
POST /api/models/:id/link            {"linked": true}
POST /api/designs/:id/approve        POST /api/designs/:id/regenerate
POST /api/keys                       {"key": "ETSY_API_KEY", "value": "..."}
POST /api/agent/chat                 {"message": "..."} → {reply, actions}  (Hermes)
POST /api/agent/reset                clear conversation history
GET  /api/agents                     roster: Hermes + specialists {id,name,icon,blurb,online}
POST /api/agents/:id/chat            {"message": "..."} → talk to one agent (research|design|operations|revision|accountant)
POST /api/agents/:id/reset           clear that agent's history
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
