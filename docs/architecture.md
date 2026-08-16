# AgentSpend architecture

## Layers

1. **Policy** — pure evaluation of spend intent against local caps and allowlists.
2. **Approval** — explicit human/operator grant when threshold exceeded.
3. **Rail adapter** — v0 is `x402-sim` only. Real x402/Base comes later behind the same interface.
4. **Receipt** — exportable JSON object with content hash binding the whole path.
5. **CLI / MCP** — untrusted agent entrypoints that must call the flow, not bypass it.

## Default dev policy

| Field | Default |
|---|---|
| maxPerTxUsd | 0.50 |
| dailyCapUsd | 5.00 |
| requireApprovalAboveUsd | 0.25 |
| allowedMerchantClasses | web-search, web-scrape, llm-inference, compute |
| allowedTools | * |

## MCP server

`src/mcp/server.ts` exposes the flow over stdio (`agentspend mcp`, or the
`agentspend-mcp` bin) using the official MCP SDK, so any MCP-speaking agent —
including non-TypeScript hosts like a Python hermes-agent plugin — can drive
AgentSpend without linking against this codebase.

- `agentspend_status` — effective policy + mode (simulation, no custody).
- `agentspend_evaluate` — dry-run policy decision for a proposed spend; no
  payment, no receipt written.
- `agentspend_pay` — full flow (evaluate, approval gate, simulated x402
  payment) and returns a content-hashed receipt in the MCP result. MCP never
  persists receipts or accepts receipt-path configuration; callers also cannot
  self-approve or override trusted policy. Successful pays update server-owned
  daily spend state, and pay operations are serialized so concurrent requests
  cannot race past the cap. Status and evaluation use that current state.
  Simulation continues until a real rail adapter lands behind the same interface.

Receipt persistence remains a CLI/internal-flow behavior. The MCP boundary
deliberately avoids filesystem writes rather than claiming path confinement.

## Security posture

See vault `projects/docent-labs/agentspend/threat-model-v0.md`.
