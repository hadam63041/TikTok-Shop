/* ===== Hermes Command dashboard — rendering layer =====
   All data comes through HermesBridge (data.js). */

const state = {
  primary: 'finance',          // finance | research | printify | fiverr | zendrop
  financeTab: 'overall',       // 'overall' or a business id
  etsyTab: null,               // design product type, set after load
  fiverrTab: null,             // gig category, set after load
  printifySub: 'catalog',      // catalog | mockup | designs
  mockup: { blueprintId: null, designUrl: '', scale: 42, posY: 38 }, // mockup studio state
  zendropTab: 'connection',    // connection | products | orders
  zendropKeyRevealed: null,    // full key once user clicks reveal
  expandedMetric: null,        // which finance KPI drawer is open
  expandedCompetitors: {},     // trendId -> bool
  modelsOpen: false,           // global AI-models panel
  sidebarExpanded: true,       // left agent menu expanded vs collapsed rail
};

const cache = {};              // bridge results, fetched once at boot

const $ = (sel) => document.querySelector(sel);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  [cache.researchSources, cache.researchMeta, cache.serpFeeds, cache.printifyStatus,
   cache.zendropStatus, cache.zendropProducts, cache.zendropOrders] = await Promise.all([
    HermesBridge.getResearchSources(),
    HermesBridge.getResearchMeta(),
    HermesBridge.getSerpFeeds(),
    HermesBridge.getPrintifyStatus(),
    HermesBridge.getZendropStatus(),
    HermesBridge.getZendropProducts(),
    HermesBridge.getZendropOrders(),
  ]);
  cache.designLibrary = await HermesBridge.getDesigns();
  cache.agents = await HermesBridge.getAgents();
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
                 printify: renderPrintify, fiverr: renderFiverr, zendrop: renderZendrop }[state.primary];
  $('#content').innerHTML = view();
  renderSidebar();
}

function setPrimary(tab) { state.primary = tab; state.expandedMetric = null; render(); window.scrollTo(0, 0); }
function setFinanceTab(id) { state.financeTab = id; state.expandedMetric = null; render(); window.scrollTo(0, 0); }
function setEtsyTab(type) { state.etsyTab = type; render(); window.scrollTo(0, 0); }
function setPrintifySub(sub) { state.printifySub = sub; render(); window.scrollTo(0, 0); }
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

/* ---------------- Agent sidebar (left expandable menu) ---------------- */

const AGENT_HINTS = {
  hermes: 'Give an order — e.g. "how did ThreadCraft do this month?" or "delegate research on father\'s day mug demand".',
  research: 'Ask what to make & when — e.g. "what\'s trending for father\'s day?" or "competitor prices for soy candles".',
  design: 'Brief a design — e.g. "make 3 gorpcore hat designs" (needs a linked image model).',
  operations: 'Publish approved work — e.g. "list the World\'s Best Dad design to Etsy on a mug at $14.99".',
  revision: 'Review performance — e.g. "rank my products by margin" or "which marketplace is winning?".',
  accountant: 'Ask about money — e.g. "what\'s my profit this month?" or "break down direct vs indirect costs".',
};

function renderSidebar() {
  const el = $('#sidebar');
  if (!el) return;
  const agents = cache.agents ?? [];
  document.body.classList.toggle('sidebar-expanded', state.sidebarExpanded !== false);
  el.innerHTML = `
    <div class="sb-head">
      <span class="sb-title">AGENTS</span>
      <button class="sb-toggle" onclick="toggleSidebar()" title="Collapse / expand">
        ${state.sidebarExpanded !== false ? '◀' : '▶'}
      </button>
    </div>
    <div class="sb-agents">
      ${agents.map((a) => `
        <button class="sb-agent ${consoleState.open && consoleState.agentId === a.id ? 'active' : ''} ${a.id === 'hermes' ? 'hub' : ''}"
                style="--accent:${a.color}" onclick="openAgentChat('${a.id}')" title="${escapeHtml(a.name)} — ${escapeHtml(a.blurb)}">
          <span class="sb-icon">${a.icon}</span>
          <span class="sb-meta">
            <span class="sb-name">${escapeHtml(a.name)}</span>
            <span class="sb-blurb">${escapeHtml(a.blurb)}</span>
          </span>
          <span class="sb-dot ${a.online ? 'on' : ''}" title="${a.online ? 'online' : 'offline'}"></span>
        </button>`).join('')}
    </div>
    <div class="sb-foot">${HermesBridge.connected ? 'Team online' : 'Agent offline'}</div>`;
}

function toggleSidebar() {
  state.sidebarExpanded = state.sidebarExpanded === false;
  renderSidebar();
}

/* ---------------- Agent console (chat with the selected agent) ---------------- */

