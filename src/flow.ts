import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { evaluateSpend, defaultDevPolicy } from "./policy/evaluate.js";
import { buildReceipt } from "./receipt/build.js";
import { simulateX402Payment } from "./sim/x402.js";
import type {
  ApprovalRecord,
  MerchantClass,
  SpendIntent,
  SpendPolicy,
  SpendReceipt,
} from "./types.js";

export interface RunSpendInput {
  amountUsd: number;
  merchantClass: MerchantClass;
  tool: string;
  purpose?: string;
  agentId?: string;
  policy?: Partial<SpendPolicy>;
  approve?: boolean;
  toolResult?: unknown;
  receiptDir?: string;
}

export interface RunSpendResult {
  ok: boolean;
  receipt: SpendReceipt;
  message: string;
}

export async function runSpendFlow(input: RunSpendInput): Promise<RunSpendResult> {
  const policy = defaultDevPolicy(input.policy);
  const intent: SpendIntent = {
    intentId: randomUUID(),
    agentId: input.agentId ?? "local-agent",
    tool: input.tool,
    merchantClass: input.merchantClass,
    amountUsd: input.amountUsd,
    purpose: input.purpose ?? "unspecified",
    createdAt: new Date().toISOString(),
  };

  const decision = evaluateSpend(policy, intent);
  let approval: ApprovalRecord | null = null;
  let payment = null;
  let message = decision.reasons.join("; ");

  if (!decision.allowed) {
    const receipt = buildReceipt({
      intent,
      policy,
      decision,
      approval: null,
      payment: null,
      toolResultHash: null,
    });
    await maybePersist(receipt, input.receiptDir);
    return { ok: false, receipt, message };
  }

  if (decision.requiresApproval) {
    if (!input.approve) {
      const blocked = {
        ...decision,
        allowed: false,
        code: "require_approval" as const,
        reasons: [
          ...decision.reasons,
          "approval required but not granted",
        ],
      };
      const receipt = buildReceipt({
        intent,
        policy,
        decision: blocked,
        approval: null,
        payment: null,
        toolResultHash: null,
      });
      await maybePersist(receipt, input.receiptDir);
      return {
        ok: false,
        receipt,
        message: blocked.reasons.join("; "),
      };
    }

    approval = {
      approvalId: randomUUID(),
      decisionId: decision.decisionId,
      approved: true,
      approver: "local-operator",
      method: "cli-confirm",
      approvedAt: new Date().toISOString(),
      note: "explicit approve flag in v0 CLI",
    };
  } else {
    approval = {
      approvalId: randomUUID(),
      decisionId: decision.decisionId,
      approved: true,
      approver: "policy",
      method: "policy-auto",
      approvedAt: new Date().toISOString(),
    };
  }

  payment = simulateX402Payment({
    amountUsd: intent.amountUsd,
    merchantClass: intent.merchantClass,
    tool: intent.tool,
  });

  const toolResultHash = input.toolResult
    ? createHash("sha256").update(JSON.stringify(input.toolResult)).digest("hex")
    : createHash("sha256").update(`simulated-result:${intent.tool}`).digest("hex");

  const receipt = buildReceipt({
    intent,
    policy,
    decision,
    approval,
    payment,
    toolResultHash,
  });
  await maybePersist(receipt, input.receiptDir);
  message = `paid via ${payment.rail}; receipt ${receipt.receiptId}`;
  return { ok: true, receipt, message };
}

async function maybePersist(receipt: SpendReceipt, receiptDir?: string): Promise<void> {
  const dir = receiptDir ?? path.join(process.cwd(), "receipts");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "agentspend.jsonl");
  await appendFile(file, `${JSON.stringify(receipt)}\n`, "utf8");
}
