#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { defaultDevPolicy, evaluateSpend } from "../policy/evaluate.js";
import { runSpendFlow } from "../flow.js";
import type { SpendIntent, SpendPolicy } from "../types.js";

const MERCHANT_CLASSES = [
  "web-search",
  "web-scrape",
  "llm-inference",
  "compute",
  "other",
] as const;

function jsonResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

export interface CreateServerOptions {
  /** Trusted operator configuration; never sourced from MCP tool arguments. */
  policy?: Partial<SpendPolicy>;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({ name: "agentspend", version: "0.1.0" });
  const trustedPolicy = defaultDevPolicy(options.policy);
  let spentTodayUsd = trustedPolicy.spentTodayUsd;
  let payQueue: Promise<void> = Promise.resolve();
  const currentPolicy = (): SpendPolicy => ({ ...trustedPolicy, spentTodayUsd });
  const serializePay = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = payQueue.then(operation, operation);
    payQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  server.registerTool(
    "agentspend_status",
    {
      title: "AgentSpend status",
      description:
        "Report AgentSpend's mode (simulation only, no custody) and the trusted operator spend policy.",
      inputSchema: {},
    },
    async () => {
      return jsonResult({
        product: "agentspend",
        mode: "simulation",
        custody: false,
        policy: currentPolicy(),
      });
    },
  );

  server.registerTool(
    "agentspend_evaluate",
    {
      title: "Evaluate a spend intent",
      description:
        "Dry-run policy evaluation for a proposed spend: allow, deny, or require-approval. Does not execute payment and does not write a receipt. Call this before agentspend_pay to check whether a spend fits policy.",
      inputSchema: {
        amountUsd: z.number(),
        merchantClass: z.enum(MERCHANT_CLASSES),
        tool: z.string().min(1),
        purpose: z.string().optional(),
        agentId: z.string().optional(),
      },
    },
    async ({ amountUsd, merchantClass, tool, purpose, agentId }) => {
      const intent: SpendIntent = {
        intentId: randomUUID(),
        agentId: agentId ?? "local-agent",
        tool,
        merchantClass,
        amountUsd,
        purpose: purpose ?? "unspecified",
        createdAt: new Date().toISOString(),
      };
      const policy = currentPolicy();
      const decision = evaluateSpend(policy, intent);
      return jsonResult({ intent, policy, decision, enforcement: "preview-only; no receipt written" });
    },
  );

  server.registerTool(
    "agentspend_pay",
    {
      title: "Execute a simulated spend",
      description:
        "Run the full spend flow using trusted operator policy: policy evaluation, approval gate, simulated x402 payment, and return a content-hashed receipt without writing it to disk. Simulation only — no live funds, keys, or networks. Approval-required MCP spends remain blocked in v0.",
      inputSchema: {
        amountUsd: z.number(),
        merchantClass: z.enum(MERCHANT_CLASSES),
        tool: z.string().min(1),
        purpose: z.string().optional(),
        agentId: z.string().optional(),
      },
    },
    async ({ amountUsd, merchantClass, tool, purpose, agentId }) => {
      return serializePay(async () => {
        const result = await runSpendFlow({
          amountUsd,
          merchantClass,
          tool,
          purpose,
          agentId,
          approve: false,
          policy: currentPolicy(),
          persistReceipt: false,
        });
        if (result.ok) spentTodayUsd += amountUsd;
        return jsonResult(result, !result.ok);
      });
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function isMainModule(moduleUrl: string, entrypoint: string | undefined): boolean {
  if (entrypoint === undefined) return false;
  try {
    const canonicalModule = pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href;
    const canonicalEntrypoint = pathToFileURL(realpathSync(path.resolve(entrypoint))).href;
    return canonicalModule === canonicalEntrypoint;
  } catch {
    return false;
  }
}

const isMain = isMainModule(import.meta.url, process.argv[1]);
if (isMain) {
  startMcpServer().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