const consoleState = { open: false, busy: false, agentId: 'hermes', threads: {} };
const agentThread = (id) => (consoleState.threads[id] ??= []);
const agentMeta = (id) => (cache.agents ?? []).find((a) => a.id === id)
  ?? { id, name: id, icon: '🤖', color: '#02d7f2', blurb: '' };

function openAgentChat(id) {
  consoleState.agentId = id;
  consoleState.open = true;
  renderConsole();
  renderSidebar();
  setTimeout(() => $('#console-input')?.focus(), 50);
}

// Header "Console" button → talk to Hermes.
function toggleConsole() {
  if (consoleState.open && consoleState.agentId === 'hermes') {
    consoleState.open = false;
  } else {
    consoleState.agentId = 'hermes';
    consoleState.open = true;
  }
  renderConsole();
  renderSidebar();
  if (consoleState.open) setTimeout(() => $('#console-input')?.focus(), 50);
}
function closeConsole() { consoleState.open = false; renderConsole(); renderSidebar(); }

async function sendConsoleMessage() {
  const input = $('#console-input');
  const text = input?.value.trim();
  if (!text || consoleState.busy) return;
  const id = consoleState.agentId;
  const thread = agentThread(id);
  input.value = '';
  thread.push({ who: 'you', text });
  consoleState.busy = true;
  renderConsole();
  try {
    const res = await HermesBridge.chatWithAgent(id, text);
    const actionNote = res.actions?.length
      ? '\n— actions: ' + res.actions.map((a) => `${a.tool}${a.ok === false ? ' ✗' : ''}`).join(', ')
      : '';
    thread.push({ who: 'agent', text: res.reply + actionNote });
    // The agent may have changed data (budgets, listings, designs) — refresh.
    if (HermesBridge.connected && res.actions?.length) {
      cache.businesses = await HermesBridge.getBusinesses();
      cache.aiModels = await HermesBridge.getAIModels();
      cache.designLibrary = await HermesBridge.getDesigns();
      for (const t of cache.productTypes) cache.designs[t] = await HermesBridge.getEtsyDesigns(t);
      for (const c of cache.fiverrCategories) cache.gigs[c] = await HermesBridge.getFiverrGigs(c);
      render();
    }
  } catch (err) {
    thread.push({ who: 'agent', text: `Error: ${err.message}` });
  }
  consoleState.busy = false;
  renderConsole();
}

function renderConsole() {
  const el = $('#console');
  if (!consoleState.open) { el.innerHTML = ''; return; }
  const id = consoleState.agentId;
  const meta = agentMeta(id);
  const thread = agentThread(id);
  el.innerHTML = `
    <div class="console-panel" style="--accent:${meta.color}">
      <div class="console-head">
        <span class="panel-title" style="margin:0">${meta.icon} ${escapeHtml(meta.name)} ${id === 'hermes' ? 'console' : 'agent'}</span>
        <button class="modal-close" onclick="closeConsole()">✕</button>
      </div>
      <div class="console-log" id="console-log">
        ${thread.length ? '' : `<div class="console-msg agent">${escapeHtml(AGENT_HINTS[id] ?? 'How can I help?')}</div>`}
        ${thread.map((m) => `
          <div class="console-msg ${m.who === 'you' ? 'you' : 'agent'}">${escapeHtml(m.text)}</div>`).join('')}
        ${consoleState.busy ? '<div class="console-msg agent busy">▍processing…</div>' : ''}
      </div>
      <div class="console-input-row">
        <input id="console-input" type="text" placeholder="Message ${escapeHtml(meta.name)}…"
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
    cache.researchError = null;
    const [result, serp] = await Promise.all([
      HermesBridge.refreshTrends(),
      HermesBridge.refreshSerpFeeds(),
    ]);
    cache.trends = result.trends ?? await HermesBridge.getResearchTrends();
    cache.serpFeeds = serp;
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
    </div>

    ${serpTrendSections()}`;
}

/* ----- SerpApi discovery feeds: shopping / event / holiday trends ----- */

function serpTrendSections() {
  const feeds = cache.serpFeeds ?? {};
  const shopping = feeds.shopping ?? [];
  const events = feeds.events ?? [];
  const holidays = feeds.holidays ?? [];
  const keyless = !(cache.researchSources ?? []).find((s) => s.id === 'serpapi')?.available;

  if (keyless && !shopping.length && !events.length) {
    return `<div class="card section-gap"><span class="muted">Add a SerpApi key to populate Shopping, Event and Holiday trends. Then hit ↻ Refresh.</span></div>`;
  }

  const errs = (feeds.errors ?? []);
  return `
    ${errs.length ? `<div class="card detail-drawer" style="border-color:var(--purple)"><span class="muted">SerpApi notes: ${errs.map(escapeHtml).join(' · ')}</span></div>` : ''}

    <div class="panel-title">🛍️ Shopping trends <span class="muted" style="font-weight:400">— live products &amp; prices via SerpApi</span></div>
    <div class="trend-grid">
      ${shopping.length ? shopping.map(shoppingTrendCard).join('') : `<div class="card"><span class="muted">No shopping data yet — hit ↻ Refresh.</span></div>`}
    </div>

    <div class="panel-title">🎉 Event trends <span class="muted" style="font-weight:400">— what's drawing crowds (Google Events)</span></div>
    <div class="trend-grid">
      ${events.length ? events.map(eventTrendCard).join('') : `<div class="card"><span class="muted">No events yet — hit ↻ Refresh.</span></div>`}
    </div>

    <div class="panel-title">📅 Holiday trends <span class="muted" style="font-weight:400">— upcoming holidays &amp; rising shopping interest</span></div>
    <div class="trend-grid">
      ${holidays.length ? holidays.map(holidayTrendCard).join('') : `<div class="card"><span class="muted">No holidays loaded.</span></div>`}
    </div>`;
}

