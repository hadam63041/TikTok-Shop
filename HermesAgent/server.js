// Hermes agent server — serves the dashboard, the /api data endpoints it
// reads, the key-feeding endpoint, and the agent chat endpoint.
//
//   cd HermesAgent && npm install && npm start
//   open http://localhost:8787

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { state, persist, findAsset, getAgentLog } from "./store.js";
import { connectorStatus } from "./connectors.js";
import { deriveInsights } from "./insights.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.join(__dirname, "..", "HermesDashboard");
const ENV_FILE = path.join(__dirname, ".env");
const PORT = Number(process.env.PORT || 8787);

// ----- tiny .env loader (no dependency) -----
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

// Agents are created after env is loaded so they see ANTHROPIC_API_KEY.
const { createRoster } = await import("./agents.js");
const { fetchTrends, researchSources, fetchSerpFeeds, getSerpFeeds } = await import("./research.js");
const { printifyStatus, printifyShops, printifyProducts, printifyConfigured,
        printifyCatalog, printifyBlueprintDetail, printifyListToEtsy, printifyEtsyShop,
        printifyDelist, printifyListingFacts } = await import("./printify.js");
const { generateListingCopy } = await import("./describe.js");
const { handleMcpRpc } = await import("./mcp.js");
const roster = createRoster();
const agent = roster.get("hermes"); // back-compat: /api/agent/* talks to the orchestrator

