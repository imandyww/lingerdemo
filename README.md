# Linger

**AI does not create conversations. It catches conversations that almost happened.**

Linger is a browser-based realtime oral-history companion for older adults and their families. It notices meaningful memories, asks one concrete follow-up at a time, preserves only what the speaker approves, and turns saved stories into prompts that help relatives begin the next conversation.

The complete three-minute demo is local and credential-free. It remains usable without a microphone or browser speech synthesis.

## Quick start

Prerequisites:

- Node.js 22+ and npm 10+
- Python 3.12
- [`uv`](https://docs.astral.sh/uv/) 0.8+

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:3000/demo](http://localhost:3000/demo). The web app runs on port 3000 and the FastAPI service on port 8080. Mock mode is the default and requires no secrets.

`npm run dev` starts both services. `uv` resolves the pinned Python environment on first use; a globally activated virtual environment is not required.

## What is included

- Accessible start and live-conversation experiences with explicit recording consent, transcript captions, pause/mute/interrupt/correction/end controls, visible capture state, and development diagnostics.
- Deterministic mock voice provider with realistic partial/final transcripts, state transitions, cancellation, optional browser speech synthesis, and no-microphone demo operation.
- Family Archive with editable/exportable stories, linked timeline, simple accessible family relationship graph, provenance, sensitivity, permissions, and unresolved questions.
- Family Gathering Mode that introduces one personalized question, then becomes quiet with recording explicitly off.
- Provider-neutral TypeScript/JSON Schema/Pydantic WebSocket contract with binary audio frames, session/turn/sequence filtering, bounded inputs, and playback acknowledgements.
- FastAPI `VoiceSessionOrchestrator`, abstract STT/LLM/TTS/extraction providers, complete mock pipeline, live readiness boundaries, streaming text segmentation, cancellation propagation, and safe text-only TTS fallback.
- Async SQLAlchemy models, Alembic migration, SQLite demo database, PostgreSQL-compatible configuration, transactional archive saves, and idempotent family seed data.
- Unit, mock integration, protocol-contract, API, and browser tests plus a non-mutating live-provider smoke test.

## Repository

```text
linger/
├── apps/
│   ├── web/                 Next.js App Router, browser providers, UI, browser tests
│   └── api/                 FastAPI, orchestration, providers, data, migrations, tests
├── packages/protocol/       JSON Schema and matching TypeScript protocol types/tests
├── config/prompts/          Editable voice, extraction, and gathering prompts
├── docs/                    Architecture, providers, privacy, operations, demo, help
├── scripts/                 Credential-safe live smoke test
├── .env.example             Mock defaults and live configuration surface
├── docker-compose.yml       Web/API services; external hardware is not emulated
└── package.json             npm workspace and cross-stack commands
```

See [architecture](docs/architecture.md) and the [WebSocket protocol](docs/websocket-protocol.md) for the runtime design.

## Demo flow

The `/demo` route preloads a six-person family, five stories, a partial tree, a timeline, and unresolved questions. Follow the on-screen guide to:

1. Intentionally begin the scripted conversation.
2. Complete the exact rain/train-station exchange.
3. Simulate extraction and review every name, relationship, place, date, and question.
4. Confirm consent and save “The day I left home.”
5. See the story, the provenance-backed 1968 timeline event, and Ming in the tree.
6. Generate “Ask Grandma what happened to her younger brother Ming after she left home.”
7. Start a family conversation; Linger asks it once, enters quiet mode, and visibly turns recording off.

The derived year is supported by Grandma’s stored birth year (1951) plus her direct age statement (seventeen). The UI and saved provenance distinguish those sources from a direct date statement.

The timed narration is in [docs/presenter-script.md](docs/presenter-script.md).

## Database

Local default:

```env
DATABASE_URL=sqlite+aiosqlite:///./data/linger.db
```

Migrate and seed independently:

```bash
npm run db:migrate
npm run db:seed
```

Both migration and seed are idempotent. For PostgreSQL, provide an async SQLAlchemy URL such as `postgresql+asyncpg://...`, run migrations, and use production-grade credentials/networking. Do not reuse the demo database or mock authentication for real family data.

## Configuration

Copy `.env.example`. These defaults are intentionally local:

```env
VOICE_PROVIDER=mock
LLM_PROVIDER=mock
DEMO_MODE=true
MOCK_AUTH=true
RAW_AUDIO_RETENTION=false
```

Missing live secrets do not affect mock startup. Live mode fails readiness with an actionable, sanitized error; it never silently sends content to a different model.

### Inworld live speech

Read [docs/provider-notes.md](docs/provider-notes.md) before configuration. Provide the documented server-side credentials, verified STT configuration, TTS model, voice, language, and audio format. Then set:

```env
VOICE_PROVIDER=inworld
NEXT_PUBLIC_VOICE_PROVIDER=backend
```

The values in `.env.example`, including `inworld-tts-2`, are examples requiring verification against current documentation and the selected account capabilities. Credentials never belong in `NEXT_PUBLIC_*` variables.

### Tenstorrent live inference

The inference server is an external, hardware-backed dependency; Docker Compose does not emulate it. Read [docs/tenstorrent-setup.md](docs/tenstorrent-setup.md), then provide a private authenticated OpenAI-compatible base URL, a verified loaded instruction model, health mechanism, and context limit:

```env
LLM_PROVIDER=tenstorrent
NEXT_PUBLIC_VOICE_PROVIDER=backend
TENSTORRENT_BASE_URL=https://private-model-host.example/v1
TENSTORRENT_API_KEY=managed-secret
TENSTORRENT_MODEL=operator-verified-model-id
TENSTORRENT_HEALTH_URL=https://private-model-host.example/health
```

The example `Llama-3.1-8B-Instruct` value is not a universal hardware compatibility claim. Verify it for the actual device topology and serving release. Never expose the inference port to the public internet.

## Tests and checks

All default automated tests run without live credentials:

```bash
npm test
npm run test:web
npm run test:api
npm run test:e2e
npm run lint
npm run typecheck
npm run build
npm run check
```

Install Playwright’s browser once if it is not already present:

```bash
npx playwright install chromium
```

The live smoke test is explicit and non-mutating:

```bash
npm run smoke:live
```

It reports each configured subsystem as pass, fail, skipped, or unavailable without printing secrets or modifying archive data.

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Compose runs only the web and API services and persists the local SQLite database in a named volume. Inworld remains a remote service and Tenstorrent remains an external hardware-backed server. For production, build immutable images, use PostgreSQL, managed secrets, authenticated sessions, private networks, exact origins, and HTTPS/WSS.

## Privacy and production cautions

Raw-audio retention is disabled. Linger never records passively and offers an end-without-saving path. Enabling audio storage requires a separate, documented consent and encrypted retention process; see [docs/privacy-security.md](docs/privacy-security.md).

Mock auth, local SQLite, development CORS defaults, and unencrypted `ws://` are demo settings. Before real use, complete the production checklist, verify deletion/export/sharing behavior for the deployment jurisdiction, and keep provider endpoints and secrets server-side.

Current live-provider verification status and exact unresolved runtime details are recorded in [docs/provider-notes.md](docs/provider-notes.md). Operational handoff steps are in [docs/operations.md](docs/operations.md), and common failures are covered by [docs/troubleshooting.md](docs/troubleshooting.md).