function shoppingTrendCard(s) {
  const open = state.expandedCompetitors[s.id];
  const range = s.priceRange ? `${money(s.priceRange[0], 2)}–${money(s.priceRange[1], 2)}` : '—';
  return `
    <div class="card trend-card">
      <div class="trend-head">
        <div><h3>${escapeHtml(s.title)}</h3><div class="category">Shopping · via ${escapeHtml(s.source)}</div></div>
        ${s.avgPrice != null ? `<span class="score-badge mid">${money(s.avgPrice, 0)} avg</span>` : ''}
      </div>
      <div class="provenance ${s.live ? 'live' : 'sample'}">${s.live ? '● LIVE' : '○ SAMPLE'}</div>
      <div class="trend-metrics">
        <div class="tm"><b>${s.count}</b>live products</div>
        <div class="tm"><b>${range}</b>price range</div>
      </div>
      ${(s.items ?? []).length ? `
        <button class="competitor-toggle" onclick="toggleCompetitors('${s.id}')">
          ${open ? 'Hide' : 'Show'} ${s.items.length} products ${open ? '▴' : '▾'}
        </button>
        ${open ? `<div style="margin-top:10px">${financeTable(
          ['Product', 'Seller', 'Price', '★'],
          s.items.map((it) => [escapeHtml(it.name), escapeHtml(it.source ?? '—'), it.price != null ? money(it.price, 2) : '—', it.rating != null ? it.rating.toFixed(1) : '—']),
          [2, 3])}</div>` : ''}` : ''}
    </div>`;
}

function eventTrendCard(e) {
  return `
    <div class="card trend-card">
      <div class="trend-head">
        <div><h3>${escapeHtml(e.title ?? 'Event')}</h3><div class="category">Event · via ${escapeHtml(e.source)}</div></div>
        ${e.startDate ? `<span class="score-badge">${escapeHtml(e.startDate)}</span>` : ''}
      </div>
      <div class="provenance live">● LIVE</div>
      <div class="trend-note">
        ${e.when ? `🕒 ${escapeHtml(e.when)}<br>` : ''}
        ${e.venue ? `📍 ${escapeHtml(e.venue)}` : ''}${e.address ? ` <span class="muted">· ${escapeHtml(e.address)}</span>` : ''}
      </div>
      ${e.link ? `<button class="competitor-toggle" onclick="window.open('${escapeHtml(e.link)}','_blank')">Open event ↗</button>` : ''}
    </div>`;
}

