// OpenAI / Codex backend — the same Hermes tool-use loop as agent.js, but the
// brain is an OpenAI model (e.g. a Codex/gpt-5 model) via OpenAI's function
// calling. Same interface as createAgent ({chat, reset, online, status}), so
// the roster can use either backend transparently (see agents.js).
//
// Enable by setting AGENT_BACKEND=openai and OPENAI_API_KEY (+ optional
// OPENAI_MODEL). This is what runs when Hermes Command is deployed on the VPS
// with Codex as the brain.

import OpenAI from "openai";
import { buildToolset, connectorStatus } from "./connectors.js";
import { SYSTEM_PROMPT } from "./agent.js";

const MODEL = process.env.OPENAI_MODEL || "gpt-5";
const MAX_TOOL_ROUNDS = 10;

export function createOpenAIAgent({ systemPrompt = SYSTEM_PROMPT, toolNames = null, extraTools = [] } = {}) {
  const all = buildToolset();
  const selected = toolNames ? all.filter((t) => toolNames.includes(t.name)) : all;
  const tools = [...selected, ...extraTools];
  const byName = new Map(tools.map((t) => [t.name, t]));

  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const client = hasKey ? new OpenAI() : null;

  // OpenAI function-tool schemas (Anthropic input_schema → OpenAI parameters).
  const toolParams = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  let history = []; // OpenAI messages, excluding the system prompt

  async function chat(userMessage) {
    if (!client) {
      return {
        reply: "OpenAI/Codex brain has no key yet: set OPENAI_API_KEY (and AGENT_BACKEND=openai) and restart.",
        actions: [], simulated: true,
      };
    }

    const actions = [];
    history.push({ role: "user", content: String(userMessage) });

    let finalText = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...history],
        tools: toolParams,
      });
      const msg = resp.choices?.[0]?.message;
      if (!msg) break;
      history.push(msg);

      const calls = msg.tool_calls ?? [];
      if (!calls.length) { finalText = msg.content ?? ""; break; }

      for (const call of calls) {
        const tool = byName.get(call.function?.name);
        let result, isError = false;
        try {
          const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
          if (!tool) throw new Error(`unknown tool ${call.function?.name}`);
          result = String(await tool.handler(args));
        } catch (err) {
          result = `Error: ${err.message}`;
          isError = true;
        }
        actions.push({ tool: call.function?.name, input: call.function?.arguments, ok: !isError });
        history.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    return { reply: finalText.trim() || "(Codex finished without a text reply — check the activity log.)", actions, simulated: false };
  }

  return {
    chat,
    reset() { history = []; },
    get online() { return hasKey; },
    status() {
      return { model: MODEL, backend: "openai", openaiKey: hasKey, tools: tools.map((t) => t.name), connectors: connectorStatus() };
    },
  };
}
