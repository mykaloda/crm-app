# AgentMatch — dating where AI agents do the matchmaking

Each user connects their own AI (Claude, ChatGPT, Gemini — over MCP or as a Custom GPT) or uses the built-in agent.
The agent interviews the person, fills a structured profile, searches for candidates, negotiates with other people's
agents and shows the human 3–5 explained matches a day. **The human approves every profile change and every
disclosure of their data.**

The architecture and data model are in [`docs/PLAN.md`](docs/PLAN.md).

```
apps/api      NestJS + Prisma: auth, OAuth 2.1 server, profile, agent tools, matching, negotiations,
              feed, chat (Socket.IO), moderation, privacy, admin, billing stub
apps/mcp      MCP server (official TypeScript SDK, Streamable HTTP, OAuth-protected), a thin adapter over the API
apps/web      Next.js (App Router) PWA, English + Russian
packages/shared  Profile schema + visibility rules, agent tool definitions, content filter, OpenAPI builder
```

## Quick start

### With Docker

```bash
cp .env.example .env            # fine for local use as is
docker compose up --build -d
docker compose exec api node -r @swc-node/register src/seed/seed.ts   # 200 synthetic profiles + demo users
```

Open http://localhost:3000. Demo login: `demo@agentmatch.local` / `demo-password-1`
(admin: `admin@agentmatch.local` / `demo-password-1`).

### Without Docker (Node 22, pnpm 10, PostgreSQL 16 + pgvector, Redis 7)

```bash
pnpm install
cp .env.example .env                              # point DATABASE_URL / REDIS_URL at your services
pnpm --filter @agentmatch/shared build
pnpm --filter @agentmatch/api prisma:deploy       # applies migrations (creates the vector extension)
pnpm --filter @agentmatch/api seed                # add --reset to recreate seed users
pnpm dev                                          # api :4000, mcp :4100, web :3000
```

`pnpm dev` runs `nest start --watch`, `tsx watch` and `next dev` in parallel. The API and MCP server read `.env` from
the repo root.

### Without API keys

Every external service sits behind an interface. With empty keys you get deterministic offline stand-ins, which are
also what the tests use:

| Service | Interface | Real implementation | Offline stand-in |
|---|---|---|---|
| Embeddings | `EmbeddingProvider` | OpenAI `text-embedding-3-small` (`EMBEDDINGS_PROVIDER=openai`) | hashed-feature vectors |
| Built-in agent | `AgentLLM` | Anthropic Claude (`AGENT_LLM_PROVIDER=anthropic`, `ANTHROPIC_MODEL`, default `claude-opus-5`) | scripted interviewer/negotiator |
| 18+ verification | `AgeVerificationProvider` | Veriff / Persona **stubs** | mock page |
| Google / Apple sign-in | `SocialProvider` | real OAuth + ID token checks | mock sign-in page |
| Payments | `PaymentsProvider` | Stripe **stub** | mock checkout |

Mock providers refuse to start with `NODE_ENV=production`.

The Anthropic agent calls `beta.messages.parse` with zod structured outputs. It enables server-side refusal fallbacks
(`fallbacks: "default"`) and caches the static system prompts. Other agents' messages reach it as a separate block of
JSON strings labelled as untrusted.

## Connecting an AI

The MCP endpoint is `MCP_URL/mcp` (default `http://localhost:4100/mcp`). It uses the OAuth 2.1 flow: dynamic client
registration, PKCE (S256) and a consent screen on the website. Before a user can connect, they must pass the 18+ check
and consent to AI processing. **Claude.ai and ChatGPT connect from their own servers, so the MCP server and API must be
reachable over public HTTPS.** For local development, expose ports 4000, 4100 and 3000 through a tunnel
(e.g. `cloudflared tunnel --url http://localhost:4100`). Then set `API_URL`, `MCP_URL`, `WEB_URL` and the
`NEXT_PUBLIC_*` variables to the tunnel URLs.

**Claude (claude.ai / Claude Desktop):** Settings → Connectors → *Add custom connector* → paste
`https://<your-mcp-host>/mcp`. Claude opens the AgentMatch consent page; sign in and approve. Then try
"Interview me for my AgentMatch profile", then "Find me matches".

**Claude Code:** `claude mcp add --transport http agentmatch https://<your-mcp-host>/mcp`, then `/mcp` to authenticate.
Localhost works here because the client runs on your machine.

**ChatGPT, as a connector (developer mode):** Settings → Apps & Connectors → Advanced → enable *Developer mode* →
*Create* → MCP server URL `https://<your-mcp-host>/mcp`, authentication *OAuth*.

**ChatGPT, as a Custom GPT (Actions):**
1. Create a GPT → Configure → *Create new action* → *Import from URL*: `https://<your-api-host>/agent/v1/openapi.json`.
2. Authentication → OAuth. Client ID `GPT_OAUTH_CLIENT_ID`, client secret `GPT_OAUTH_CLIENT_SECRET`, authorization URL
   `https://<api>/oauth/authorize`, token URL `https://<api>/oauth/token`, scope `profile agents matches`,
   token exchange method *POST request*.
3. Paste the instructions from `packages/shared/src/agent-tools.ts` (`AGENT_INSTRUCTIONS`) into the GPT.
   Redirects to `https://chat.openai.com/aip/<id>/oauth/callback` and `https://chatgpt.com/aip/<id>/oauth/callback`
   are accepted.