function holidayTrendCard(h) {
  const soon = h.daysUntil <= 30;
  const dateLabel = new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `
    <div class="card trend-card">
      <div class="trend-head">
        <div><h3>${escapeHtml(h.name)}</h3><div class="category">${dateLabel} · via ${escapeHtml(h.source)}</div></div>
        <span class="score-badge ${soon ? '' : 'mid'}">${h.daysUntil <= 0 ? 'now' : h.daysUntil + 'd'}</span>
      </div>
      <div class="provenance ${h.live ? 'live' : 'sample'}">${h.live ? '● LIVE interest' : '○ calendar'}</div>
      ${h.growthPct != null ? `<div class="trend-metrics"><div class="tm"><b class="up">${h.growthPct >= 0 ? '+' : ''}${h.growthPct}%</b>search interest</div></div>` : ''}
      ${(h.interest ?? []).length ? `<div class="chart-wrap">${sparkline(h.interest, 300, 46, '#fcee0a')}</div>` : ''}
      <div class="trend-note">${h.daysUntil <= 0 ? 'Happening now — last call for listings.' : `${h.daysUntil} days out — ${soon ? 'list now to catch the run-up.' : 'plan designs ahead.'}`}</div>
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

function renderPrintify() {
  const subs = [
    { id: 'catalog', label: '🧾 Catalog' },
    { id: 'mockup', label: '🎨 Mockup Studio' },
    { id: 'designs', label: '✨ My Designs' },
  ];
  const body = { catalog: printifyCatalogView, mockup: mockupStudio, designs: printifyDesigns }[state.printifySub]();
  return `
    ${printifyPanel()}
    <div class="secondary-tabs">
      ${subs.map((s) => `
        <button class="secondary-tab ${state.printifySub === s.id ? 'active' : ''}"
                onclick="setPrintifySub('${s.id}')">${s.label}</button>`).join('')}
    </div>
    ${body}`;
}

/* ----- Catalog: real Printify products + per-unit retail ----- */

function printifyCatalogView() {
  if (!cache.printifyCatalog) { ensurePrintifyCatalog(); }
  const catalog = cache.printifyCatalog;
  if (catalog === undefined) return '<div class="muted">Loading Printify catalog…</div>';
  if (!catalog || !catalog.length) {
    return `<div class="card"><span class="muted">${HermesBridge.connected ? 'No catalog returned.' : 'Start the agent to load the live Printify catalog.'}</span></div>`;
  }
  return `
    <div class="panel-title">Printify catalog — products available, retail $/unit</div>
    <div class="muted" style="font-size:12px;margin-bottom:12px">
      Live from Printify (${catalog.length} product types). Printify's catalog API doesn't expose
      base cost — that's revealed when a product is created — so set your <b>retail price per unit</b> below.
    </div>
    <div class="design-grid">
      ${catalog.map((p) => `
        <div class="card design-card">
          <div class="design-art" style="background:#fff;background-image:url('${p.image}');background-size:contain;background-repeat:no-repeat;background-position:center"></div>
          <div class="design-body">
            <h4>${p.title}</h4>
            <div class="muted" style="font-size:12px;margin-bottom:8px">${p.category} · ${p.brand}</div>
            <div class="cred-row" style="margin-bottom:8px">
              <span class="muted">Retail $/unit</span>
              <input class="price-input" type="number" step="0.01" value="${p.retail}"
                     onchange="updatePrintifyPrice(${p.blueprintId}, this.value)" />
            </div>
            <button class="link-toggle" onclick="useInMockup(${p.blueprintId})">Use in Mockup Studio →</button>
          </div>
        </div>`).join('')}
    </div>`;
}

async function ensurePrintifyCatalog() {
  if (cache.printifyCatalog !== undefined) return;
  cache.printifyCatalog = undefined;
  const data = await HermesBridge.getPrintifyCatalog();
  cache.printifyCatalog = data;
  render();
}

async function updatePrintifyPrice(blueprintId, value) {
  const retail = Number(value);
  await HermesBridge.setPrintifyPrice(blueprintId, retail);
  const item = (cache.printifyCatalog ?? []).find((p) => p.blueprintId === blueprintId);
  if (item) item.retail = retail;
}

function useInMockup(blueprintId) {
  state.mockup.blueprintId = blueprintId;
  state.printifySub = 'mockup';
  cache.blueprintDetail = undefined;
  render();
  ensureBlueprintDetail(blueprintId);
}

/* ----- Mockup Studio: put a (Higgsfield) design on the merch ----- */

function mockupStudio() {
  const catalog = cache.printifyCatalog ?? [];
  if (!catalog.length) { ensurePrintifyCatalog(); }
  const m = state.mockup;
  const product = catalog.find((p) => p.blueprintId === m.blueprintId);
  const detail = cache.blueprintDetail;
  const productImg = detail?.images?.[0] ?? product?.image;

  return `
    <div class="panel-title">Mockup Studio — place a design on the merchandise</div>
    <div class="mockup-wrap">
      <div class="mockup-stage card">
        ${productImg ? `
          <div class="mockup-canvas">
            <img class="mockup-product" src="${productImg}" alt="product" />
            ${m.designUrl ? `<img class="mockup-design" src="${m.designUrl}"
              style="width:${m.scale}%; top:${m.posY}%;" alt="design"
              onerror="this.style.outline='2px solid var(--red)'" />` : `
              <div class="mockup-hint">Add a design →</div>`}
          </div>` : `<div class="muted" style="padding:40px;text-align:center">Pick a product to begin.</div>`}
      </div>

      <div class="mockup-controls card">
        <div class="panel-title" style="margin-bottom:10px">Product</div>
        <select class="mockup-select" onchange="selectMockupProduct(this.value)">
          <option value="">— choose merch —</option>
          ${catalog.map((p) => `<option value="${p.blueprintId}" ${p.blueprintId === m.blueprintId ? 'selected' : ''}>${p.category} · ${p.title}</option>`).join('')}
        </select>
        ${detail ? `<div class="muted" style="font-size:11.5px;margin:8px 0">
          ${detail.colors.length} colors · ${detail.sizes.length || '—'} sizes · ${detail.brand}</div>` : ''}

        <div class="panel-title" style="margin:14px 0 10px">Design (from Higgsfield AI)</div>
        <input class="mockup-input" type="text" placeholder="Paste Higgsfield image URL…"
               value="${m.designUrl.startsWith('data:') ? '' : m.designUrl}"
               onchange="setMockupDesign(this.value)" />
        <div class="muted" style="font-size:11px;margin:6px 0">or upload an exported design:</div>
        <input type="file" accept="image/*" class="mockup-file" onchange="uploadMockupDesign(event)" />

        <div class="panel-title" style="margin:14px 0 8px">Placement</div>
        <label class="slider-row">Size
          <input type="range" min="12" max="80" value="${m.scale}" oninput="setMockupScale(this.value)" />
        </label>
        <label class="slider-row">Vertical
          <input type="range" min="10" max="70" value="${m.posY}" oninput="setMockupPosY(this.value)" />
        </label>

        <button class="link-toggle linked" style="margin-top:14px;width:100%"
                ${!(product && m.designUrl) ? 'disabled' : ''} onclick="saveMockup()">
          💾 Save mockup
        </button>
        <div class="muted" style="font-size:11px;margin-top:8px">
          This is a live preview. To create the real Printify product (uploads the design + generates
          official mockups), ask Hermes in the Console — it's a confirmed write.
        </div>
      </div>
    </div>`;
}

async function ensureBlueprintDetail(blueprintId) {
  cache.blueprintDetail = undefined;
  cache.blueprintDetail = await HermesBridge.getPrintifyBlueprint(blueprintId);
  render();
}
function selectMockupProduct(id) { state.mockup.blueprintId = Number(id) || null; cache.blueprintDetail = undefined; render(); if (id) ensureBlueprintDetail(Number(id)); }
function setMockupDesign(url) { state.mockup.designUrl = url.trim(); render(); }
function setMockupScale(v) { state.mockup.scale = Number(v); const el = document.querySelector('.mockup-design'); if (el) el.style.width = v + '%'; }
function setMockupPosY(v) { state.mockup.posY = Number(v); const el = document.querySelector('.mockup-design'); if (el) el.style.top = v + '%'; }
function uploadMockupDesign(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { state.mockup.designUrl = reader.result; render(); };
  reader.readAsDataURL(file);
}
async function saveMockup() {
  const product = (cache.printifyCatalog ?? []).find((p) => p.blueprintId === state.mockup.blueprintId);
  await HermesBridge.saveMockup({
    blueprintId: state.mockup.blueprintId,
    product: product?.title, retail: product?.retail,
    designUrl: state.mockup.designUrl.startsWith('data:') ? '(uploaded image)' : state.mockup.designUrl,
    scale: state.mockup.scale, posY: state.mockup.posY,
  });
  const btn = document.querySelector('.mockup-controls .link-toggle');
  if (btn) btn.textContent = '✓ Saved';
}

/* ----- My Designs: existing AI-generated design pipeline ----- */

function printifyDesigns() {
  const library = cache.designLibrary ?? [];
  return `
    <div class="card section-gap">
      <div class="panel-title">Import a design from Higgsfield AI</div>
      <div class="cred-row">
        <input id="design-url" class="mockup-input" style="flex:2;margin:0" type="text"
               placeholder="Paste Higgsfield image URL (the design PNG)…" />
        <input id="design-title" class="mockup-input" style="flex:1;margin:0" type="text" placeholder="Title" />
        <button class="link-toggle linked" onclick="importDesign()">+ Add design</button>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:8px">
        Or upload an exported file: <input type="file" accept="image/*" class="mockup-file" style="display:inline-block;width:auto" onchange="uploadDesignFile(event)" />
        ${cache.designError ? `<span style="color:var(--red)"> · ${cache.designError}</span>` : ''}
      </div>
    </div>

    <div class="panel-title">My designs — ${library.length} from Higgsfield AI</div>
    ${library.length ? `
      <div class="design-grid">
        ${library.map(libraryCard).join('')}
      </div>` : `
      <div class="card"><span class="muted">No designs yet. Generate art in Higgsfield AI, then paste its image URL above (or upload a file).</span></div>`}`;
}

function libraryCard(d) {
  const active = (d.listings ?? []).find((l) => l.published !== false);
  return `
    <div class="card design-card">
      <div class="design-art" style="background:#0d141b;background-image:url('${d.thumbUrl || d.imageUrl}');background-size:cover;background-position:center"></div>
      <div class="design-body">
        <h4>${d.title}</h4>
        <div class="design-meta">
          <span class="badge ${active ? 'listed' : 'review'}">${d.status}</span>
          <span class="badge printify">${d.source}</span>
        </div>
        <div class="design-actions">
          ${active
            ? `<button class="danger" onclick="delistProduct(${active.shopId}, '${active.productId}')">⊘ Delist from Etsy</button>`
            : `<button class="primary" onclick="openListModal('${d.id}')">🛒 List to Etsy</button>`}
          <button onclick="useDesignInMockup('${d.id}')">🎨 Mockup</button>
          <button onclick="removeDesign('${d.id}')">✕</button>
        </div>
      </div>
    </div>`;
}

async function delistProduct(shopId, productId) {
  try {
    await HermesBridge.delistProduct(shopId, productId);
    cache.designLibrary = await HermesBridge.getDesigns();
    if (state.printifyShop) state.printifyProducts = await HermesBridge.getPrintifyProducts(state.printifyShop, 12);
    render();
  } catch (err) { alert('Delist failed: ' + err.message); }
}

async function importDesign() {
  const url = document.getElementById('design-url')?.value.trim();
  const title = document.getElementById('design-title')?.value.trim();
  if (!url) { cache.designError = 'Paste an image URL first.'; render(); return; }
  try {
    cache.designError = null;
    await HermesBridge.addDesign({ title: title || 'Higgsfield design', imageUrl: url, source: 'Higgsfield AI' });
    cache.designLibrary = await HermesBridge.getDesigns();
    render();
  } catch (err) { cache.designError = err.message; render(); }
}

function uploadDesignFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await HermesBridge.addDesign({ title: file.name.replace(/\.[^.]+$/, ''), imageUrl: reader.result, source: 'Higgsfield AI (upload)' });
      cache.designLibrary = await HermesBridge.getDesigns();
      render();
    } catch (err) { cache.designError = err.message; render(); }
  };
  reader.readAsDataURL(file);
}

async function removeDesign(id) {
  await HermesBridge.deleteDesign(id);
  cache.designLibrary = (cache.designLibrary ?? []).filter((d) => d.id !== id);
  render();
}

function useDesignInMockup(id) {
  const d = (cache.designLibrary ?? []).find((x) => x.id === id);
  if (!d) return;
  state.mockup.designUrl = d.imageUrl;
  state.printifySub = 'mockup';
  if (!state.mockup.blueprintId && (cache.printifyCatalog ?? []).length) {
    state.mockup.blueprintId = cache.printifyCatalog[0].blueprintId;
    ensureBlueprintDetail(state.mockup.blueprintId);
  }
  render();
}

/* ----- List to Etsy via Printify modal ----- */

async function openListModal(designId) {
  const design = (cache.designLibrary ?? []).find((d) => d.id === designId);
  state.listModal = {
    designId, blueprintId: null, title: design?.title || '', price: null,
    matchBackground: true, cropToFit: true,
    busy: false, result: null, error: null, description: '', descBusy: true, descSource: null,
  };
  renderListModal();
  if (cache.printifyCatalog === undefined || cache.printifyCatalog === null) {
    cache.printifyCatalog = await HermesBridge.getPrintifyCatalog();
  }
  const first = (cache.printifyCatalog ?? [])[0];
  if (first && state.listModal) { state.listModal.blueprintId = first.blueprintId; state.listModal.price = first.retail; }
  renderListModal(); // re-render with the product dropdown populated
  await generateModalDescription(); // auto-write the description (material / country / inspiration)
}
function closeListModal() { state.listModal = null; renderListModal(); }

// Pull the current form values into state so edits survive a re-render. The modal
// re-renders on every description regen / product change, so without this the
// <select>, title, price and checkboxes would snap back to defaults — which is
// how the wrong product used to get published.
function syncListModalFromDOM() {
  const m = state.listModal;
  if (!m) return;
  const bp = document.getElementById('list-blueprint');
  const title = document.getElementById('list-title');
  const price = document.getElementById('list-price');
  const desc = document.getElementById('list-desc');
  const bg = document.getElementById('list-bgmatch');
  const crop = document.getElementById('list-crop');
  if (bp && bp.value) m.blueprintId = Number(bp.value);
  if (title) m.title = title.value;
  if (price && price.value !== '') m.price = Number(price.value);
  if (desc) m.description = desc.value;
  if (bg) m.matchBackground = bg.checked;
  if (crop) m.cropToFit = crop.checked;
}

// Ask the agent (Claude → real Printify facts) to write the listing copy.
async function generateModalDescription() {
  const m = state.listModal;
  if (!m) return;
  syncListModalFromDOM();
  const design = (cache.designLibrary ?? []).find((d) => d.id === m.designId);
  const blueprintId = m.blueprintId || (cache.printifyCatalog ?? [])[0]?.blueprintId;
  const title = m.title?.trim() || design?.title;
  m.descBusy = true; m.descError = null; renderListModal();
  try {
    const copy = await HermesBridge.describeListing({ blueprintId, title, designTitle: design?.title, designPrompt: design?.prompt });
    m.description = copy.description; m.material = copy.material; m.country = copy.country; m.descSource = copy.source;
  } catch (err) { m.descError = err.message; }
  m.descBusy = false; renderListModal();
}

// Product changed → switch to that product's default price, update the preview,
// and regenerate the copy (material/country shift with the product).
function onListProductChange() {
  syncListModalFromDOM(); // captures the newly-selected blueprintId
  const m = state.listModal;
  const prod = (cache.printifyCatalog ?? []).find((p) => p.blueprintId === m.blueprintId);
  if (prod) {
    m.price = prod.retail;
    const priceEl = document.getElementById('list-price');
    if (priceEl) priceEl.value = prod.retail; // keep DOM in step so the re-sync below doesn't clobber it
  }
  generateModalDescription(); // re-renders with the new product + price + preview
}

function renderListModal() {
  const modal = $('#modal');
  if (!state.listModal) { modal.innerHTML = ''; return; }
  const m = state.listModal;
  const design = (cache.designLibrary ?? []).find((d) => d.id === m.designId);
  const catalog = cache.printifyCatalog ?? [];
  const prod = catalog.find((p) => p.blueprintId === m.blueprintId) ?? catalog[0];
  const etsyShop = (cache.printifyStatus?.shops ?? []).find((s) => s.salesChannel === 'etsy');
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if (event.target === this) closeListModal()">
      <div class="modal card">
        <div class="modal-head">
          <span class="panel-title" style="margin:0">List to Etsy via Printify</span>
          <button class="modal-close" onclick="closeListModal()">✕</button>
        </div>
        <div style="display:flex;gap:14px;margin:12px 0">
          <div style="width:140px;flex:none">
            <div class="list-preview" style="position:relative;width:140px;height:140px;background:#0d141b;border:1px solid var(--line);border-radius:6px;overflow:hidden">
              ${prod?.image ? `<img src="${escapeHtml(prod.image)}" alt="${escapeHtml(prod.category || 'product')}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain" />` : ''}
              ${design?.imageUrl ? `<img src="${escapeHtml(design.imageUrl)}" alt="design" style="position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:44%;object-fit:contain;mix-blend-mode:multiply" onerror="this.style.display='none'" />` : ''}
            </div>
            <div class="muted" style="font-size:10.5px;text-align:center;margin-top:4px">approx. preview — ${escapeHtml(prod?.category || '')}</div>
          </div>
          <div style="flex:1">
            <label class="list-field">Product
              <select id="list-blueprint" class="mockup-input" onchange="onListProductChange()">
                ${catalog.map((p) => `<option value="${p.blueprintId}" data-retail="${p.retail}" ${p.blueprintId === m.blueprintId ? 'selected' : ''}>${p.category} · ${p.title}</option>`).join('')}
              </select>
            </label>
            <label class="list-field">Title
              <input id="list-title" class="mockup-input" type="text" value="${escapeHtml(m.title || '')}" />
            </label>
            <label class="list-field">Price $/unit
              <input id="list-price" class="mockup-input" type="number" step="0.01" value="${m.price ?? prod?.retail ?? 24.99}" />
            </label>
          </div>
        </div>
        <label class="bgmatch-row">
          <input type="checkbox" id="list-bgmatch" ${m.matchBackground !== false ? 'checked' : ''} />
          <span>Match background to product <span class="muted">— removes the white background so the design blends into the garment color</span></span>
        </label>
        <label class="bgmatch-row">
          <input type="checkbox" id="list-crop" ${m.cropToFit !== false ? 'checked' : ''} />
          <span>Crop &amp; fit to product <span class="muted">— trims empty space so the design fills the print area</span></span>
        </label>
        <label class="list-field" style="margin-top:6px">
          <span style="display:flex;justify-content:space-between;align-items:center">
            <span>Description</span>
            <button onclick="generateModalDescription()" ${m.descBusy ? 'disabled' : ''} style="font-size:11px;padding:3px 8px">${m.descBusy ? '✨ Writing…' : '✨ Regenerate with Claude'}</button>
          </span>
          <textarea id="list-desc" class="mockup-input" rows="7" placeholder="${m.descBusy ? 'Generating description…' : 'Description'}">${escapeHtml(m.description || '')}</textarea>
        </label>
        <div class="muted" style="font-size:11px;margin:2px 0 8px;display:flex;gap:10px;flex-wrap:wrap">
          ${m.descSource ? `<span>via ${m.descSource === 'claude' ? 'Claude' : 'template'}</span>` : ''}
          ${m.material ? `<span>· Material: ${escapeHtml(String(m.material).slice(0, 48))}${String(m.material).length > 48 ? '…' : ''}</span>` : ''}
          ${m.country ? `<span>· Made in: ${escapeHtml(m.country)}</span>` : ''}
          ${m.descError ? `<span style="color:var(--red)">· ${escapeHtml(m.descError)}</span>` : ''}
        </div>
        <div class="muted" style="font-size:11.5px;margin:8px 0 10px">
          Publishes to ${etsyShop ? `<b>${etsyShop.title}</b> (live Etsy store)` : 'your Etsy-connected Printify shop'}.
          This creates a real product and a live Etsy listing.
        </div>
        ${m.result ? `<div class="verify-result ${m.result.dryRun ? 'warn' : 'ok'}">${m.result.dryRun
          ? `Dry run OK — would enable ${m.result.plan.variantsEnabled} variants at $${m.result.plan.priceUsd} on shop ${m.result.plan.shopId}.`
          : `✅ ${escapeHtml(m.result.detail)}${m.result.etsyUrl ? ` · <a href="${escapeHtml(m.result.etsyUrl)}" target="_blank" rel="noopener">View on Etsy ↗</a>` : ''}`}</div>` : ''}
        ${m.error ? `<div class="verify-result warn">⚠️ ${m.error}</div>` : ''}
        <div class="design-actions" style="margin-top:6px">
          <button onclick="submitListing(true)" ${m.busy ? 'disabled' : ''}>Dry-run check</button>
          <button class="primary" onclick="submitListing(false)" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Publishing…' : 'Publish to Etsy'}</button>
        </div>
      </div>
    </div>`;
}

