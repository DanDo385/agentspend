# AgentSpend architecture

## Layers

1. **Policy** — pure evaluation of spend intent against local caps and allowlists.
2. **Approval** — explicit human/operator grant when threshold exceeded.
3. **Rail adapter** — v0 is `x402-sim` only. Real x402/Base comes later behind the same interface.
4. **Receipt** — exportable JSON object with content hash binding the whole path.
5. **CLI / future MCP** — untrusted agent entrypoints that must call the flow, not bypass it.

## Default dev policy

| Field | Default |
|---|---|
| maxPerTxUsd | 0.50 |
| dailyCapUsd | 5.00 |
| requireApprovalAboveUsd | 0.25 |
| allowedMerchantClasses | web-search, web-scrape, llm-inference, compute |
| allowedTools | * |

## Future MCP tools (not implemented)

- `agentspend_status`
- `agentspend_evaluate`
- `agentspend_pay` (simulation until rail adapter is real and gated)

## Security posture

See vault `projects/docent-labs/agentspend/threat-model-v0.md`.