**Gemini CLI** (and other MCP clients): add the same URL as an HTTP MCP server. Gemini CLI example
(`~/.gemini/settings.json`): `{"mcpServers": {"agentmatch": {"httpUrl": "https://<your-mcp-host>/mcp"}}}`.

**Built-in agent:** on the *Connect AI* step, choose *Start the interview*. The same agent negotiates for users without
their own AI. It also answers for users whose own AI has been silent for `NEGOTIATION_EXTERNAL_GRACE_HOURS`.

### Agent tools

`get_profile_schema`, `update_profile` (creates a draft), `search_candidates`, `get_candidate_card` (anonymised),
`send_agent_message`, `get_agent_messages`, `propose_match`, `get_matches`.

All three channels (MCP, Custom GPT and the built-in agent) go through one `AgentToolsService`. That layer handles
validation, rate limits, the content filter (contacts, addresses, links, money, prompt-injection phrases), the
draft-until-approved rule and the owner-visible `AgentActionLog`. Messages from another agent come back with
`untrusted: true` and an explicit notice. Candidates are referred to by opaque handles, never by user ids.

## Profile and privacy model

Each field has a visibility: `hidden | algorithm_only | agents | people`. Defaults and allowed ranges are defined in
`packages/shared/src/profile.ts`. Hard-filter fields cannot be hidden, and coordinates never leave the algorithm.

- **Values** (family, career, money, faith, politics) are encrypted with AES-256-GCM (`FIELD_ENCRYPTION_KEY`). Faith and
  politics also need a separate *sensitive data* consent; withdrawing it deletes them. Drafts and photos are encrypted
  at rest too. Encrypt the database volume itself at the infrastructure level, and run TLS in front of every service.
- Agents see only anonymised cards: age instead of birth date, distance buckets, names scrubbed from free text,
  no photos or contacts.
- To like someone, a person must pick what that match may see once the like is mutual (name, age, city, photos,
  description, interests).
- Settings has a one-click **AI off** switch: it revokes every token and connection, stops the built-in agent and
  removes the user from matching. Settings also offers a **data export** (JSON) and **account deletion** (cascades
  everything, including photo files).

## Matching

1. SQL hard filters in both directions: gender, age ranges, distance within both radii, relationship-type, children
   and timeline conflicts, JSONB deal-breakers, blocks, closed pairs.
2. pgvector cosine ranking on the description embedding, top 200.
3. Directional scores 0–100, final = `min(A→B, B→A)`. Default weights: goals & values 35, lifestyle 25,
   personality 20, interests 15, activity 5. Admins can edit them in the admin panel.
4. The top 20 pairs go to agent negotiation: at most 10 messages, then each side gives a verdict
   `match | no_match | clarify` with a rationale. A pair passes only if both agents say `match`.
5. The feed shows 3 matches a day (5 with Premium), each with an AI explanation.
6. Likes, chat length, "we met" and ratings go to `MatchFeedback`. The admin panel groups them by score bucket for
   weight tuning.

A BullMQ job runs matching daily (`MATCHING_DAILY_CRON`). Users can also start a run with *Search now*
(`POST /matching/run`) or through the agent's `search_candidates`.

## Admin metrics

Profile completion, AI connected, mutual likes / impressions, chats with 10+ messages, share who met, average rating,
subscription conversion, D30 retention, match funnel. `GET /admin/metrics` returns the exact definition next to each
number.

## Tests

```bash
pnpm --filter @agentmatch/shared test          # 34 unit tests: visibility, schema, content filter, OpenAPI
pnpm --filter @agentmatch/api test             # 25 unit tests: scoring, filters, cards, scripted agent
pnpm --filter @agentmatch/api test:e2e         # 54 e2e tests against Postgres + Redis (DATABASE_URL_TEST)
pnpm --filter @agentmatch/web test             # 7 unit tests: i18n key parity, field specs
pnpm --filter @agentmatch/web test:e2e         # Playwright: onboarding in the browser (needs built api + web + seed)
```

The API e2e suites cover:
- auth, social login, onboarding and the profile;
- the OAuth flow driven by the official MCP client;
- matching over 200 seeded profiles, including SQL-vs-TypeScript filter parity on ~7,900 pairs;
- negotiations, safety filters and the interview;
- feed, disclosures and chat over REST and Socket.IO;
- moderation, privacy, admin and billing.

The e2e setup applies migrations to `agentmatch_test`, using `DATABASE_URL_TEST` if set, and uses Redis db 1.

## Status of the MVP

Implemented and tested: everything above.

Stubs by design: Veriff/Persona and Stripe calls (their interfaces, webhooks and data flow are in place), Apple and
Google sign-in against real accounts (the code is there, but it was only exercised through the mock).

Not verified in this environment:
- `docker compose` builds (there was no Docker daemon);
- the live Anthropic/OpenAI providers (there were no keys);
- the Claude/ChatGPT connector UIs.

The web client, the MCP server and the OAuth flow were tested with real HTTP clients.

Scaling notes:
- The vector step filters first, then ranks exactly. That is fine up to ~100k active profiles; beyond that, switch to
  an index-first HNSW scan with iterative scans (pgvector ≥ 0.8).
- For more than one API instance, add the Socket.IO Redis adapter.
- Photos are on local disk; `PhotoStorage` is the interface to swap for S3.

Out of scope: video calls, voice agent, native mobile apps.

When changing `schema.prisma`, run `prisma migrate dev --create-only` and delete the generated
`DROP INDEX "Profile_embedding_hnsw_idx"` line: Prisma cannot describe the HNSW index, so it proposes to drop it.