async function submitListing(dryRun) {
  const m = state.listModal;
  syncListModalFromDOM(); // capture the chosen product + any edits before we publish
  const design = (cache.designLibrary ?? []).find((d) => d.id === m.designId);
  m.busy = true; m.error = null; m.result = null; renderListModal();
  try {
    m.result = await HermesBridge.listToEtsy({
      designId: design.id, imageUrl: design.imageUrl,
      title: m.title?.trim(), price: m.price, blueprintId: m.blueprintId,
      matchBackground: m.matchBackground, cropToFit: m.cropToFit, description: m.description,
      designTitle: design.title, designPrompt: design.prompt,
      publish: !dryRun,   // the List to Etsy button publishes live; dry-run only validates
      dryRun,
    });
    if (!dryRun) cache.designLibrary = await HermesBridge.getDesigns();
  } catch (err) { m.error = err.message; }
  m.busy = false; renderListModal();
  if (!dryRun && m.result && !m.result.dryRun) render(); // refresh cards behind modal
}

function printifyPanel() {
  const s = cache.printifyStatus ?? {};
  const dot = s.live ? 'linked' : '';
  return `
    <div class="card section-gap printify-panel">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="panel-title" style="margin:0">Printify fulfillment</span>
        <span class="model-pill ${dot}">${s.live ? '◉ Connected (live API)' : s.configured ? '○ key set, not reachable' : '○ not configured'}</span>
        ${s.maskedToken ? `<code class="muted" style="font-size:11px">${s.maskedToken}</code>` : ''}
        <span class="muted" style="margin-left:auto">${s.detail ?? ''}</span>
      </div>
      ${(s.shops ?? []).length ? `
        <div class="printify-shops">
          ${s.shops.map((shop) => `
            <button class="shop-chip ${state.printifyShop === shop.id ? 'active' : ''}"
                    onclick="loadPrintifyProducts(${shop.id})">
              🏪 ${shop.title}
              <span class="muted">· ${shop.salesChannel}${shop.products != null ? ` · ${shop.products} products` : ''}</span>
            </button>`).join('')}
        </div>` : ''}
      ${state.printifyProducts ? printifyProductList() : (state.printifyShop ? '<div class="muted">Loading…</div>' : '')}
    </div>`;
}

