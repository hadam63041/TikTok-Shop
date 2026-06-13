/* ===== Hermes Command dashboard — rendering layer =====
   All data comes through HermesBridge (data.js). */

const state = {
  primary: 'finance',          // finance | research | etsy | fiverr
  financeTab: 'overall',       // 'overall' or a business id
  etsyTab: null,               // product type, set after load
  fiverrTab: null,             // gig category, set after load
  zendropTab: 'connection',    // connection | products | orders
  zendropKeyRevealed: null,    // full key once user clicks reveal
  expandedMetric: null,        // which finance KPI drawer is open
  expandedCompetitors: {},     // trendId -> bool
  modelsOpen: false,           // global AI-models panel
};

const cache = {};              // bridge results, fetched once at boot

const $ = (sel) => document.querySelector(sel);

const money = (n, dp = 0) =>
  n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const compact = (n) => Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);

const CHART_COLORS = ['#fcee0a', '#02d7f2', '#ff003c', '#00ff9f', '#b14aff'];

/* ---------------- Boot ---------------- */

async function boot() {
  await HermesBridge.init();
  [cache.businesses, cache.months, cache.llm, cache.trends, cache.productTypes,
   cache.fiverrCategories, cache.aiModels] =
    await Promise.all([
      HermesBridge.getBusinesses(),
      HermesBridge.getMonths(),
      HermesBridge.getLLMUsage(),
      HermesBridge.getResearchTrends(),
      HermesBridge.getEtsyProductTypes(),
      HermesBridge.getFiverrCategories(),
      HermesBridge.getAIModels(),
    ]);
  cache.designs = {};
  for (const type of cache.productTypes) {
    cache.designs[type] = await HermesBridge.getEtsyDesigns(type);
  }
  cache.gigs = {};
  for (const category of cache.fiverrCategories) {
    cache.gigs[category] = await HermesBridge.getFiverrGigs(category);
  }
  [cache.researchSources, cache.researchMeta,
   cache.zendropStatus, cache.zendropProducts, cache.zendropOrders] = await Promise.all([
    HermesBridge.getResearchSources(),
    HermesBridge.getResearchMeta(),
    HermesBridge.getZendropStatus(),
    HermesBridge.getZendropProducts(),
    HermesBridge.getZendropOrders(),
  ]);
  state.etsyTab = cache.productTypes[0];
  state.fiverrTab = cache.fiverrCategories[0];

  if (HermesBridge.connected) {
    const status = $('#agent-status');
    status.classList.add('live');
    status.querySelector('.label').textContent = 'Hermes agent online // live feed';
  }
  render();
}

/* ---------------- Shell ---------------- */

function render() {
  document.querySelectorAll('.primary-tab').forEach((tab) =>
    tab.classList.toggle('active', tab.dataset.tab === state.primary));
  const view = { finance: renderFinance, research: renderResearch,
                 etsy: renderEtsy, fiverr: renderFiverr, zendrop: renderZendrop }[state.primary];
  $('#content').innerHTML = view();
}

function setPrimary(tab) { state.primary = tab; state.expandedMetric = null; render(); window.scrollTo(0, 0); }
function setFinanceTab(id) { state.financeTab = id; state.expandedMetric = null; render(); window.scrollTo(0, 0); }
function setEtsyTab(type) { state.etsyTab = type; render(); window.scrollTo(0, 0); }
function setFiverrTab(category) { state.fiverrTab = category; render(); window.scrollTo(0, 0); }
function setZendropTab(tab) { state.zendropTab = tab; render(); window.scrollTo(0, 0); }

async function revealZendropKey() {
  try { state.zendropKeyRevealed = await HermesBridge.getZendropKey(); }
  catch (err) { state.zendropKeyRevealed = `(${err.message})`; }
  render();
}

async function verifyZendropLive() {
  state.zendropVerify = { detail: 'Checking…' };
  render();
  state.zendropVerify = await HermesBridge.verifyZendrop();
  render();
}

function toggleModelsPanel() {
  state.modelsOpen = !state.modelsOpen;
  renderModelsModal();
}

async function toggleModelLink(id) {
  const model = cache.aiModels.find((m) => m.id === id);
  await HermesBridge.setAIModelLinked(id, !model.linked);
  cache.aiModels = await HermesBridge.getAIModels();
  renderModelsModal();
  render(); // gig cards show "model not linked" warnings, keep them in sync
}

