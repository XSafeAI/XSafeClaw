# Token and Cost Data Sources

This note documents the trusted sources XSafeClaw uses for token and cost accounting.

## OpenClaw

- Official reference: <https://docs.openclaw.ai/reference/token-use>
- Usage fields: OpenClaw session usage exposes token counters including cache dimensions.
- Pricing source: `models.providers.<provider>.models[].cost` (USD per 1M tokens for `input`, `output`, `cacheRead`, `cacheWrite`).

## Hermes

- Official API server reference: <https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server>
- `/v1/chat/completions` usage shape: `prompt_tokens`, `completion_tokens`, `total_tokens`.
- `/v1/responses` usage shape: `input_tokens`, `output_tokens`, `total_tokens`.

## Nanobot

- Public project and issues indicate usage coverage is still evolving:
  - <https://github.com/HKUDS/nanobot/issues/1193>
  - <https://github.com/HKUDS/nanobot/issues/2020>
- XSafeClaw must treat missing usage as unknown and explicitly mark any fallback estimate.

## XSafeClaw policy

1. Prefer provider/runtime reported usage over inferred values.
2. Normalize cross-runtime usage keys into a single internal schema.
3. If usage is estimated, mark it as estimated in message metadata.
4. Cost is calculated only from known model pricing entries; unknown pricing is reported as unknown.