function printifyProductList() {
  const { total, products } = state.printifyProducts;
  if (!products.length) return `<div class="muted" style="margin-top:8px">No products in this shop (total: ${total}).</div>`;
  return `
    <div class="design-grid" style="margin-top:12px">
      ${products.map((p) => `
        <div class="card design-card">
          <div class="design-art" style="background:#0d141b;${p.image ? `background-image:url('${p.image}');background-size:cover;background-position:center` : ''}">
            ${p.image ? '' : '🖼️'}
          </div>
          <div class="design-body">
            <h4>${p.title}</h4>
            <div class="design-meta">
              <span class="badge ${p.visible ? 'listed' : 'review'}">${p.visible ? 'Published' : 'Hidden'}</span>
              <span class="badge printify">${p.variants} variants</span>
            </div>
            <div class="design-stats">
              <span>From <b>${p.minPrice != null ? money(p.minPrice, 2) : '—'}</b></span>
              <span class="muted">${p.variants} variants</span>
            </div>
            <div class="design-actions">
              <button class="danger" onclick="delistProduct(${state.printifyShop}, '${p.id}')">⊘ Delist from Etsy</button>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

async function loadPrintifyProducts(shopId) {
  state.printifyShop = shopId;
  state.printifyProducts = null;
  render();
  state.printifyProducts = await HermesBridge.getPrintifyProducts(shopId, 12);
  render();
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