function modelByName(name) {
  return cache.aiModels.find((m) => m.name === name);
}

/* Design/gig actions — in live mode the agent server persists the change,
   so re-fetch and re-render to show it. */
async function designAction(action, id) {
  if (action === 'approve') await HermesBridge.approveDesign(id);
  else await HermesBridge.regenerateDesign(id);
  if (HermesBridge.connected) {
    cache.designs[state.etsyTab] = await HermesBridge.getEtsyDesigns(state.etsyTab);
    if (state.fiverrTab) cache.gigs[state.fiverrTab] = await HermesBridge.getFiverrGigs(state.fiverrTab);
    render();
  }
}

/* ---------------- Hermes console (chat with the agent) ---------------- */

const consoleState = { open: false, busy: false, messages: [] };

function toggleConsole() {
  consoleState.open = !consoleState.open;
  renderConsole();
  if (consoleState.open) setTimeout(() => $('#console-input')?.focus(), 50);
}

async function sendConsoleMessage() {
  const input = $('#console-input');
  const text = input?.value.trim();
  if (!text || consoleState.busy) return;
  input.value = '';
  consoleState.messages.push({ who: 'you', text });
  consoleState.busy = true;
  renderConsole();
  try {
    const res = await HermesBridge.chat(text);
    const actionNote = res.actions?.length
      ? '\n— actions: ' + res.actions.map((a) => `${a.tool}${a.ok === false ? ' ✗' : ''}`).join(', ')
      : '';
    consoleState.messages.push({ who: 'hermes', text: res.reply + actionNote });
    // The agent may have changed data (budgets, listings) — refresh the view.
    if (HermesBridge.connected && res.actions?.length) {
      cache.businesses = await HermesBridge.getBusinesses();
      cache.aiModels = await HermesBridge.getAIModels();
      for (const t of cache.productTypes) cache.designs[t] = await HermesBridge.getEtsyDesigns(t);
      for (const c of cache.fiverrCategories) cache.gigs[c] = await HermesBridge.getFiverrGigs(c);
      render();
    }
  } catch (err) {
    consoleState.messages.push({ who: 'hermes', text: `Error: ${err.message}` });
  }
  consoleState.busy = false;
  renderConsole();
}

