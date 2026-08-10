import { createHash, randomUUID } from "node:crypto";
import type {
  PolicyDecision,
  SpendIntent,
  SpendPolicy,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultDevPolicy(overrides: Partial<SpendPolicy> = {}): SpendPolicy {
  return {
    id: "dev-local-v0",
    version: "0.1.0",
    currency: "USD",
    maxPerTxUsd: 0.5,
    dailyCapUsd: 5,
    spentTodayUsd: 0,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    allowedMerchantClasses: ["web-search", "web-scrape", "llm-inference", "compute"],
    allowedTools: "*",
    requireApprovalAboveUsd: 0.25,
    ...overrides,
  };
}

export function evaluateSpend(
  policy: SpendPolicy,
  intent: SpendIntent,
  evaluatedAt: string = nowIso(),
): PolicyDecision {
  const reasons: string[] = [];
  let code: PolicyDecision["code"] = "allow";
  let allowed = true;
  let requiresApproval = false;

  if (!(intent.amountUsd > 0) || !Number.isFinite(intent.amountUsd)) {
    allowed = false;
    code = "deny_amount";
    reasons.push("amountUsd must be a finite number greater than zero");
  }

  if (allowed && new Date(evaluatedAt).getTime() > new Date(policy.expiresAt).getTime()) {
    allowed = false;
    code = "deny_expired";
    reasons.push(`policy expired at ${policy.expiresAt}`);
  }

  if (allowed && !policy.allowedMerchantClasses.includes(intent.merchantClass)) {
    allowed = false;
    code = "deny_merchant_class";
    reasons.push(`merchant class ${intent.merchantClass} is not allowed`);
  }

  if (
    allowed &&
    policy.allowedTools !== "*" &&
    !policy.allowedTools.includes(intent.tool)
  ) {
    allowed = false;
    code = "deny_tool";
    reasons.push(`tool ${intent.tool} is not allowlisted`);
  }

  if (allowed && intent.amountUsd > policy.maxPerTxUsd) {
    allowed = false;
    code = "deny_amount";
    reasons.push(
      `amount ${intent.amountUsd} exceeds maxPerTxUsd ${policy.maxPerTxUsd}`,
    );
  }

  const remainingDailyUsd = Math.max(policy.dailyCapUsd - policy.spentTodayUsd, 0);
  if (allowed && intent.amountUsd > remainingDailyUsd) {
    allowed = false;
    code = "deny_daily_cap";
    reasons.push(
      `amount ${intent.amountUsd} exceeds remaining daily cap ${remainingDailyUsd}`,
    );
  }

  if (allowed && intent.amountUsd > policy.requireApprovalAboveUsd) {
    requiresApproval = true;
    code = "require_approval";
    reasons.push(
      `amount ${intent.amountUsd} is above approval threshold ${policy.requireApprovalAboveUsd}`,
    );
  }

  if (allowed && !requiresApproval) {
    reasons.push("within policy limits; auto-allow");
  }

  return {
    decisionId: randomUUID(),
    code,
    allowed,
    requiresApproval,
    reasons,
    policyId: policy.id,
    policyVersion: policy.version,
    intentId: intent.intentId,
    evaluatedAt,
    remainingDailyUsd,
  };
}

export function hashCanonical(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value as object).sort());
  return createHash("sha256").update(json).digest("hex");
}
