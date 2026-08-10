import { createHash, randomUUID } from "node:crypto";
import type {
  ApprovalRecord,
  PolicyDecision,
  SimulatedPayment,
  SpendIntent,
  SpendPolicy,
  SpendReceipt,
} from "../types.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function buildReceipt(input: {
  intent: SpendIntent;
  policy: SpendPolicy;
  decision: PolicyDecision;
  approval: ApprovalRecord | null;
  payment: SimulatedPayment | null;
  toolResultHash: string | null;
  createdAt?: string;
}): SpendReceipt {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const draft: Omit<SpendReceipt, "contentHash" | "receiptId"> & {
    receiptId: string;
  } = {
    receiptVersion: "agentspend-receipt-v1",
    receiptId: randomUUID(),
    createdAt,
    intent: input.intent,
    policy: {
      id: input.policy.id,
      version: input.policy.version,
      maxPerTxUsd: input.policy.maxPerTxUsd,
      dailyCapUsd: input.policy.dailyCapUsd,
      requireApprovalAboveUsd: input.policy.requireApprovalAboveUsd,
    },
    decision: input.decision,
    approval: input.approval,
    payment: input.payment,
    toolResultHash: input.toolResultHash,
  };

  const contentHash = createHash("sha256")
    .update(stableStringify(draft))
    .digest("hex");

  return {
    ...draft,
    contentHash,
  };
}

export function assertReceiptIntegrity(receipt: SpendReceipt): boolean {
  const { contentHash, ...rest } = receipt;
  const expected = createHash("sha256")
    .update(stableStringify(rest))
    .digest("hex");
  return expected === contentHash;
}