function renderConsole() {
  const el = $('#console');
  if (!consoleState.open) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="console-panel">
      <div class="console-head">
        <span class="panel-title" style="margin:0">Hermes console</span>
        <button class="modal-close" onclick="toggleConsole()">✕</button>
      </div>
      <div class="console-log" id="console-log">
        ${consoleState.messages.length ? '' : `
          <div class="console-msg hermes">Give me an order — e.g. "how did ThreadCraft do this month?",
          "generate 3 gorpcore hat designs", or "cut PetGear's Facebook budget to $300".</div>`}
        ${consoleState.messages.map((m) => `
          <div class="console-msg ${m.who}">${m.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}
        ${consoleState.busy ? '<div class="console-msg hermes busy">▍processing…</div>' : ''}
      </div>
      <div class="console-input-row">
        <input id="console-input" type="text" placeholder="Order Hermes around…"
               onkeydown="if (event.key === 'Enter') sendConsoleMessage()" />
        <button class="link-toggle" onclick="sendConsoleMessage()">Send</button>
      </div>
    </div>`;
  const log = $('#console-log');
  if (log) log.scrollTop = log.scrollHeight;
}
function toggleMetric(id) { state.expandedMetric = state.expandedMetric === id ? null : id; render(); }
function toggleCompetitors(id) { state.expandedCompetitors[id] = !state.expandedCompetitors[id]; render(); }

async function refreshResearch() {
  if (state.researchBusy) return;
  state.researchBusy = true;
  render();
  try {
    const result = await HermesBridge.refreshTrends();
    cache.trends = result.trends ?? await HermesBridge.getResearchTrends();
    cache.researchMeta = await HermesBridge.getResearchMeta();
    cache.researchSources = await HermesBridge.getResearchSources();
  } catch (err) {
    cache.researchError = err.message;
  }
  state.researchBusy = false;
  render();
}

/* ---------------- Finance helpers ---------------- */

function financeScope() {
  // 'overall' aggregates every business; otherwise a single one.
  const all = cache.businesses;
  const list = state.financeTab === 'overall' ? all : all.filter((b) => b.id === state.financeTab);
  const last = (b) => b.monthlyRevenue[b.monthlyRevenue.length - 1];
  const prev = (b) => b.monthlyRevenue[b.monthlyRevenue.length - 2];

  const revenue = list.reduce((s, b) => s + last(b), 0);
  const revenuePrev = list.reduce((s, b) => s + prev(b), 0);
  const cogs = list.reduce((s, b) => s + last(b) * b.cogsPct, 0);
  const adChannels = {};
  for (const b of list) {
    for (const [channel, spend] of Object.entries(b.adSpend)) {
      adChannels[channel] = (adChannels[channel] || 0) + spend;
    }
  }
  const adTotal = Object.values(adChannels).reduce((s, v) => s + v, 0);
  const llmCost = state.financeTab === 'overall'
    ? cache.llm.providers.reduce((s, p) => s + p.costMTD, 0)
    : null; // LLM spend is account-wide, not per business
  return { list, revenue, revenuePrev, cogs, adChannels, adTotal, llmCost };
}

const pctDelta = (now, before) => before ? ((now - before) / before) * 100 : 0;

/* ---------------- Finance view ---------------- */

function renderFinance() {
  const scope = financeScope();
  const delta = pctDelta(scope.revenue, scope.revenuePrev);
  const grossProfit = scope.revenue - scope.cogs;
  const netAfterSpend = grossProfit - scope.adTotal - (scope.llmCost ?? 0);

  const tabs = [
    { id: 'overall', label: '📊 All Businesses' },
    ...cache.businesses.map((b) => ({ id: b.id, label: b.name })),
  ];

  return `
    <div class="secondary-tabs">
      ${tabs.map((t) => `
        <button class="secondary-tab ${state.financeTab === t.id ? 'active' : ''}"
                onclick="setFinanceTab('${t.id}')">${t.label}</button>`).join('')}
    </div>

    <div class="kpi-grid">
      ${kpiCard('revenue', 'Revenue (this month)', money(scope.revenue), delta)}
      ${kpiCard('cogs', 'COGS', money(scope.cogs),
        null, `${Math.round((scope.cogs / scope.revenue) * 100)}% of revenue`)}
      ${kpiCard('gross', 'Gross Profit', money(grossProfit),
        null, `Net after ad + LLM spend: ${money(netAfterSpend)}`)}
      ${kpiCard('ads', 'Ad / Marketing Spend', money(scope.adTotal),
        null, `${Object.values(scope.adChannels).filter((v) => v > 0).length} active channels`)}
      ${state.financeTab === 'overall'
        ? kpiCard('llm', 'LLM Spend (MTD)', money(scope.llmCost, 2),
            null, `${cache.llm.providers.length} providers`)
        : ''}
    </div>

    ${state.expandedMetric ? metricDrawer(scope) : ''}

    <div class="two-col">
      <div class="card chart-wrap">
        <div class="panel-title">Revenue — last 12 months</div>
        ${revenueLineChart(scope.list)}
        <div class="legend">
          ${scope.list.map((b, i) => `
            <div class="item"><span class="swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${b.name}</div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="panel-title">Ad spend by channel (this month)</div>
        ${barRows(scope.adChannels, '#b14aff')}
      </div>
    </div>

    ${state.financeTab === 'overall' ? llmPanel() : businessDetailPanel(scope.list[0])}
  `;
}

function kpiCard(id, label, value, delta = null, hint = '') {
  const deltaHtml = delta == null ? '' :
    `<div class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% vs last month</div>`;
  return `
    <div class="card kpi ${state.expandedMetric === id ? 'open' : ''}" onclick="toggleMetric('${id}')">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${deltaHtml}
      ${hint ? `<div class="hint">${hint}</div>` : ''}
      <div class="hint">Click for breakdown ▾</div>
    </div>`;
}

/* Drill-down drawer below the KPI cards */
function metricDrawer(scope) {
  const m = state.expandedMetric;
  const last = (b) => b.monthlyRevenue[b.monthlyRevenue.length - 1];
  let title = '', body = '';

  if (m === 'revenue') {
    title = 'Revenue breakdown by business';
    body = financeTable(
      ['Business', 'Platform', 'This month', 'Last month', 'Δ'],
      scope.list.map((b) => {
        const now = last(b), before = b.monthlyRevenue[b.monthlyRevenue.length - 2];
        const d = pctDelta(now, before);
        return [b.name, b.platform, money(now), money(before),
          `<span style="color:${d >= 0 ? 'var(--green)' : 'var(--red)'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%</span>`];
      }), [2, 3, 4]);
  } else if (m === 'cogs') {
    title = 'COGS by business';
    body = financeTable(
      ['Business', 'COGS %', 'COGS $', 'Gross margin'],
      scope.list.map((b) => [
        b.name,
        `${Math.round(b.cogsPct * 100)}%`,
        money(last(b) * b.cogsPct),
        `${Math.round((1 - b.cogsPct) * 100)}%`,
      ]), [1, 2, 3]);
  } else if (m === 'gross') {
    title = 'Profitability by business';
    body = financeTable(
      ['Business', 'Revenue', 'COGS', 'Ad spend', 'Contribution'],
      scope.list.map((b) => {
        const rev = last(b);
        const cogs = rev * b.cogsPct;
        const ads = Object.values(b.adSpend).reduce((s, v) => s + v, 0);
        return [b.name, money(rev), money(cogs), money(ads), `<b>${money(rev - cogs - ads)}</b>`];
      }), [1, 2, 3, 4]);
  } else if (m === 'ads') {
    title = 'Ad spend: channel × business';
    const channels = Object.keys(scope.adChannels);
    body = financeTable(
      ['Channel', ...scope.list.map((b) => b.name), 'Total'],
      channels.map((channel) => [
        channel,
        ...scope.list.map((b) => money(b.adSpend[channel] || 0)),
        `<b>${money(scope.adChannels[channel])}</b>`,
      ]), Array.from({ length: scope.list.length + 1 }, (_, i) => i + 1));
  } else if (m === 'llm') {
    title = 'LLM cost by provider (month to date)';
    body = financeTable(
      ['Provider', 'Model', 'Cost MTD', 'Tokens used', 'Used for'],
      cache.llm.providers.map((p) =>
        [p.name, `<code>${p.model}</code>`, money(p.costMTD, 2), compact(p.tokensUsed), p.tasks]),
      [2, 3]);
  }

  return `
    <div class="card detail-drawer">
      <div class="panel-title">${title}</div>
      ${body}
    </div>`;
}

