// Hermes agent core — a Claude-driven tool-use loop over the connector
// registry. Manual loop (not the SDK tool runner) so every action is logged
// to the activity feed and risky tools can be gated later.

import Anthropic from "@anthropic-ai/sdk";
import { buildToolset, connectorStatus } from "./connectors.js";

const MODEL = "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 10;

// Stable system prompt — no timestamps or per-request data, so the
// cache_control breakpoint below actually gets cache hits.
const SYSTEM_PROMPT = `You are Hermes, the operations agent for the user's online business portfolio, controlled through the "Hermes Command" dashboard.

The portfolio:
- Cozy Glow, MagnetMania, ThreadCraft — Etsy shops selling AI-generated white-label products (candles, magnets, shirts, hats) fulfilled via Printify.
- PetGear Plus — Shopify dropshipping store.
- PixelForge — Fiverr business selling AI-generated YouTube thumbnails and video ads (Midjourney / Stable Diffusion for images, Higgsfield AI / Runway for video).

Your job: monitor performance, research market trends, generate and publish product designs, manage gig deliverables, and tune ad budgets — using the tools provided.

Rules:
- Ground every claim in tool results. Call get_dashboard_snapshot before answering performance questions.
- Before any action that spends money (ad budget increases) or is customer-visible (publishing listings, delivering gigs), state what you intend to do and ask for confirmation — unless the user's message already explicitly requested exactly that action.
- Generation models must be linked before use; if one isn't, say so and offer to link it.
- Replies render in a small dashboard console: be concise, lead with the outcome, use short lines. No markdown tables.
- You may chain multiple tools per request. Report what you did as a short action list.`;

export function createAgent() {
  const tools = buildToolset();
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const client = hasKey ? new Anthropic() : null;
  let history = [];

  // Tool schemas sent to the API (handler stripped), in stable order for caching.
  const toolSchemas = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

  async function chat(userMessage) {
    if (!client) {
      return {
        reply: "Hermes is running but has no brain yet: set ANTHROPIC_API_KEY in HermesAgent/.env and restart. " +
          "Until then the REST API serves data, but chat/automation is offline.",
        actions: [],
        simulated: true,
      };
    }

    const actions = [];
    history.push({ role: "user", content: userMessage });

    let response;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: toolSchemas,
        messages: history,
      });

      history.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason !== "tool_use") break;

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const tool = tools.find((t) => t.name === block.name);
        let result;
        let isError = false;
        try {
          result = String(await tool.handler(block.input));
        } catch (err) {
          result = `Error: ${err.message}`;
          isError = true;
        }
        actions.push({ tool: block.name, input: block.input, ok: !isError });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
          is_error: isError,
        });
      }
      history.push({ role: "user", content: toolResults });
    }

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim() || "(Hermes finished without a text reply — check the activity log.)";

    return { reply, actions, simulated: false };
  }

  return {
    chat,
    reset() { history = []; },
    get online() { return hasKey; },
    status() {
      return { model: MODEL, anthropicKey: hasKey, tools: toolSchemas.map((t) => t.name), connectors: connectorStatus() };
    },
  };
}