// ----- helpers -----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.normalize(path.join(DASHBOARD_DIR, rel));
  if (!file.startsWith(DASHBOARD_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
}

// ----- routes -----
const routes = {
  "GET /api/health": () => ({
    ok: true, agent: "hermes", version: "0.1.0",
    anthropicKey: agent.online, connectors: connectorStatus(),
  }),
  "GET /api/businesses": () => state.businesses,
  "GET /api/months": () => state.months,
  "GET /api/llm": () => state.llm,
  "GET /api/trends": () => state.research.trends,
  "GET /api/research/sources": () => researchSources(),
  "GET /api/research/meta": () => ({ fetchedAt: state.research.fetchedAt ?? null, activeSources: state.research.activeSources ?? [] }),
  "POST /api/trends/refresh": () => fetchTrends(),
  // SerpApi discovery feeds: shopping / event / holiday trends.
  "GET /api/research/serp": () => getSerpFeeds(),
  "POST /api/research/serp/refresh": () => fetchSerpFeeds(),
  "GET /api/models": () => state.aiModels,
  "GET /api/etsy/types": () => state.etsy.productTypes,
  "GET /api/etsy/designs": (q) => state.etsy.designs[q.get("type")] ?? [],
  "GET /api/fiverr/categories": () => state.fiverr.categories,
  "GET /api/fiverr/gigs": (q) => state.fiverr.gigs[q.get("category")] ?? [],
  "GET /api/activity": () => state.activity,
  "GET /api/keys": () => connectorStatus(),

  // --- Printify (real API) ---
  "GET /api/printify/status": () => printifyStatus(),
  "GET /api/printify/shops": () => printifyShops(),
  "GET /api/printify/products": (q) => printifyProducts(q.get("shop"), Number(q.get("limit") || 10)),
  "GET /api/printify/catalog": () => printifyCatalog(state.printifyPricing),
  "GET /api/printify/blueprint": (q) => printifyBlueprintDetail(q.get("id")),
  "POST /api/printify/price": (q, body) => {
    state.printifyPricing[body.blueprintId] = Number(body.retail);
    persist();
    return { blueprintId: body.blueprintId, retail: Number(body.retail) };
  },
  // --- Design library (Higgsfield imports) ---
  "GET /api/designs": () => state.designLibrary,
  "POST /api/designs": (q, body) => {
    if (!body.imageUrl) throw new Error("imageUrl required");
    const design = {
      id: "dsn" + Date.now() + Math.floor(Math.random() * 1000),
      title: body.title || "Untitled design",
      imageUrl: body.imageUrl,
      thumbUrl: body.thumbUrl || body.imageUrl,
      prompt: body.prompt || null,
      source: body.source || "Imported",
      productTag: body.productTag || "Any",
      status: "Ready",
      listings: [],
      createdAt: new Date().toISOString(),
    };
    state.designLibrary.unshift(design);
    persist();
    return design;
  },
  "POST /api/designs/delete": (q, body) => {
    state.designLibrary = state.designLibrary.filter((d) => d.id !== body.id);
    persist();
    return { deleted: body.id };
  },

  // --- Generate listing copy (material / country / design inspiration) ---
  // Grounded in real Printify facts; uses Claude when ANTHROPIC_API_KEY is set,
  // otherwise a template built from the same facts.
  "POST /api/printify/describe": async (q, body) => {
    if (!body.blueprintId) throw new Error("blueprintId required");
    const facts = await printifyListingFacts(body.blueprintId, body.providerId);
    return generateListingCopy({
      facts,
      productTitle: body.title || facts.productType,
      designTitle: body.designTitle,
      designPrompt: body.designPrompt,
    });
  },

  // --- List a design to Etsy via Printify (real write; dryRun validates) ---
  "POST /api/printify/list": async (q, body) => {
    const result = await printifyListToEtsy(body, {
      dryRun: Boolean(body.dryRun),
      publish: body.publish !== false,            // default true → live on Etsy
      matchBackground: body.matchBackground !== false, // default true
      cropToFit: body.cropToFit !== false,        // default true → fills print area
    });
    if (!result.dryRun && body.designId) {
      const design = state.designLibrary.find((d) => d.id === body.designId);
      if (design) {
        design.status = result.published ? "Listed on Etsy" : "On Printify (draft)";
        design.listings.push({ productId: result.productId, shopId: result.shopId, published: result.published, at: new Date().toISOString() });
        persist();
      }
    }
    return result;
  },

  // --- Delist a product from Etsy (unpublish; keeps it in Printify) ---
  "POST /api/printify/delist": async (q, body) => {
    const result = await printifyDelist(body.shopId, body.productId);
    // reflect in any design that owns this listing
    for (const d of state.designLibrary) {
      const l = (d.listings ?? []).find((x) => String(x.productId) === String(body.productId));
      if (l) { l.published = false; l.delistedAt = new Date().toISOString(); d.status = "Delisted"; }
    }
    persist();
    return result;
  },

  "GET /api/mockups": () => state.mockups,
  "POST /api/mockups": (q, body) => {
    const mockup = { id: "mk" + Date.now(), ...body, createdAt: new Date().toISOString() };
    state.mockups.unshift(mockup);
    state.mockups = state.mockups.slice(0, 50);
    persist();
    return mockup;
  },

  // --- Zendrop ---
  "GET /api/zendrop/status": () => {
    const key = process.env.ZENDROP_API_KEY || "";
    return {
      provider: "Zendrop",
      configured: Boolean(key),
      maskedKey: key ? `${key.slice(0, 4)}${"•".repeat(8)}${key.slice(-4)}` : null,
      storedIn: "HermesAgent/.env (server-side; never sent to the browser by default)",
      products: state.zendrop.products.length,
      imported: state.zendrop.products.filter((p) => p.imported).length,
      openOrders: state.zendrop.orders.filter((o) => o.status.startsWith("Processing") || o.status.startsWith("Draft")).length,
    };
  },
  "GET /api/zendrop/products": () => state.zendrop.products.map((p) => ({ ...p, marginPct: Math.round((1 - p.cost / p.retail) * 100) })),
  "GET /api/zendrop/orders": () => state.zendrop.orders.map((o) => ({ ...o, profit: Number((o.revenue - o.cost).toFixed(2)) })),
  // Localhost convenience: reveal the full key on explicit request. The key
  // otherwise lives only in .env / process.env and is masked everywhere else.
  "GET /api/zendrop/key": () => ({ key: process.env.ZENDROP_API_KEY || null }),
  // Honest live check — reports exactly what Zendrop's endpoint returns.
  "GET /api/zendrop/verify": async () => {
    const key = process.env.ZENDROP_API_KEY;
    if (!key) return { ok: false, detail: "No ZENDROP_API_KEY set." };
    try {
      const res = await fetch("https://api.zendrop.com/v1/products?limit=1", {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      const ct = res.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      return {
        ok: isJson, httpStatus: res.status, contentType: ct,
        detail: isJson
          ? "Endpoint returned JSON — live API reachable."
          : "Endpoint returned HTML, not JSON. Zendrop's public REST base is unconfirmed; wire the documented partner API base into connectors.js once known.",
      };
    } catch (err) {
      return { ok: false, detail: `Request failed: ${err.message}` };
    }
  },

  // Feed an API key at runtime: {"key": "ETSY_API_KEY", "value": "..."}
  "POST /api/keys": (q, body) => {
    if (!/^[A-Z0-9_]+$/.test(body.key ?? "")) throw new Error("key must be UPPER_SNAKE_CASE");
    process.env[body.key] = body.value;
    fs.appendFileSync(ENV_FILE, `\n${body.key}=${body.value}`);
    return { saved: body.key, connectors: connectorStatus() };
  },

  "POST /api/agent/chat": async (q, body) => {
    if (!body.message) throw new Error("message required");
    return agent.chat(String(body.message));
  },
  "POST /api/agent/reset": () => { agent.reset(); return { ok: true }; },
  "GET /api/agent/status": () => agent.status(),

  // Agent roster: Hermes + specialist sub-agents (research/design/operations/revision/accountant).
  "GET /api/agents": () => roster.list(),
};

// Parameterized routes
function dynamicRoute(method, urlPath, body) {
  let match = urlPath.match(/^\/api\/models\/([\w-]+)\/link$/);
  if (method === "POST" && match) {
    const model = state.aiModels.find((m) => m.id === match[1]);
    if (!model) throw new Error(`unknown model ${match[1]}`);
    model.linked = Boolean(body.linked);
    persist();
    return model;
  }
  match = urlPath.match(/^\/api\/designs\/([\w-]+)\/(approve|regenerate)$/);
  if (method === "POST" && match) {
    const found = findAsset(match[1]);
    if (!found) throw new Error(`unknown asset ${match[1]}`);
    if (match[2] === "approve") {
      found.asset.status = found.kind === "design" ? "Listed" : "Delivered";
      if (found.kind === "design") found.asset.printify = "Synced";
    } else {
      found.asset.status = "Generating";
    }
    persist();
    return found.asset;
  }
  match = urlPath.match(/^\/api\/businesses\/([\w-]+)\/link$/);
  if (method === "POST" && match) {
    const biz = state.businesses.find((b) => b.id === match[1]);
    if (!biz) throw new Error(`unknown business ${match[1]}`);
    biz.agentLinked = true;
    persist();
    return biz;
  }
  // Full agent profile: meta + workflow (mission/tools) + persisted chat log
  // + derived "learning & evolution" insights. Powers the agent workspace.
  match = urlPath.match(/^\/api\/agents\/([\w-]+)\/profile$/);
  if (method === "GET" && match) {
    const prof = roster.profile(match[1]);
    if (!prof) throw new Error(`unknown agent ${match[1]}`);
    const log = getAgentLog(match[1]);
    return { ...prof, log, insights: deriveInsights(log) };
  }

  // Chat with / reset a specific roster agent.
  match = urlPath.match(/^\/api\/agents\/([\w-]+)\/(chat|reset)$/);
  if (method === "POST" && match) {
    const a = roster.get(match[1]);
    if (!a) throw new Error(`unknown agent ${match[1]}`);
    if (match[2] === "reset") { a.reset(); return { ok: true }; }
    if (!body.message) throw new Error("message required");
    return a.chat(String(body.message)); // promise — dispatcher awaits dynamicRoute
  }
  return undefined;
}

const server = http.createServer(async (req, res) => {
  const [urlPath, queryString] = req.url.split("?");
  const query = new URLSearchParams(queryString ?? "");

  if (req.method === "OPTIONS") return json(res, 204, {});

  // MCP endpoint — lets the third-party Hermes platform (OAuth brain) call our
  // business tools. JSON-RPC 2.0 over POST; optional bearer auth via MCP_TOKEN.
  if (urlPath === "/mcp") {
    if (req.method !== "POST") return json(res, 405, { error: "MCP endpoint is POST-only" });
    if (process.env.MCP_TOKEN && req.headers.authorization !== `Bearer ${process.env.MCP_TOKEN}`) {
      return json(res, 401, { error: "unauthorized" });
    }
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid JSON" }); }
    const result = await handleMcpRpc(body);
    if (result === null) { res.writeHead(202).end(); return; } // notification
    return json(res, 200, result);
  }

  if (!urlPath.startsWith("/api")) return serveStatic(req, res);

  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const handler = routes[`${req.method} ${urlPath}`];
    const result = handler !== undefined
      ? await handler(query, body)
      : await dynamicRoute(req.method, urlPath, body);
    if (result === undefined) return json(res, 404, { error: `no route ${req.method} ${urlPath}` });
    return json(res, 200, result);
  } catch (err) {
    const status = err.status ?? 400; // Anthropic APIError carries .status
    return json(res, status, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`⚡ Hermes agent on http://localhost:${PORT}`);
  console.log(`   dashboard:  http://localhost:${PORT}/`);
  console.log(`   anthropic:  ${agent.online ? "key loaded — agent ONLINE" : "no ANTHROPIC_API_KEY — chat offline, data API in simulation"}`);
  for (const c of connectorStatus()) {
    console.log(`   connector:  ${c.id.padEnd(11)} ${c.mode}`);
  }
});
