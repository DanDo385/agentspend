#!/usr/bin/env node
import { defaultDevPolicy } from "./policy/evaluate.js";
import { runSpendFlow } from "./flow.js";
import type { MerchantClass } from "./types.js";

function printHelp(): void {
  console.log(`AgentSpend CLI (simulation only)

Usage:
  agentspend status
  agentspend simulate-pay --amount-usd <n> --merchant-class <class> --tool <name> [--approve] [--purpose text]

Merchant classes:
  web-search | web-scrape | llm-inference | compute | other

Notes:
  - No live funds, keys, or networks.
  - Receipts append to ./receipts/agentspend.jsonl
`);
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "status") {
    const policy = defaultDevPolicy();
    console.log(
      JSON.stringify(
        {
          product: "agentspend",
          mode: "simulation",
          custody: false,
          policy,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "simulate-pay") {
    const amountRaw = getFlag(args, "--amount-usd");
    const merchantClass = getFlag(args, "--merchant-class") as MerchantClass | undefined;
    const tool = getFlag(args, "--tool");
    const purpose = getFlag(args, "--purpose");
    const approve = hasFlag(args, "--approve");

    if (!amountRaw || !merchantClass || !tool) {
      console.error("simulate-pay requires --amount-usd, --merchant-class, and --tool");
      process.exitCode = 2;
      return;
    }

    const amountUsd = Number(amountRaw);
    const result = await runSpendFlow({
      amountUsd,
      merchantClass,
      tool,
      purpose,
      approve,
    });

    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
