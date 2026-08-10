# AgentSpend

Local-first **agent spend control plane** from Docent Labs.

AgentSpend governs whether an agent may spend, under what policy, with what approval, and produces an exportable receipt. It does not custody funds and does not replace x402, Circle, Crossmint, Nevermined, Stripe, or bank rails.

## Status

v0 foundation: pure TypeScript policy engine, receipt builder, simulated payment path, CLI, tests.

No live keys. No mainnet. No payment processing.

## Why this exists

Rails already exist. The missing portable layer is:

```text
intent -> policy envelope -> optional approval -> rail adapter -> receipt
```

## Quick start

```bash
cd ~/Code/agentspend
npm install
npm test
npm run cli -- status
npm run cli -- simulate-pay --amount-usd 0.25 --merchant-class web-search --tool tavily.search
```

## Layout

```text
src/policy/     spend policy evaluation
src/receipt/    exportable receipt schema + hashing
src/sim/        simulated x402-like payment
src/cli.ts      developer CLI
tests/          vitest suite
docs/           architecture and security notes
```

## Non-claims

- Not a wallet custodian
- Not a money transmitter
- Not a guaranteed biometric human presence system
- Not production-ready for real funds

## License

MIT
