// MCP server — exposes Hermes Command's business tools (Printify, SerpApi,
// design, listing, Zendrop, ad budgets, etc.) over the Model Context Protocol so
// the third-party Hermes platform (with its OAuth-backed OpenAI/Codex brain) can
// operate the businesses directly. Minimal, dependency-free JSON-RPC 2.0 over
// HTTP (Streamable-HTTP compatible, single JSON responses), served at POST /mcp.
//
// Tool handlers are the same connector handlers our own agents use (wrapped with
// activity logging via buildToolset), so MCP calls show up in the activity feed.

import { buildToolset } from "./connectors.js";

const SERVER_INFO = { name: "hermes-command", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2024-11-05";

let _tools;
const toolset = () => (_tools ??= buildToolset());

/**
 * Handle one JSON-RPC message. Returns the JSON-RPC response object, or null for
 * notifications (which get no response).
 */
export async function handleMcpRpc(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined;
  const ok = (result) => (isNotification ? null : { jsonrpc: "2.0", id, result });
  const err = (code, message) => (isNotification ? null : { jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications — no response

    case "ping":
      return ok({});

    case "tools/list":
      return ok({
        tools: toolset().map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
      });

    case "tools/call": {
      const tool = toolset().find((t) => t.name === params.name);
      if (!tool) return err(-32602, `Unknown tool: ${params.name}`);
      try {
        const text = String(await tool.handler(params.arguments || {}));
        return ok({ content: [{ type: "text", text }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }

    default:
      return err(-32601, `Method not found: ${method}`);
  }
}
