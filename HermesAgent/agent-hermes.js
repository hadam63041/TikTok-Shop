// WebSocket bridge to the third-party Nous "Hermes" agent platform (the one on
// your VPS, linked to OpenAI via OAuth). Lets our dashboard's agents borrow that
// OAuth-backed brain — no OpenAI key here. Same interface as createAgent
// ({chat, reset, online, status}).
//
// Protocol (reverse-engineered + verified against the live server):
//   1. POST /auth/password-login {provider:"basic",username,password}  → session cookie
//   2. POST /api/auth/ws-ticket (cookie)                               → {ticket} (30s TTL)
//   3. WS  wss://host/api/ws?ticket=…  (JSON-RPC 2.0)
//   4. request "session.create" {close_on_disconnect:true}            → {session_id}
//   5. request "prompt.submit"  {session_id, prompt}                  → {status:"streaming"}
//   6. server emits {method:"event", params:{type:…}}; the final reply
//      arrives as type "message.complete" with params.payload.text

const REPLY_TIMEOUT = 180000; // agent turns can be slow (reasoning + tool use)
const RPC_TIMEOUT = 20000;

export function createHermesAgent({ systemPrompt = null } = {}) {
  const env = () => ({
    url: (process.env.HERMES_URL || "").replace(/\/+$/, ""),
    user: process.env.HERMES_USERNAME,
    pass: process.env.HERMES_PASSWORD,
  });

  let cookie = null, ws = null, sessionId = null, connecting = null, primed = false;
  let reqId = 0;
  const rpcPending = new Map();   // id → {resolve, reject, timer}
  let turn = null;                // {resolve, reject, timer} for the in-flight prompt

  async function login() {
    const { url, user, pass } = env();
    const res = await fetch(`${url}/auth/password-login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "basic", username: user, password: pass, next: "/" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`login HTTP ${res.status}`);
    cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie) throw new Error("login returned no session cookie");
  }

  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = `hb${++reqId}`;
      const timer = setTimeout(() => { if (rpcPending.delete(id)) reject(new Error(`RPC ${method} timed out`)); }, RPC_TIMEOUT);
      rpcPending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  function onMessage(ev) {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && rpcPending.has(msg.id)) {
      const p = rpcPending.get(msg.id); rpcPending.delete(msg.id); clearTimeout(p.timer);
      return msg.error ? p.reject(new Error(msg.error.message || "RPC error")) : p.resolve(msg.result);
    }
    if (msg.method === "event" && turn) {
      const ty = msg.params?.type;
      if (ty === "message.complete") {
        clearTimeout(turn.timer);
        turn.resolve(msg.params?.payload?.text ?? "(empty reply)");
        turn = null;
      } else if (ty === "error" || ty === "session_expired") {
        clearTimeout(turn.timer);
        turn.reject(new Error(msg.params?.payload?.message || ty));
        turn = null;
      }
    }
  }

  async function connect() {
    const { url } = env();
    if (!cookie) await login();
    let tk = await fetch(`${url}/api/auth/ws-ticket`, { method: "POST", headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
    if (tk.status === 401) { cookie = null; await login(); tk = await fetch(`${url}/api/auth/ws-ticket`, { method: "POST", headers: { Cookie: cookie } }); }
    if (!tk.ok) throw new Error(`ws-ticket HTTP ${tk.status}`);
    const { ticket } = await tk.json();

    const socket = new WebSocket(`${url.replace(/^http/, "ws")}/api/ws?ticket=${encodeURIComponent(ticket)}`);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("WS connect failed")), { once: true });
      setTimeout(() => reject(new Error("WS open timeout")), 15000);
    });
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", () => {
      ws = null; sessionId = null; primed = false;
      for (const [, p] of rpcPending) { clearTimeout(p.timer); p.reject(new Error("WS closed")); }
      rpcPending.clear();
      if (turn) { clearTimeout(turn.timer); turn.reject(new Error("WS closed")); turn = null; }
    });
    ws = socket;
    const created = await rpc("session.create", { close_on_disconnect: true });
    sessionId = created.session_id;
  }

  async function ensure() {
    if (ws && sessionId) return;
    if (!connecting) connecting = connect().finally(() => { connecting = null; });
    await connecting;
  }

  async function chat(message) {
    const { url, user, pass } = env();
    if (!url || !user || !pass) {
      return { reply: "VPS Hermes brain not linked: set HERMES_URL, HERMES_USERNAME and HERMES_PASSWORD, then restart.", actions: [], simulated: true };
    }
    try {
      await ensure();
      let prompt = String(message);
      if (systemPrompt && !primed) { prompt = `${systemPrompt}\n\n----\n${prompt}`; primed = true; }
      const reply = await new Promise((resolve, reject) => {
        turn = { resolve, reject, timer: setTimeout(() => { turn = null; reject(new Error("reply timed out")); }, REPLY_TIMEOUT) };
        rpc("prompt.submit", { session_id: sessionId, prompt }).catch((err) => {
          if (turn) { clearTimeout(turn.timer); turn = null; }
          reject(err);
        });
      });
      return { reply, actions: [], simulated: false };
    } catch (err) {
      try { ws?.close(); } catch { /* ignore */ }
      ws = null; sessionId = null;
      return { reply: `Hermes bridge error: ${err.message}`, actions: [], simulated: false };
    }
  }

  return {
    chat,
    reset() { try { ws?.close(); } catch { /* ignore */ } ws = null; sessionId = null; primed = false; },
    get online() { const { url, user, pass } = env(); return Boolean(url && user && pass); },
    status() { const { url } = env(); return { backend: "hermes-vps", url: url || null, model: "remote OAuth brain", linked: this.online }; },
  };
}
