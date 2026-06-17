/* ============================================================
   HermesBridge — the ONLY thing the UI talks to.
   Today it returns simulated data. To connect the Hermes agent,
   replace each method body with a real call, e.g.:

     async getFinanceOverview() {
       return fetch('http://localhost:8787/api/finance/overview').then(r => r.json());
     }

   The UI never reads MOCK directly, so no UI changes are needed
   when the agent comes online.
   ============================================================ */

const MOCK = {
  businesses: [
    {
      id: 'cozyglow',
      name: 'Cozy Glow',
      platform: 'Etsy + Printify',
      tagline: 'AI-designed candles',
      agentLinked: false,
      monthlyRevenue: [3100, 3420, 3980, 4210, 4870, 5320, 5100, 5680, 6240, 6810, 7430, 8120],
      cogsPct: 0.42,
      adSpend: { 'Etsy Ads': 410, 'Pinterest': 220, 'Facebook': 180, 'Google': 0, 'TikTok': 90 },
    },
    {
      id: 'magnetmania',
      name: 'MagnetMania',
      platform: 'Etsy + Printify',
      tagline: 'Fridge magnets & pins',
      agentLinked: false,
      monthlyRevenue: [980, 1040, 1190, 1320, 1280, 1510, 1620, 1750, 1890, 2010, 2240, 2380],
      cogsPct: 0.38,
      adSpend: { 'Etsy Ads': 150, 'Pinterest': 80, 'Facebook': 60, 'Google': 0, 'TikTok': 40 },
    },
    {
      id: 'threadcraft',
      name: 'ThreadCraft',
      platform: 'Etsy + Printify',
      tagline: 'Shirts & hats',
      agentLinked: false,
      monthlyRevenue: [2200, 2350, 2180, 2540, 2890, 3120, 3480, 3260, 3710, 4050, 4480, 4910],
      cogsPct: 0.51,
      adSpend: { 'Etsy Ads': 290, 'Pinterest': 110, 'Facebook': 240, 'Google': 130, 'TikTok': 160 },
    },
    {
      id: 'petgear',
      name: 'PetGear Plus',
      platform: 'Shopify',
      tagline: 'Pet accessories (dropship)',
      agentLinked: false,
      monthlyRevenue: [1500, 1620, 1480, 1810, 2040, 2310, 2150, 2480, 2620, 2940, 3180, 3460],
      cogsPct: 0.55,
      adSpend: { 'Etsy Ads': 0, 'Pinterest': 90, 'Facebook': 520, 'Google': 380, 'TikTok': 310 },
    },
    {
      id: 'pixelforge',
      name: 'PixelForge',
      platform: 'Fiverr',
      tagline: 'AI thumbnails & video ads',
      agentLinked: false,
      monthlyRevenue: [620, 750, 890, 1040, 1230, 1380, 1560, 1820, 2100, 2350, 2680, 3050],
      cogsPct: 0.18, // mostly AI generation costs
      adSpend: { 'Fiverr Promoted': 140, 'TikTok': 60, 'Google': 45 },
    },
  ],

  months: ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],

  llm: {
    providers: [
      {
        name: 'Anthropic (Claude)',
        model: 'claude-fable-5',
        tokensUsed: 18_400_000,
        tokenBudget: 30_000_000,
        rpmUsed: 38,
        rpmLimit: 60,
        costMTD: 312.4,
        tasks: 'Design generation, listing copy, research summaries',
      },
      {
        name: 'OpenAI',
        model: 'gpt-image',
        tokensUsed: 6_100_000,
        tokenBudget: 12_000_000,
        rpmUsed: 12,
        rpmLimit: 50,
        costMTD: 148.9,
        tasks: 'Image generation fallback',
      },
    ],
  },

  /* Generative AI models the Hermes agent can drive. Linking/unlinking here
     is what the whole dashboard reads — Fiverr gigs, Etsy designs, etc. */
  aiModels: [
    { id: 'midjourney', name: 'Midjourney', modality: 'Image', provider: 'Midjourney Inc.',
      linked: true, usedBy: ['Etsy designs', 'Fiverr thumbnails'], costMTD: 96.0 },
    { id: 'higgsfield', name: 'Higgsfield AI', modality: 'Video', provider: 'Higgsfield',
      linked: false, usedBy: ['Fiverr video ads'], costMTD: 0 },
    { id: 'runway', name: 'Runway Gen-4', modality: 'Video', provider: 'Runway',
      linked: false, usedBy: ['Fiverr video ads'], costMTD: 0 },
    { id: 'sdxl', name: 'Stable Diffusion XL', modality: 'Image', provider: 'Stability AI',
      linked: true, usedBy: ['Etsy designs', 'Fiverr thumbnails'], costMTD: 21.5 },
    { id: 'claude', name: 'Claude (Fable 5)', modality: 'Text', provider: 'Anthropic',
      linked: true, usedBy: ['Hermes agent core', 'Listing copy', 'Research'], costMTD: 312.4 },
    { id: 'gptimage', name: 'GPT Image', modality: 'Image', provider: 'OpenAI',
      linked: false, usedBy: ['Fallback image gen'], costMTD: 0 },
  ],

  fiverr: {
    categories: ['Thumbnails', 'Video Ads'],
    gigs: {
      Thumbnails: [
        { id: 'f1', title: 'YouTube Gaming Thumbnail Pack', client: '@StreamerNova',
          model: 'Midjourney', status: 'Delivered', price: 45, orders30d: 23, rating: 4.9,
          palette: ['#ff6b95', '#7e57c2'], emoji: '🎮' },
        { id: 'f2', title: 'Reaction-Style Viral Thumbs', client: '@ViralVistas',
          model: 'Midjourney', status: 'Generating', price: 35, orders30d: 17, rating: 4.8,
          palette: ['#ffd54f', '#ff7043'], emoji: '😱' },
        { id: 'f3', title: 'Podcast Cover Thumbnails', client: '@TalkTrackPod',
          model: 'Stable Diffusion XL', status: 'In Queue', price: 30, orders30d: 9, rating: 4.7,
          palette: ['#4dd0e1', '#1a237e'], emoji: '🎙️' },
        { id: 'f4', title: 'Twitch Panels + Offline Screens', client: '@PixelPaladin',
          model: 'Stable Diffusion XL', status: 'Delivered', price: 55, orders30d: 12, rating: 5.0,
          palette: ['#9575cd', '#311b92'], emoji: '🟣' },
      ],
      'Video Ads': [
        { id: 'f5', title: '15s TikTok Product Ad', client: 'GlowSkin Co.',
          model: 'Higgsfield AI', status: 'Delivered', price: 120, orders30d: 14, rating: 4.9,
          palette: ['#f06292', '#880e4f'], emoji: '✨' },
        { id: 'f6', title: 'UGC-Style Dropship Ad', client: 'KitchenWiz',
          model: 'Higgsfield AI', status: 'Generating', price: 150, orders30d: 8, rating: 4.8,
          palette: ['#4db6ac', '#004d40'], emoji: '🍳' },
        { id: 'f7', title: '30s YouTube Pre-Roll', client: 'FitFuel Labs',
          model: 'Runway Gen-4', status: 'In Queue', price: 220, orders30d: 5, rating: 4.6,
          palette: ['#aed581', '#33691e'], emoji: '💪' },
        { id: 'f8', title: 'Etsy Listing Promo Reel', client: 'Cozy Glow (internal)',
          model: 'Higgsfield AI', status: 'Delivered', price: 0, orders30d: 6, rating: 5.0,
          palette: ['#ff9a56', '#bf360c'], emoji: '🕯️' },
      ],
    },
  },

  research: {
    trends: [
      {
        id: 'dopamine-decor',
        product: 'Dopamine decor candles',
        category: 'Home / Candles',
        source: 'TikTok + Pinterest',
        impressions: 4_200_000,
        likes: 386_000,
        growthPct: 64,
        successScore: 86,
        interest: [22, 28, 31, 38, 45, 52, 61, 72, 78, 85, 90, 96],
        note: 'Bright multi-color aesthetic trending with 18-30 demo. Etsy search volume for "colorful soy candle" up 41% QoQ.',
        competitors: [
          { name: 'BrightWick Co.', monthlyEst: 21000, channels: ['TikTok', 'Etsy Ads'], price: 24.99, rating: 4.8 },
          { name: 'NeonFlame Studio', monthlyEst: 14500, channels: ['Pinterest', 'Instagram'], price: 19.5, rating: 4.6 },
          { name: 'GlowHaus', monthlyEst: 9800, channels: ['Etsy Ads'], price: 27.0, rating: 4.9 },
        ],
      },
      {
        id: 'retro-fridge',
        product: 'Retro pixel-art magnets',
        category: 'Kitchen / Magnets',
        source: 'Etsy search + Instagram',
        impressions: 1_100_000,
        likes: 98_000,
        growthPct: 38,
        successScore: 72,
        interest: [40, 42, 41, 45, 48, 51, 50, 55, 58, 61, 66, 70],
        note: '90s nostalgia cycle. Bundles of 6-8 outsell singles 3:1 historically.',
        competitors: [
          { name: 'PixelPeach', monthlyEst: 7200, channels: ['Instagram', 'Etsy Ads'], price: 12.99, rating: 4.7 },
          { name: '8BitFridge', monthlyEst: 5400, channels: ['Etsy Ads'], price: 9.99, rating: 4.5 },
        ],
      },
      {
        id: 'gorpcore-hats',
        product: 'Gorpcore embroidered caps',
        category: 'Apparel / Hats',
        source: 'TikTok',
        impressions: 6_800_000,
        likes: 542_000,
        growthPct: 91,
        successScore: 79,
        interest: [10, 12, 15, 14, 22, 30, 38, 52, 60, 74, 88, 95],
        note: 'Outdoor-aesthetic caps spiking. Historical pattern: apparel trends from TikTok hold ~2 quarters.',
        competitors: [
          { name: 'TrailCap Supply', monthlyEst: 33000, channels: ['TikTok', 'Facebook'], price: 29.0, rating: 4.6 },
          { name: 'SummitStitch', monthlyEst: 18700, channels: ['TikTok', 'Google'], price: 24.0, rating: 4.4 },
          { name: 'BasecampGoods', monthlyEst: 11200, channels: ['Etsy Ads', 'Pinterest'], price: 26.5, rating: 4.8 },
        ],
      },
      {
        id: 'cat-dad-shirts',
        product: '"Cat Dad" graphic tees',
        category: 'Apparel / Shirts',
        source: 'Instagram + Etsy search',
        impressions: 2_400_000,
        likes: 201_000,
        growthPct: 27,
        successScore: 68,
        interest: [55, 54, 58, 56, 60, 59, 63, 62, 66, 65, 69, 71],
        note: "Evergreen niche, steady rather than spiking. Father's Day (Jun 21) historically 2.4x baseline.",
        competitors: [
          { name: 'WhiskerWear', monthlyEst: 12800, channels: ['Facebook', 'Etsy Ads'], price: 21.99, rating: 4.7 },
          { name: 'FelineThreads', monthlyEst: 8100, channels: ['Instagram'], price: 18.5, rating: 4.5 },
        ],
      },
    ],
  },

  etsy: {
    productTypes: ['Candles', 'Magnets', 'Shirts', 'Hats'],
    designs: {
      Candles: [
        { id: 'c1', title: 'Sunset Gradient Soy', palette: ['#ff9a56', '#ff6b95'], emoji: '🕯️', status: 'Listed', printify: 'Synced', price: 24.99, sales30d: 47 },
        { id: 'c2', title: 'Lavender Dream', palette: ['#b39ddb', '#7e57c2'], emoji: '🪻', status: 'Listed', printify: 'Synced', price: 22.99, sales30d: 31 },
        { id: 'c3', title: 'Dopamine Swirl', palette: ['#ffd54f', '#4dd0e1'], emoji: '🌈', status: 'Review', printify: 'Draft', price: 26.99, sales30d: 0 },
        { id: 'c4', title: 'Midnight Forest', palette: ['#2e7d32', '#1b5e20'], emoji: '🌲', status: 'Generating', printify: '—', price: null, sales30d: 0 },
      ],
      Magnets: [
        { id: 'm1', title: 'Pixel Sushi Set (x6)', palette: ['#ef5350', '#ffb74d'], emoji: '🍣', status: 'Listed', printify: 'Synced', price: 12.99, sales30d: 88 },
        { id: 'm2', title: 'Retro Gameboy Pack', palette: ['#9ccc65', '#558b2f'], emoji: '🎮', status: 'Listed', printify: 'Synced', price: 11.99, sales30d: 64 },
        { id: 'm3', title: 'Cottagecore Mushrooms', palette: ['#d7ccc8', '#8d6e63'], emoji: '🍄', status: 'Review', printify: 'Draft', price: 13.99, sales30d: 0 },
      ],
      Shirts: [
        { id: 's1', title: 'Cat Dad Club', palette: ['#455a64', '#263238'], emoji: '🐱', status: 'Listed', printify: 'Synced', price: 21.99, sales30d: 53 },
        { id: 's2', title: 'Plant Parent', palette: ['#66bb6a', '#33691e'], emoji: '🪴', status: 'Listed', printify: 'Synced', price: 21.99, sales30d: 29 },
        { id: 's3', title: 'Coffee Then Chaos', palette: ['#8d6e63', '#4e342e'], emoji: '☕', status: 'Review', printify: 'Draft', price: 23.99, sales30d: 0 },
        { id: 's4', title: 'Gorpcore Mountain Line', palette: ['#78909c', '#37474f'], emoji: '⛰️', status: 'Generating', printify: '—', price: null, sales30d: 0 },
      ],
      Hats: [
        { id: 'h1', title: 'Trail Mix Dad Hat', palette: ['#a1887f', '#5d4037'], emoji: '🥾', status: 'Listed', printify: 'Synced', price: 27.99, sales30d: 41 },
        { id: 'h2', title: 'Embroidered Trout Cap', palette: ['#4fc3f7', '#0277bd'], emoji: '🐟', status: 'Review', printify: 'Draft', price: 28.99, sales30d: 0 },
      ],
    },
  },
};

