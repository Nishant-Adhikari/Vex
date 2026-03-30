# Jupiter Token Content in `src/tools`

Local source-of-truth for Jupiter Token Content API under `src/tools/solana-ecosystem/jupiter/jupiter-tokens/content`.

## Verified From
- `https://dev.jup.ag/docs/llms.txt`
- `https://dev.jup.ag/docs/tokens/content.md`
- `https://dev.jup.ag/docs/api-reference/tokens/get-content`
- `https://dev.jup.ag/docs/api-reference/tokens/get-content-cooking`
- `https://dev.jup.ag/docs/api-reference/tokens/get-content-feed`
- Verified on `2026-03-30`

## Covered Endpoints
- `GET /tokens/v2/content`
- `GET /tokens/v2/content/cooking`
- `GET /tokens/v2/content/feed`
- `GET /tokens/v2/content/summaries`

## Schema Notes
- `content`, `content/cooking`, and `content/feed` are backed by official reference pages and `openapi-spec/content/content.yaml`.
- `content/summaries` is documented in official Jupiter guides and `llms-full.txt`, but does not currently have a dedicated OpenAPI/reference page in the documentation index.
- The local `content/summaries` TypeScript contract is intentionally marked as **inferred from official docs plus sibling Content schemas**. Keep that note until Jupiter publishes a dedicated reference page.

## Design Rules
- Preserve attribution fields exactly as returned by Jupiter VRFD-backed content.
- Do not discard `submittedBy`, `updatedBy`, `source`, or citation arrays.
- Do not synthesize `contents` for the summaries endpoint; return only the summary payload the endpoint is documented to provide.

## Auth Notes
- Content API is documented as Pro-tier only.
- The local client does not hardcode plan gating. It requires `x-api-key` and surfaces upstream auth/rate-limit failures as-is.
