# TikTok-Shop — Hermes Command

A tabbed business-operations dashboard with a Cyberpunk 2077 theme, backed by
**Hermes**, an AI agent (Claude tool-use loop) that automates work across an
online-business portfolio. You feed it API keys; it monitors finances,
researches live market trends, generates and publishes products, manages gig
deliverables, and sources dropshipping products.

```
┌─ HermesDashboard/ ─────────────┐      ┌─ HermesAgent/ ───────────────────┐
│ index.html · app.js · data.js  │ HTTP │ server.js  /api/* + static serve │
│ styles.css                     │─────▶│ agent.js   Claude tool loop      │
│ (HermesBridge talks to /api)   │      │ connectors.js  tool registry     │
└────────────────────────────────┘      │ research.js  live trend sources  │
                                        │ store.js   state.json persistence│
                                        └──────────────────────────────────┘
```

## Tabs

- **💰 Finance** — revenue / COGS / gross profit / ad spend / LLM spend across
  all businesses, with click-through drill-downs and per-business secondary tabs.
- **🔎 Research** — live trending products. Google Trends RSS works with no key;
  SerpApi + Etsy API unlock real interest curves and marketplace competitors.
- **🛍️ Etsy Businesses** — AI-generated designs per product type (Candles,
  Magnets, Shirts, Hats), with Printify sync.
- **🎬 Fiverr Businesses** — AI thumbnails & video ads, tied to generation models.
- **📦 ZenDrop** — dropshipping connection, catalog, and fulfillment orders.

A global **AI Models** registry (Midjourney, Higgsfield, Runway, SDXL, …) and a
**Console** for chatting with the agent live in the header.

## Run it

Requires Node 18+.

```sh
cd HermesAgent
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY (+ any connector keys)
npm start                # → http://localhost:8787  (agent serves the dashboard)
```

Open **http://localhost:8787**. Without keys, the dashboard runs on simulated
data; each key you add flips its connector from `simulation` to live. See
[HermesAgent/README.md](HermesAgent/README.md) for the full agent, connector,
and API reference.

## Security

- **API keys never get committed.** They live only in `HermesAgent/.env`
  (gitignored) and `process.env` — never in browser-served files. The dashboard
  shows keys masked; the agent calls providers server-side.
- `state.json` (runtime data) is gitignored and regenerated from the seed in
  `store.js`.
- The agent never auto-spends money or places live orders — money-moving and
  customer-visible actions require your confirmation.
