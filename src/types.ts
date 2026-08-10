export type MerchantClass =
  | "web-search"
  | "web-scrape"
  | "llm-inference"
  | "compute"
  | "other";

export type DecisionCode =
  | "allow"
  | "deny_amount"
  | "deny_daily_cap"
  | "deny_merchant_class"
  | "deny_expired"
  | "deny_tool"
  | "require_approval";

export interface SpendPolicy {
  id: string;
  version: string;
  currency: "USD";
  maxPerTxUsd: number;
  dailyCapUsd: number;
  spentTodayUsd: number;
  expiresAt: string; // ISO
  allowedMerchantClasses: MerchantClass[];
  allowedTools: string[] | "*";
  requireApprovalAboveUsd: number;
}

export interface SpendIntent {
  intentId: string;
  agentId: string;
  tool: string;
  merchantClass: MerchantClass;
  amountUsd: number;
  purpose: string;
  createdAt: string;
}

export interface PolicyDecision {
  decisionId: string;
  code: DecisionCode;
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
  policyId: string;
  policyVersion: string;
  intentId: string;
  evaluatedAt: string;
  remainingDailyUsd: number;
}

export interface ApprovalRecord {
  approvalId: string;
  decisionId: string;
  approved: boolean;
  approver: string;
  method: "cli-confirm" | "simulated-passkey" | "policy-auto";
  approvedAt: string;
  note?: string;
}

export interface SimulatedPayment {
  paymentId: string;
  rail: "x402-sim";
  status: "paid" | "failed" | "skipped";
  amountUsd: number;
  merchantClass: MerchantClass;
  tool: string;
  network: "sim";
  settledAt: string;
  reference: string;
}

export interface SpendReceipt {
  receiptVersion: "agentspend-receipt-v1";
  receiptId: string;
  createdAt: string;
  intent: SpendIntent;
  policy: Pick<SpendPolicy, "id" | "version" | "maxPerTxUsd" | "dailyCapUsd" | "requireApprovalAboveUsd">;
  decision: PolicyDecision;
  approval: ApprovalRecord | null;
  payment: SimulatedPayment | null;
  toolResultHash: string | null;
  contentHash: string;
}
