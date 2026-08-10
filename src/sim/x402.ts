import { randomUUID } from "node:crypto";
import type { MerchantClass, SimulatedPayment } from "../types.js";

export function simulateX402Payment(input: {
  amountUsd: number;
  merchantClass: MerchantClass;
  tool: string;
  shouldFail?: boolean;
}): SimulatedPayment {
  const settledAt = new Date().toISOString();
  if (input.shouldFail) {
    return {
      paymentId: randomUUID(),
      rail: "x402-sim",
      status: "failed",
      amountUsd: input.amountUsd,
      merchantClass: input.merchantClass,
      tool: input.tool,
      network: "sim",
      settledAt,
      reference: `sim-fail-${settledAt}`,
    };
  }

  return {
    paymentId: randomUUID(),
    rail: "x402-sim",
    status: "paid",
    amountUsd: input.amountUsd,
    merchantClass: input.merchantClass,
    tool: input.tool,
    network: "sim",
    settledAt,
    reference: `sim-x402-${input.tool}-${settledAt}`,
  };
}