/* ---------- Bridge (swap these bodies to go live) ---------- */

const HermesBridge = {
  connected: false, // true once the Hermes agent server is reachable
  base: '',

  /* Look for the agent: same-origin first (the agent serves this dashboard
     itself), then the default local port (when served by another dev server). */
  async init() {
    const candidates = window.location.protocol === 'file:'
      ? ['http://localhost:8787']
      : ['', 'http://localhost:8787'];
    for (const base of candidates) {
      try {
        const res = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) });
        if (res.ok) { this.base = base; this.connected = true; return; }
      } catch { /* not here — try next */ }
    }
  },

  async api(path, body) {
    const res = await fetch(this.base + '/api' + path, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    return res.json();
  },

  async getBusinesses() { return this.connected ? this.api('/businesses') : MOCK.businesses; },
  async getMonths() { return this.connected ? this.api('/months') : MOCK.months; },
  async getLLMUsage() { return this.connected ? this.api('/llm') : MOCK.llm; },
  async getResearchTrends() {
    if (!this.connected) return MOCK.research.trends.map((t) => ({ ...t, live: false, source: 'Curated sample (agent offline)' }));
    return this.api('/trends');
  },
  async getResearchSources() {
    return this.connected ? this.api('/research/sources') : [
      { id: 'google_trends_rss', name: 'Google Trends RSS', keyless: true, available: false, note: 'Start the agent to go live.' },
      { id: 'serpapi', name: 'SerpApi (Trends + Shopping)', keyless: false, envKey: 'SERPAPI_KEY', available: false },
      { id: 'etsy_api', name: 'Etsy API', keyless: false, envKey: 'ETSY_API_KEY', available: false },
    ];
  },
  async getResearchMeta() {
    return this.connected ? this.api('/research/meta') : { fetchedAt: null, activeSources: [] };
  },
  async refreshTrends() {
    if (!this.connected) throw new Error('Agent offline — start HermesAgent to pull live trends.');
    return this.api('/trends/refresh', {});
  },
  // SerpApi discovery feeds: shopping / event / holiday trends.
  async getSerpFeeds() {
    return this.connected ? this.api('/research/serp') : { shopping: [], events: [], holidays: [], fetchedAt: null };
  },
  async refreshSerpFeeds() {
    if (!this.connected) throw new Error('Agent offline — start HermesAgent to pull SerpApi trends.');
    return this.api('/research/serp/refresh', {});
  },
  async getEtsyProductTypes() { return this.connected ? this.api('/etsy/types') : MOCK.etsy.productTypes; },
  async getEtsyDesigns(t) { return this.connected ? this.api(`/etsy/designs?type=${encodeURIComponent(t)}`) : (MOCK.etsy.designs[t] ?? []); },
  async getFiverrCategories() { return this.connected ? this.api('/fiverr/categories') : MOCK.fiverr.categories; },
  async getFiverrGigs(c) { return this.connected ? this.api(`/fiverr/gigs?category=${encodeURIComponent(c)}`) : (MOCK.fiverr.gigs[c] ?? []); },
  async getAIModels() { return this.connected ? this.api('/models') : MOCK.aiModels; },

  async setAIModelLinked(id, linked) {
    if (this.connected) return this.api(`/models/${id}/link`, { linked });
    const model = MOCK.aiModels.find((m) => m.id === id);
    if (model) model.linked = linked;
    return model;
  },

  async approveDesign(id) { if (this.connected) return this.api(`/designs/${id}/approve`, {}); },
  async regenerateDesign(id) { if (this.connected) return this.api(`/designs/${id}/regenerate`, {}); },
  async linkBusiness(id) { if (this.connected) return this.api(`/businesses/${id}/link`, {}); },

  // --- Printify (real API) ---
  async getPrintifyStatus() {
    return this.connected ? this.api('/printify/status') : {
      configured: false, live: false, maskedToken: null, shops: [],
      detail: 'Start the agent — token lives in HermesAgent/.env',
    };
  },
  async getPrintifyProducts(shopId, limit = 10) {
    return this.connected ? this.api(`/printify/products?shop=${encodeURIComponent(shopId)}&limit=${limit}`) : { total: 0, products: [] };
  },
  async getPrintifyCatalog() { return this.connected ? this.api('/printify/catalog') : []; },
  async getPrintifyBlueprint(id) { return this.connected ? this.api(`/printify/blueprint?id=${encodeURIComponent(id)}`) : null; },
  async setPrintifyPrice(blueprintId, retail) {
    if (!this.connected) return { blueprintId, retail };
    return this.api('/printify/price', { blueprintId, retail });
  },
  async saveMockup(mockup) { return this.connected ? this.api('/mockups', mockup) : mockup; },

  // --- Design library (Higgsfield imports) + listing ---
  async getDesigns() { return this.connected ? this.api('/designs') : []; },
  async addDesign(design) {
    if (!this.connected) throw new Error('Agent offline — start HermesAgent to save designs.');
    return this.api('/designs', design);
  },
  async deleteDesign(id) { if (this.connected) return this.api('/designs/delete', { id }); },
  async describeListing(payload) {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api('/printify/describe', payload);
  },
  async listToEtsy(payload) {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api('/printify/list', payload);
  },
  async delistProduct(shopId, productId) {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api('/printify/delist', { shopId, productId });
  },

  // --- Dropship suppliers (Zendrop, AliExpress) — one set of methods, keyed by
  //     supplier id. Routes are /api/dropship/:supplier/* ---
  async getSupplierStatus(id) {
    if (this.connected) return this.api(`/dropship/${id}/status`);
    const names = { zendrop: 'Zendrop', aliexpress: 'AliExpress' };
    return {
      id, provider: names[id] ?? id, configured: false, maskedKey: null,
      storedIn: 'Start the agent — key lives in HermesAgent/.env', products: 0, imported: 0, openOrders: 0,
      channels: [
        { id: 'tiktok', name: 'TikTok Shop', icon: '🛍️' },
        { id: 'facebook', name: 'Facebook Marketplace', icon: '📘' },
        { id: 'etsy', name: 'Etsy', icon: '🛒' },
        { id: 'amazon', name: 'Amazon', icon: '📦' },
        { id: 'ebay', name: 'eBay', icon: '🏷️' },
      ],
    };
  },
  // Live-aware catalog payload: { live, source, products }.
  async getSupplierProducts(id) {
    return this.connected ? this.api(`/dropship/${id}/products`) : { live: false, source: 'agent offline', products: [] };
  },
  async getSupplierOrders(id) { return this.connected ? this.api(`/dropship/${id}/orders`) : []; },
  async getSupplierKey(id) {
    if (!this.connected) throw new Error('Agent offline — key is in HermesAgent/.env');
    return (await this.api(`/dropship/${id}/key`)).key;
  },
  async verifySupplier(id) {
    if (!this.connected) return { ok: false, detail: 'Agent offline.' };
    return this.api(`/dropship/${id}/verify`);
  },
  // Reveal a marketplace channel's API key (e.g. TikTok Shop).
  async getChannelKey(channelId) {
    if (!this.connected) throw new Error('Agent offline — key is in HermesAgent/.env');
    return (await this.api(`/channels/${channelId}/key`)).key;
  },

  // --- TikTok Shop OAuth (connect a real shop, then publish live) ---
  async getTiktokConnection() {
    if (!this.connected) return { configured: false, connected: false, authUrl: null };
    return this.api('/channels/tiktok/connection');
  },
  async connectTiktok(authCode) {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api('/channels/tiktok/connect', { authCode });
  },
  async refreshTiktok() {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api('/channels/tiktok/refresh', {});
  },
  async disconnectTiktok() {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api('/channels/tiktok/disconnect', {});
  },
  async publishToTiktok(supplier, productId) {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api('/channels/tiktok/publish', { supplier, productId });
  },
  // List / remove a product across marketplace channels (channel id or 'all').
  async listChannel(id, productId, channel) {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api(`/dropship/${id}/list`, { productId, channel });
  },
  async unlistChannel(id, productId, channel) {
    if (!this.connected) throw new Error('Agent offline.');
    return this.api(`/dropship/${id}/unlist`, { productId, channel });
  },

  /* Talk to the Hermes agent. Offline fallback explains how to start it. */
  async chat(message) {
    if (!this.connected) {
      return {
        reply: 'Hermes agent is not running. Start it with:\n  cd HermesAgent && npm install && npm start\nthen open http://localhost:8787',
        actions: [], simulated: true,
      };
    }
    return this.api('/agent/chat', { message });
  },

  /* The agent roster (Hermes + specialist sub-agents). */
  async getAgents() {
    if (this.connected) return this.api('/agents');
    // Offline: show the roster so the menu is populated, marked offline.
    return [
      { id: 'hermes', name: 'Hermes', icon: '⚡', color: '#fcee0a', blurb: 'Chief orchestrator', online: false },
      { id: 'research', name: 'Research', icon: '🔎', color: '#02d7f2', blurb: 'Product & market research', online: false },
      { id: 'design', name: 'Design', icon: '🎨', color: '#b14aff', blurb: 'Design creation', online: false },
      { id: 'operations', name: 'Operations', icon: '🚀', color: '#00ff9f', blurb: 'Publishing & fulfillment', online: false },
      { id: 'revision', name: 'Revision', icon: '📊', color: '#fcee0a', blurb: 'Performance review', online: false },
      { id: 'accountant', name: 'Accountant', icon: '🧮', color: '#ff7a1a', blurb: 'Profit, costs & expenses', online: false },
      { id: 'codex', name: 'Codex', icon: '🛰️', color: '#10a37f', blurb: 'External agent · VPS + OpenAI Codex', online: false },
    ];
  },
  /* Contact a specific agent by id. */
  async chatWithAgent(id, message) {
    if (!this.connected) {
      return { reply: 'Agent offline — start HermesAgent (and set ANTHROPIC_API_KEY) to chat.', actions: [], simulated: true };
    }
    return this.api(`/agents/${id}/chat`, { message });
  },

  /* Full agent workspace payload: meta + workflow (mission/tools) + chat log +
     learning/evolution insights. Offline → a populated shell so the screen
     still renders (empty log, zeroed insights). */
  async getAgentProfile(id) {
    if (this.connected) return this.api(`/agents/${id}/profile`);
    const meta = (await this.getAgents()).find((a) => a.id === id)
      ?? { id, name: id, icon: '🤖', color: '#02d7f2', blurb: '' };
    return {
      ...meta, backend: 'offline — start HermesAgent', mission: '', tools: [],
      log: { messages: [], createdAt: null },
      insights: { turns: 0, exchanges: 0, actionsTaken: 0, distinctTools: 0, toolUsage: [], topics: [], milestones: [], createdAt: null, lastAt: null },
    };
  },

  /* Reset an agent: clears its working memory AND its persisted chat log. */
  async resetAgent(id) {
    if (!this.connected) return { ok: true };
    return this.api(`/agents/${id}/reset`, {});
  },
};
