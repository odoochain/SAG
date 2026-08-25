# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Project Overview

SAG is a document retrieval workbench implementing event-centric graph retrieval (RAG): each document chunk produces one event plus multiple entities; entities form the index that enables SQL multi-hop expansion during retrieval. Full-stack TypeScript ESM monorepo: Fastify backend in `src/`, React 19 + Vite + Tailwind frontend in `web/`, PostgreSQL + pgvector data layer.

## Commands

```bash
# Prerequisites
docker compose up -d          # PostgreSQL + pgvector
npm install
npm run db:setup              # run migrations (migrations/*.sql) + seed

# Development (runs API + WebUI concurrently)
npm run dev                   # API on :4173 (tsx watch), WebUI on :5174 (Vite proxies /api etc. to 4173)

# Verification
npm run typecheck             # typechecks BOTH src/ and web/ tsconfigs — run this before committing
npm test                      # vitest run (all tests)
npx vitest run test/search-service.test.ts   # single test file

# Production
npm run build                 # clean + tsc build API + vite build web
npm start                     # node dist/src/index.js (serves built web assets from web/dist)

# Other
npm run mcp                   # MCP stdio server (SAG_LOG_STDERR=true tsx src/mcp/server.ts)
npm run db:migrate            # migrations only
```

## Architecture

### Runtime settings precedence

`aiSettingsService.getRuntimeSettings()` (src/services/ai-settings-service.ts) merges DB-stored settings (set via WebUI Global Settings, migration 003) over `.env` values. Services read runtime settings at call time — don't assume `config` from src/config/env.ts reflects effective model settings. `EMBEDDING_DIMENSIONS` is hard-locked to 1024 because pgvector columns are `vector(1024)`.

### AI clients with local fallback

src/ai/ has three OpenAI-compatible clients (LLM, Embedding, Rerank). If API keys are absent, a local deterministic fallback is used — tests rely on this and need no external APIs or network. API keys are never echoed back by the API or UI (only "configured / not configured").

### Ingestion pipeline

`IngestionService.ingestDocument()` (src/services/ingestion-service.ts): create source/document → chunk (`src/ingestion/chunking/markdown.ts`, modes: `heading_strict` | `token`) → per-chunk event + entity extraction via LLM (`src/ingestion/extract/extractor.ts`) → embed event title/content, entity keys, and relations → write to Postgres. Concurrency controlled by `INGEST_CONCURRENCY`. Emits `IngestProgressUpdate` stages (PARSING, ...) consumed by the WebUI.

### Search pipeline

`SearchService` (src/services/search-service.ts, the core of SAG):

- `strategy: "vector"` — plain chunk vector search.
- `strategy: "multi"` — SAG retrieval, two search modes:
  - `fast` (default): BM25/full-text entity match → SQL multi-hop event expansion → rerank model top-k. No LLM in the recall path.
  - `standard`: LLM extracts query entities → multi-route recall (entity vector, entity text, event title vector) → LLM rerank.
- Sub-strategies (`multi`, `multi1`, `hopllm`) and tunables (maxHops, maxEvents, thresholds) live in the `multi` search input.
- Both search and ingestion emit progress/trace events (`SearchProgressEvent`, `SearchTrace`) surfaced in the WebUI trace panel; `timed()` helper records per-step latencies.

### Data layer

- src/db/pool.ts — pg pool. src/db/repositories.ts — one large flat module containing all SQL (entity/event/chunk CRUD, vector search, multi-hop expansion, graph queries). Row→record mappers sit at the top.
- src/db/vector.ts — pgvector literal helpers.
- Migrations are ordered plain SQL files in migrations/; `npm run db:migrate` (tsx src/db/migrate.ts) applies pending ones. Schema changes = new numbered file.
- Multi-hop expansion is done in SQL (joins over the event↔entity relation tables), not in application code.

### HTTP API

All routes are defined inline in src/api/server.ts with zod request schemas (single file, ~600 lines). Key endpoints: `/ingest`, `/api/search`, `/api/search/stream` (SSE streaming with trace), `/api/projects`, `/api/model-call-logs`. Serves built frontend from `web/dist` in production.

### MCP server

src/mcp/server.ts exposes the same services over stdio MCP (tools: `sag_ingest_document`, `sag_search`, `sag_explain_search`, `sag_get_event`). A project's MCP config binds the project via `SAG_MCP_SOURCE_ID` env var so tool calls omit `projectId`.

### Frontend

web/src/App.tsx is a single large (~4000 line) React component holding the whole workbench UI (projects, documents, chat, graph, MCP, settings); web/src/lib/api.ts is the typed API client; i18n in web/src/i18n.tsx. Graph visualization uses @xyflow/react. UI progress messages in services are user-facing strings (currently Chinese).

## Conventions

- ESM throughout (`"type": "module"`); backend relative imports must use the `.js` extension (compiled by `tsc` to `dist/src/`).
- Runtime code is executed with tsx (dev/scripts) or compiled via `tsconfig.build.json`.
- Zod validates all external input (HTTP schemas, MCP tool schemas, env config in src/config/env.ts).
- Tenant scoping: every service call takes a `tenantId` defaulting to `config.DEFAULT_TENANT_ID`; queries filter by it.
