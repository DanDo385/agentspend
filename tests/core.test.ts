import { describe, expect, it } from "vitest";
import { defaultDevPolicy, evaluateSpend } from "../src/policy/evaluate.js";
import { assertReceiptIntegrity, buildReceipt } from "../src/receipt/build.js";
import { runSpendFlow } from "../src/flow.js";
import { randomUUID } from "node:crypto";

describe("policy engine", () => {
  it("auto-allows small in-policy spend", () => {
    const policy = defaultDevPolicy({ requireApprovalAboveUsd: 0.25 });
    const decision = evaluateSpend(policy, {
      intentId: randomUUID(),
      agentId: "a",
      tool: "tavily.search",
      merchantClass: "web-search",
      amountUsd: 0.1,
      purpose: "test",
      createdAt: new Date().toISOString(),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.code).toBe("allow");
  });

  it("requires approval above threshold", () => {
    const policy = defaultDevPolicy({ requireApprovalAboveUsd: 0.25, maxPerTxUsd: 1 });
    const decision = evaluateSpend(policy, {
      intentId: randomUUID(),
      agentId: "a",
      tool: "tavily.search",
      merchantClass: "web-search",
      amountUsd: 0.4,
      purpose: "test",
      createdAt: new Date().toISOString(),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.code).toBe("require_approval");
  });

  it("denies over max per tx", () => {
    const policy = defaultDevPolicy({ maxPerTxUsd: 0.5 });
    const decision = evaluateSpend(policy, {
      intentId: randomUUID(),
      agentId: "a",
      tool: "tavily.search",
      merchantClass: "web-search",
      amountUsd: 0.75,
      purpose: "test",
      createdAt: new Date().toISOString(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("deny_amount");
  });

  it("denies disallowed merchant class", () => {
    const policy = defaultDevPolicy({ allowedMerchantClasses: ["web-search"] });
    const decision = evaluateSpend(policy, {
      intentId: randomUUID(),
      agentId: "a",
      tool: "gpu.rent",
      merchantClass: "compute",
      amountUsd: 0.1,
      purpose: "test",
      createdAt: new Date().toISOString(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("deny_merchant_class");
  });

  it("denies when daily cap exhausted", () => {
    const policy = defaultDevPolicy({ dailyCapUsd: 1, spentTodayUsd: 0.9 });
    const decision = evaluateSpend(policy, {
      intentId: randomUUID(),
      agentId: "a",
      tool: "tavily.search",
      merchantClass: "web-search",
      amountUsd: 0.2,
      purpose: "test",
      createdAt: new Date().toISOString(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("deny_daily_cap");
  });
});

describe("receipts", () => {
  it("hashes deterministically for integrity check", () => {
    const policy = defaultDevPolicy();
    const intent = {
      intentId: "intent-1",
      agentId: "a",
      tool: "tavily.search",
      merchantClass: "web-search" as const,
      amountUsd: 0.1,
      purpose: "test",
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    const decision = evaluateSpend(policy, intent, "2026-08-09T00:00:01.000Z");
    const receipt = buildReceipt({
      intent,
      policy,
      decision,
      approval: null,
      payment: null,
      toolResultHash: null,
      createdAt: "2026-08-09T00:00:02.000Z",
    });
    expect(assertReceiptIntegrity(receipt)).toBe(true);
    expect(assertReceiptIntegrity({ ...receipt, contentHash: "deadbeef" })).toBe(false);
  });
});

describe("flow", () => {
  it("blocks approval-required spend without --approve", async () => {
    const result = await runSpendFlow({
      amountUsd: 0.4,
      merchantClass: "web-search",
      tool: "tavily.search",
      approve: false,
      receiptDir: "/tmp/agentspend-test-receipts-1",
    });
    expect(result.ok).toBe(false);
    expect(result.receipt.payment).toBeNull();
  });

  it("pays after approval when required", async () => {
    const result = await runSpendFlow({
      amountUsd: 0.4,
      merchantClass: "web-search",
      tool: "tavily.search",
      approve: true,
      receiptDir: "/tmp/agentspend-test-receipts-2",
    });
    expect(result.ok).toBe(true);
    expect(result.receipt.payment?.status).toBe("paid");
    expect(result.receipt.approval?.approved).toBe(true);
    expect(assertReceiptIntegrity(result.receipt)).toBe(true);
  });
});
