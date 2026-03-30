# Slop App — Slop.money Social APIs

> REST + Socket.IO client for slop.money production APIs: profile registration (with Echo badge), image upload/generate via IPFS proxy, agent DSL queries, and global chat messaging.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove operations, update types, fix stale references.

---

## Directory Structure

```
src/tools/slop-app/
  types.ts    — Domain types: Profile, Image, AgentQuery, ChatMessage, ApiResponse
  errors.ts   — HTTP status → EchoError mapping (400, 401, 403, 429, 504)
  client.ts   — SlopAppClient: profile, image, agents (REST, singleton)
  chat.ts     — Socket.IO chat: post message + read history (short-lived connections)
```

---

## REST Client (`client.ts`)

Singleton `SlopAppClient` with two base URLs:
- `backendUrl` (`config.services.backendApiUrl`) — profile, agents
- `proxyUrl` (`config.services.proxyApiUrl`) — image upload/generate

### Profile

| Method | Endpoint | Auth |
|--------|----------|------|
| `getProfile(address)` | `GET /profiles/:address` | No |
| `registerProfile(token, params)` | `POST /profiles/register` | JWT |

Registration includes `isEchoBot: true` flag for Echo badge.

### Image

| Method | Endpoint | Auth | Timeout |
|--------|----------|------|---------|
| `uploadImage(buffer, filename, mime)` | `POST /upload-image` (FormData) | No | 30s |
| `generateImage(prompt, uploadToIpfs?)` | `POST /generate-image` | No | 120s |

Upload returns `{ ipfsHash, gatewayUrl }`. Generate optionally uploads to IPFS.

### Agents (DSL Query)

| Method | Endpoint | Auth |
|--------|----------|------|
| `queryAgents(token, query)` | `POST /agents/query` | JWT |

Query DSL:
```typescript
{
  source: "tokens",
  filters?: [{ field, op, value }],
  orderBy?: { field, direction },
  limit?: number,  // default 50
  offset?: number
}
```

Returns `{ tokens: Record<string, unknown>[], count, cached }`.

---

## Chat (`chat.ts`)

Socket.IO short-lived connections (connect → action → disconnect):

| Function | Protocol | Auth | Timeout |
|----------|----------|------|---------|
| `postChatMessage(wsUrl, token, message, gifUrl?)` | Socket.IO | JWT via `chat:auth` | 60s |
| `readChatHistory(wsUrl, limit?)` | Socket.IO | None | 15s |

### Post flow
1. Connect to WS
2. Emit `chat:auth { accessToken }`
3. Wait for `chat:auth_ok`
4. Emit `chat:send { content, gifUrl }`
5. Wait for own echo in `chat:new` (content match)
6. Disconnect

### Read flow
1. Connect with `query: { historyLimit }`
2. Wait for `chat:history` event (array of messages)
3. Disconnect

---

## Error Mapping (`errors.ts`)

| HTTP | Error code | Meaning |
|------|-----------|---------|
| 400 | `AGENT_QUERY_INVALID` | Bad query syntax |
| 401 | `SLOP_AUTH_FAILED` | JWT expired/invalid |
| 403 | `PROFILE_NOT_FOUND` | Profile required — register first |
| 429 | `AGENT_QUERY_FAILED` (retryable) | Rate limited |
| 504 | `AGENT_QUERY_TIMEOUT` | Query too complex |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `socket.io-client` | Chat WS connections |
| `config/store.ts` | `loadConfig()` — backend + proxy URLs |
| `utils/http.ts` | `fetchJson()`, `fetchWithTimeout()` |
| `errors.ts` | `EchoError`, `ErrorCodes` |

---

## CLI Entry Point

`commands/slop-app/` — profile, image, chat, agents.

---

## Tests

Tests live in `src/__tests__/echo-agent/tools/slop-app-*.test.ts` (echo-agent protocol handler tests).