function financeTable(headers, rows, numericCols = []) {
  return `
    <table>
      <thead><tr>${headers.map((h, i) =>
        `<th class="${numericCols.includes(i) ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell, i) =>
        `<td class="${numericCols.includes(i) ? 'num' : ''}">${cell}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function llmPanel() {
  return `
    <div class="card">
      <div class="panel-title">LLM rate limits & usage</div>
      ${cache.llm.providers.map((p) => `
        <div class="section-gap">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <b>${p.name}</b>
            <span class="muted">${money(p.costMTD, 2)} MTD · <code>${p.model}</code></span>
          </div>
          ${barRow('Tokens', p.tokensUsed, p.tokenBudget, '#fcee0a',
            `${compact(p.tokensUsed)} / ${compact(p.tokenBudget)}`)}
          ${barRow('Rate (RPM)', p.rpmUsed, p.rpmLimit,
            p.rpmUsed / p.rpmLimit > 0.8 ? '#ff003c' : '#00ff9f',
            `${p.rpmUsed} / ${p.rpmLimit}`)}
        </div>`).join('')}
    </div>`;
}

function businessDetailPanel(biz) {
  if (!biz) return '';
  return `
    <div class="card">
      <div class="panel-title">${biz.name} — monthly detail</div>
      ${financeTable(
        ['Month', 'Revenue', 'COGS', 'Gross profit'],
        cache.months.map((monthName, i) => {
          const rev = biz.monthlyRevenue[i];
          return [monthName, money(rev), money(rev * biz.cogsPct), money(rev * (1 - biz.cogsPct))];
        }), [1, 2, 3])}
    </div>`;
}

/* ---------------- Research view ---------------- */

function renderResearch() {
  const sources = cache.researchSources ?? [];
  const meta = cache.researchMeta ?? {};
  const liveCount = cache.trends.filter((t) => t.live).length;
  const freshness = meta.fetchedAt
    ? `updated ${timeAgo(meta.fetchedAt)}`
    : (HermesBridge.connected ? 'not pulled yet' : 'agent offline');

  return `
    <div class="card section-gap source-strip">
      <span class="panel-title" style="margin:0">Data sources</span>
      ${sources.map((s) => `
        <span class="model-pill ${s.available ? 'linked' : ''}">
          ${s.available ? '◉' : '○'} ${s.name}
          ${s.envKey && !s.available ? `<span class="muted">· needs ${s.envKey}</span>` : ''}
        </span>`).join('')}
      <span class="muted" style="margin-left:auto">${liveCount} live · ${freshness}</span>
      <button class="link-toggle" ${state.researchBusy ? 'disabled' : ''} onclick="refreshResearch()">
        ${state.researchBusy ? 'Pulling…' : '↻ Refresh'}
      </button>
    </div>
    ${cache.researchError ? `<div class="card detail-drawer" style="border-color:var(--red)">
      <span class="muted">Refresh error: ${cache.researchError}</span></div>` : ''}

    <div class="panel-title">Linked businesses</div>
    <div class="biz-chips">
      ${cache.businesses.map((b) => `
        <div class="biz-chip">
          <span>${b.name}</span>
          <span class="muted">· ${b.tagline}</span>
          <button class="link-btn" onclick="HermesBridge.linkBusiness('${b.id}')">
            ${b.agentLinked ? '✓ Linked' : 'Link agent'}
          </button>
        </div>`).join('')}
    </div>

    <div class="panel-title">Market trends — live search & marketplace signals</div>
    <div class="trend-grid">
      ${cache.trends.map(trendCard).join('')}
    </div>`;
}

function timeAgo(iso) {
  const secs = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function trendCard(trend) {
  const open = state.expandedCompetitors[trend.id];
  const competitors = trend.competitors ?? [];
  const interest = trend.interest ?? [];

  // Metrics vary by source: search-trend cards have traffic but no likes/growth.
  const metrics = [];
  if (trend.searchTraffic != null) metrics.push(`<div class="tm"><b>${compact(trend.searchTraffic)}</b>search traffic</div>`);
  else if (trend.impressions != null) metrics.push(`<div class="tm"><b>${compact(trend.impressions)}</b>impressions</div>`);
  if (trend.likes != null) metrics.push(`<div class="tm"><b>${compact(trend.likes)}</b>likes</div>`);
  if (trend.growthPct != null) metrics.push(`<div class="tm"><b class="up">${trend.growthPct >= 0 ? '+' : ''}${trend.growthPct}%</b>trend growth</div>`);

  return `
    <div class="card trend-card">
      <div class="trend-head">
        <div>
          <h3>${trend.product}</h3>
          <div class="category">${trend.category} · via ${trend.source}</div>
        </div>
        <span class="score-badge ${trend.successScore >= 75 ? '' : 'mid'}">
          ${trend.successScore}/100
        </span>
      </div>

      <div class="provenance ${trend.live ? 'live' : 'sample'}">
        ${trend.live ? '● LIVE' : '○ SAMPLE'}
      </div>

      ${metrics.length ? `<div class="trend-metrics">${metrics.join('')}</div>` : ''}

      ${interest.length ? `<div class="chart-wrap">${sparkline(interest, 300, 46, '#00ff9f')}</div>` : ''}
      <div class="trend-note">${trend.note ?? ''}</div>

      ${(trend.relatedNews ?? []).length ? `
        <div class="related-news">
          ${trend.relatedNews.map((n) => `<div class="news-item">📰 ${n}</div>`).join('')}
        </div>` : ''}

      ${competitors.length ? `
        <button class="competitor-toggle" onclick="toggleCompetitors('${trend.id}')">
          ${open ? 'Hide' : 'Show'} ${competitors.length} competitors ${open ? '▴' : '▾'}
        </button>
        ${open ? `
          <div style="margin-top:10px">
            ${financeTable(
              ['Seller', 'Channels', 'Price', '★'],
              competitors.map((c) => [
                c.name,
                (c.channels ?? []).map((ch) => `<span class="channel-tag">${ch}</span>`).join(''),
                c.price != null ? money(c.price, 2) : '—',
                c.rating != null ? c.rating.toFixed(1) : '—',
              ]), [1, 2, 3])}
          </div>` : ''}` : ''}
    </div>`;
}

/* ---------------- Etsy view ---------------- */

function renderEtsy() {
  const designs = cache.designs[state.etsyTab] ?? [];
  const typeEmoji = { Candles: '🕯️', Magnets: '🧲', Shirts: '👕', Hats: '🧢' };
  return `
    <div class="secondary-tabs">
      ${cache.productTypes.map((type) => `
        <button class="secondary-tab ${state.etsyTab === type ? 'active' : ''}"
                onclick="setEtsyTab('${type}')">${typeEmoji[type] ?? ''} ${type}</button>`).join('')}
    </div>

    <div class="panel-title">
      ${state.etsyTab} — AI-generated designs (Etsy + Printify white-label)
    </div>
    <div class="design-grid">
      ${designs.map(designCard).join('')}
    </div>`;
}

function designCard(design) {
  const statusClass = design.status.toLowerCase();
  return `
    <div class="card design-card">
      <div class="design-art"
           style="background: linear-gradient(135deg, ${design.palette[0]}, ${design.palette[1]})">
        ${design.emoji}
      </div>
      <div class="design-body">
        <h4>${design.title}</h4>
        <div class="design-meta">
          <span class="badge ${statusClass}">${design.status}</span>
          <span class="badge printify">Printify: ${design.printify}</span>
        </div>
        <div class="design-stats">
          <span>Price <b>${money(design.price, 2)}</b></span>
          <span>30d sales <b>${design.sales30d}</b></span>
        </div>
        <div class="design-actions">
          ${design.status === 'Review' ? `
            <button class="primary" onclick="designAction('approve', '${design.id}')">Approve & list</button>` : ''}
          <button onclick="designAction('regenerate', '${design.id}')">↻ Regenerate</button>
        </div>
      </div>
    </div>`;
}

/* ---------------- Fiverr view ---------------- */

function renderFiverr() {
  const gigs = cache.gigs[state.fiverrTab] ?? [];
  const categoryEmoji = { 'Thumbnails': '🖼️', 'Video Ads': '🎬' };
  const generationModels = cache.aiModels.filter((m) => m.modality !== 'Text');
  return `
    <div class="secondary-tabs">
      ${cache.fiverrCategories.map((category) => `
        <button class="secondary-tab ${state.fiverrTab === category ? 'active' : ''}"
                onclick="setFiverrTab('${category}')">${categoryEmoji[category] ?? ''} ${category}</button>`).join('')}
    </div>

    <div class="card section-gap model-strip">
      <span class="panel-title" style="margin:0">Generation models</span>
      ${generationModels.map((m) => `
        <span class="model-pill ${m.linked ? 'linked' : ''}">
          ${m.linked ? '◉' : '○'} ${m.name}
          <span class="muted">· ${m.modality}</span>
        </span>`).join('')}
      <button class="models-btn" onclick="toggleModelsPanel()">Manage</button>
    </div>

    <div class="panel-title">
      ${state.fiverrTab} — AI-generated gig deliverables (PixelForge / Fiverr)
    </div>
    <div class="design-grid">
      ${gigs.map(gigCard).join('')}
    </div>`;
}

function gigCard(gig) {
  const statusClass = { 'Delivered': 'listed', 'Generating': 'generating', 'In Queue': 'review' }[gig.status];
  const model = modelByName(gig.model);
  const modelLinked = model?.linked ?? false;
  return `
    <div class="card design-card">
      <div class="design-art"
           style="background: linear-gradient(135deg, ${gig.palette[0]}, ${gig.palette[1]})">
        ${gig.emoji}
      </div>
      <div class="design-body">
        <h4>${gig.title}</h4>
        <div class="muted" style="font-size:12px;margin-bottom:8px">${gig.client}</div>
        <div class="design-meta">
          <span class="badge ${statusClass}">${gig.status}</span>
          <span class="badge printify">${gig.model}</span>
          ${modelLinked ? '' : '<span class="badge offline">Model not linked</span>'}
        </div>
        <div class="design-stats">
          <span>Price <b>${gig.price ? money(gig.price) : 'internal'}</b></span>
          <span>30d orders <b>${gig.orders30d}</b></span>
          <span>★ <b>${gig.rating.toFixed(1)}</b></span>
        </div>
        <div class="design-actions">
          ${gig.status === 'In Queue' ? `
            <button class="primary" ${modelLinked ? '' : 'disabled'}
                    onclick="designAction('regenerate', '${gig.id}')">
              ${modelLinked ? '▶ Generate' : 'Link model first'}
            </button>` : ''}
          ${gig.status === 'Generating' ? `
            <button onclick="designAction('regenerate', '${gig.id}')">↻ Restart job</button>` : ''}
          ${gig.status === 'Delivered' ? `
            <button onclick="designAction('regenerate', '${gig.id}')">↻ New variation</button>` : ''}
        </div>
      </div>
    </div>`;
}

/* ---------------- ZenDrop view ---------------- */

function renderZendrop() {
  const tabs = [
    { id: 'connection', label: '🔌 Connection' },
    { id: 'products', label: '📦 Products' },
    { id: 'orders', label: '🚚 Orders' },
  ];
  const body = {
    connection: zendropConnection,
    products: zendropProducts,
    orders: zendropOrders,
  }[state.zendropTab]();

  return `
    <div class="secondary-tabs">
      ${tabs.map((t) => `
        <button class="secondary-tab ${state.zendropTab === t.id ? 'active' : ''}"
                onclick="setZendropTab('${t.id}')">${t.label}</button>`).join('')}
    </div>
    ${body}`;
}

function zendropConnection() {
  const s = cache.zendropStatus ?? {};
  const v = state.zendropVerify;
  return `
    <div class="kpi-grid">
      <div class="card kpi"><div class="label">Status</div>
        <div class="value" style="font-size:20px">${s.configured ? '🟢 Configured' : '🔴 No key'}</div>
        <div class="hint">${s.provider} dropshipping API</div></div>
      <div class="card kpi"><div class="label">Catalog</div>
        <div class="value">${s.products ?? 0}</div>
        <div class="hint">${s.imported ?? 0} imported to stores</div></div>
      <div class="card kpi"><div class="label">Open orders</div>
        <div class="value">${s.openOrders ?? 0}</div>
        <div class="hint">processing or draft</div></div>
    </div>

    <div class="card section-gap">
      <div class="panel-title">API credential</div>
      <div class="cred-row">
        <span class="muted">Token</span>
        <code class="cred-value">${state.zendropKeyRevealed ?? s.maskedKey ?? '—'}</code>
        ${state.zendropKeyRevealed
          ? `<button class="link-toggle linked" onclick="navigator.clipboard.writeText(state.zendropKeyRevealed); this.textContent='Copied ✓'">Copy</button>`
          : `<button class="link-toggle" onclick="revealZendropKey()">Reveal API code</button>`}
      </div>
      <div class="cred-note">
        🔒 Stored in <code>${s.storedIn ?? 'HermesAgent/.env'}</code>.
        The full token is never baked into the dashboard's source — it's fetched from your
        local agent only when you click Reveal.
      </div>
    </div>

    <div class="card section-gap">
      <div class="panel-title">Live API check</div>
      <button class="competitor-toggle" onclick="verifyZendropLive()">Test Zendrop endpoint ▸</button>
      ${v ? `<div class="verify-result ${v.ok ? 'ok' : 'warn'}">
        ${v.ok ? '✅' : '⚠️'} ${v.detail}${v.httpStatus ? ` (HTTP ${v.httpStatus}, ${v.contentType})` : ''}
      </div>` : ''}
    </div>`;
}

function zendropProducts() {
  const products = cache.zendropProducts ?? [];
  return `
    <div class="panel-title">Zendrop catalog — source & import products</div>
    <div class="design-grid">
      ${products.map((p) => `
        <div class="card design-card">
          <div class="design-art" style="background:linear-gradient(135deg,#13242c,#02d7f2)">${p.emoji}</div>
          <div class="design-body">
            <h4>${p.name}</h4>
            <div class="muted" style="font-size:12px;margin-bottom:8px">${p.category} · ships ${p.shipDays} days</div>
            <div class="design-meta">
              <span class="badge ${p.imported ? 'listed' : 'review'}">${p.imported ? 'Imported → ' + p.store : 'Not imported'}</span>
              <span class="badge printify">${p.marginPct}% margin</span>
            </div>
            <div class="design-stats">
              <span>Cost <b>${money(p.cost, 2)}</b></span>
              <span>Retail <b>${money(p.retail, 2)}</b></span>
              <span>30d <b>${p.orders30d}</b></span>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

function zendropOrders() {
  const orders = cache.zendropOrders ?? [];
  const statusClass = (s) => s.startsWith('Delivered') ? 'listed' : s.startsWith('Shipped') ? 'printify' : s.startsWith('Draft') ? 'offline' : 'review';
  return `
    <div class="panel-title">Zendrop fulfillment orders</div>
    <div class="card">
      ${financeTable(
        ['Order', 'Product', 'Qty', 'Customer', 'Status', 'Tracking', 'Revenue', 'Profit'],
        orders.map((o) => [
          o.id, o.product, o.qty, o.customer,
          `<span class="badge ${statusClass(o.status)}">${o.status}</span>`,
          o.tracking ?? '—', money(o.revenue, 2), `<b style="color:var(--green)">${money(o.profit, 2)}</b>`,
        ]), [2, 6, 7])}
    </div>`;
}

/* ---------------- Global AI-models panel ---------------- */

function renderModelsModal() {
  const modal = $('#modal');
  if (!state.modelsOpen) { modal.innerHTML = ''; return; }
  const modalityClass = { Image: 'printify', Video: 'offline-soft', Text: 'generating' };
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if (event.target === this) toggleModelsPanel()">
      <div class="modal card">
        <div class="modal-head">
          <span class="panel-title" style="margin:0">AI model registry</span>
          <button class="modal-close" onclick="toggleModelsPanel()">✕</button>
        </div>
        <p class="muted" style="font-size:12.5px;margin:8px 0 14px">
          Models the Hermes agent can drive across every business — image, video and text
          generation. Linking hands the provider handshake to the agent; keys never live
          in the dashboard.
        </p>
        <table>
          <thead><tr>
            <th>Model</th><th>Type</th><th>Provider</th><th>Used by</th>
            <th class="num">Cost MTD</th><th></th>
          </tr></thead>
          <tbody>
            ${cache.aiModels.map((m) => `
              <tr>
                <td><b>${m.name}</b></td>
                <td><span class="badge ${modalityClass[m.modality]}">${m.modality}</span></td>
                <td class="muted">${m.provider}</td>
                <td class="muted" style="font-size:12px">${m.usedBy.join(', ')}</td>
                <td class="num">${money(m.costMTD, 2)}</td>
                <td style="text-align:right">
                  <button class="link-toggle ${m.linked ? 'linked' : ''}"
                          onclick="toggleModelLink('${m.id}')">
                    ${m.linked ? '◉ Linked — unlink' : '○ Link model'}
                  </button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ---------------- Chart primitives (no dependencies) ---------------- */

function barRows(valuesByLabel, color) {
  const max = Math.max(...Object.values(valuesByLabel), 1);
  return Object.entries(valuesByLabel)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => barRow(label, value, max, color, money(value)))
    .join('');
}

function barRow(label, value, max, color, displayValue) {
  const pct = Math.min(100, (value / max) * 100);
  return `
    <div class="bar-row">
      <div class="bar-label">${label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="bar-value">${displayValue}</div>
    </div>`;
}

function sparkline(points, width, height, color) {
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const coords = points.map((value, i) => [
    (i / (points.length - 1)) * (width - 4) + 2,
    height - 3 - ((value - min) / span) * (height - 6),
  ]);
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="height:${height}px">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
    </svg>`;
}

function revenueLineChart(businesses) {
  const width = 640, height = 220, padLeft = 46, padBottom = 24, padTop = 10;
  const all = businesses.flatMap((b) => b.monthlyRevenue);
  const max = Math.max(...all) * 1.1;
  const x = (i) => padLeft + (i / (cache.months.length - 1)) * (width - padLeft - 10);
  const y = (v) => padTop + (1 - v / max) * (height - padTop - padBottom);

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
    const value = max * f;
    return `
      <line x1="${padLeft}" y1="${y(value)}" x2="${width - 10}" y2="${y(value)}"
            stroke="#14242c" stroke-width="1"/>
      <text x="${padLeft - 6}" y="${y(value) + 4}" text-anchor="end"
            font-size="10" fill="#5e7884" font-family="Share Tech Mono">${compact(value)}</text>`;
  }).join('');

  const monthLabels = cache.months.map((m, i) =>
    i % 2 === 0 ? `<text x="${x(i)}" y="${height - 6}" text-anchor="middle"
      font-size="10" fill="#5e7884" font-family="Share Tech Mono">${m}</text>` : '').join('');

  const lines = businesses.map((b, bi) => {
    const path = b.monthlyRevenue.map((v, i) =>
      `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<path d="${path}" fill="none"
      stroke="${CHART_COLORS[bi % CHART_COLORS.length]}" stroke-width="2.5"
      stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}">
      ${gridLines}${monthLabels}${lines}
    </svg>`;
}

boot();
