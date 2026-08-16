import { mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server.js";

interface Fixture {
  client: Client;
  server: ReturnType<typeof createServer>;
  tempDir: string;
}

const fixtures: Fixture[] = [];

async function connectedClient(
  policy: NonNullable<Parameters<typeof createServer>[0]>["policy"] = {},
): Promise<Fixture> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agentspend-mcp-"));
  const server = createServer({ policy });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const fixture = { client, server, tempDir };
  fixtures.push(fixture);
  return fixture;
}

async function closeFixture(fixture: Fixture): Promise<void> {
  await fixture.client.close();
  await fixture.server.close();
  await rm(fixture.tempDir, { recursive: true, force: true });
  fixtures.splice(fixtures.indexOf(fixture), 1);
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async (fixture) => {
    await fixture.client.close();
    await fixture.server.close();
    await rm(fixture.tempDir, { recursive: true, force: true });
  }));
});

function parseJson(result: Awaited<ReturnType<Client["callTool"]>>): any {
  const [block] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(block.text);
}

const spendArguments = {
  amountUsd: 0.1,
  merchantClass: "web-search",
  tool: "tavily.search",
};

describe("agentspend MCP server", () => {
  it("lists only trusted-input schemas for the three tools", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "agentspend_evaluate",
      "agentspend_pay",
      "agentspend_status",
    ]);

    const pay = tools.find((tool) => tool.name === "agentspend_pay");
    expect(Object.keys(pay?.inputSchema.properties ?? {})).not.toEqual(
      expect.arrayContaining(["approve", "policy", "receiptDir"]),
    );
  });

  it("agentspend_status reports simulation mode and the trusted policy", async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: "agentspend_status", arguments: {} });
    const payload = parseJson(result);
    expect(payload.mode).toBe("simulation");
    expect(payload.custody).toBe(false);
    expect(payload.policy.id).toBe("dev-local-v0");
  });

  it("agentspend_evaluate creates no receipt or receipt directory", async () => {
    const { client, tempDir } = await connectedClient();
    const result = await client.callTool({
      name: "agentspend_evaluate",
      arguments: spendArguments,
    });
    const payload = parseJson(result);
    expect(payload.decision.allowed).toBe(true);
    expect(payload.decision.requiresApproval).toBe(false);
    expect(payload.payment).toBeUndefined();
    expect(await readdir(tempDir)).toEqual([]);
  });

  it.each([
    ["receiptDir", undefined],
    ["policy", { policy: { requireApprovalAboveUsd: 1 } }],
    ["approve", { approve: true }],
  ])("cannot bypass controls with caller-controlled %s", async (name, suppliedExtra) => {
    const { client, tempDir } = await connectedClient();
    const callerReceiptDir = path.join(tempDir, "caller-selected");
    const extra = suppliedExtra ?? { receiptDir: callerReceiptDir };
    const result = await client.callTool({
      name: "agentspend_pay",
      arguments: {
        amountUsd: 0.4,
        merchantClass: "web-search",
        tool: "tavily.search",
        ...extra,
      },
    });
    const payload = parseJson(result);
    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.receipt.payment).toBeNull();
    expect(await readdir(tempDir)).toEqual([]);
    if (name === "receiptDir") {
      await expect(stat(callerReceiptDir)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("blocks approval-required MCP spends under the trusted policy without writing", async () => {
    const { client, tempDir } = await connectedClient();
    const result = await client.callTool({
      name: "agentspend_pay",
      arguments: {
        amountUsd: 0.4,
        merchantClass: "web-search",
        tool: "tavily.search",
      },
    });
    const payload = parseJson(result);
    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.receipt.payment).toBeNull();
    expect(await readdir(tempDir)).toEqual([]);
  });

  it("returns a content-hashed receipt without writing it to disk", async () => {
    const { client, tempDir } = await connectedClient();
    const result = await client.callTool({ name: "agentspend_pay", arguments: spendArguments });
    const payload = parseJson(result);
    expect(result.isError).toBe(false);
    expect(payload.ok).toBe(true);
    expect(payload.receipt.payment.status).toBe("paid");
    expect(payload.receipt.approval.approver).toBe("policy");
    expect(payload.receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await readdir(tempDir)).toEqual([]);
  });

  it("tracks successful spends against the daily cap for status and evaluation", async () => {
    const { client } = await connectedClient({
      dailyCapUsd: 0.15,
      maxPerTxUsd: 0.15,
      requireApprovalAboveUsd: 1,
    });
    const spend = { name: "agentspend_pay", arguments: spendArguments };

    const first = parseJson(await client.callTool(spend));
    const second = parseJson(await client.callTool(spend));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.receipt.decision.code).toBe("deny_daily_cap");

    const status = parseJson(await client.callTool({ name: "agentspend_status", arguments: {} }));
    expect(status.policy.spentTodayUsd).toBeCloseTo(0.1);
    const evaluation = parseJson(await client.callTool({
      name: "agentspend_evaluate",
      arguments: spendArguments,
    }));
    expect(evaluation.policy.spentTodayUsd).toBeCloseTo(0.1);
    expect(evaluation.decision.code).toBe("deny_daily_cap");
  });

  it("initializes current spent usage from the trusted policy", async () => {
    const { client } = await connectedClient({
      dailyCapUsd: 0.15,
      spentTodayUsd: 0.1,
      maxPerTxUsd: 0.15,
      requireApprovalAboveUsd: 1,
    });
    const status = parseJson(await client.callTool({ name: "agentspend_status", arguments: {} }));
    expect(status.policy.spentTodayUsd).toBe(0.1);
    const evaluation = parseJson(await client.callTool({
      name: "agentspend_evaluate",
      arguments: spendArguments,
    }));
    expect(evaluation.decision.code).toBe("deny_daily_cap");
  });

  it("serializes concurrent spends so they cannot race past the daily cap", async () => {
    const { client } = await connectedClient({
      dailyCapUsd: 0.15,
      maxPerTxUsd: 0.15,
      requireApprovalAboveUsd: 1,
    });
    const spend = { name: "agentspend_pay", arguments: spendArguments };

    const results = await Promise.all([
      client.callTool(spend).then(parseJson),
      client.callTool(spend).then(parseJson),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => result.receipt.decision.code === "deny_daily_cap")).toHaveLength(1);
  });

  it("starts through an npm-style symlink with spaces and serves MCP stdio initialize", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "agent spend bin-"));
    const bin = path.join(tempDir, "agentspend mcp");
    await symlink(path.resolve("src/mcp/server.ts"), bin);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), bin],
      cwd: tempDir,
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test-client", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("agentspend_status");
      const payment = parseJson(await client.callTool({
        name: "agentspend_pay",
        arguments: spendArguments,
      }));
      expect(payment.ok).toBe(true);
      expect(await readdir(tempDir)).toEqual([path.basename(bin)]);
    } finally {
      await client.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("closes MCP resources and removes its temporary directory", async () => {
    const fixture = await connectedClient();
    const { tempDir } = fixture;
    await closeFixture(fixture);
    await expect(stat(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
