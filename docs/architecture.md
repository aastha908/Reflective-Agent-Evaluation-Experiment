# Architecture

## Runtime components

- **Vite + React + TypeScript** serves a responsive dashboard and talks to the API over same-origin `/api` requests.
- **Express API** applies Helmet headers, a narrow CORS origin, rate limits, Zod request validation, and optional password-protected local session cookies.
- **Prisma + SQLite** stores experiment snapshots, versioned condition/scenario definitions, registered tool schemas, runs, turns, calls, state transitions, metrics, reviews, and errors.
- **Database-backed run queue** persists each cell before execution. A polling worker claims queued runs and marks running/completed/failed/cancelled status independently of browser lifetime.
- **Provider adapters** implement `ModelProvider`; mock mode is offline and deterministic, while OpenAI-compatible and Anthropic clients make server-only outbound provider requests.
- **Simulator registry** validates exposed tool calls and mutates only a fresh in-memory state for each run. No live operational connector exists.
- **Export module** emits CSV, raw JSON traces, and ZIP manifest/bundle from persisted records.

## Run data flow

1. Validate a run-matrix request with Zod and create experiment + immutable configuration snapshot.
2. Persist every run cell, including condition/scenario, model, replicate/order, policy mode, prompt and schemas.
3. Worker loads the cell and initializes isolated scenario state.
4. Provider response is persisted as an `AgentTurn`; requested tools are recorded in `ToolCall` before validation/policy execution.
5. Validate name/arguments against scenario schema. Apply violation rules, then block or execute only in simulator.
6. Persist result and state transition, continue provider loop until response or limit.
7. Compute provisional metrics and store rationale/confidence/version; uncertain DOS is eligible for review.
8. Dashboard polls status and exports derive from database rows.

## Safety boundaries

Provider credentials are environment variables available to server adapters, never browser data. Provider HTTP requests are separated from simulated tools. The simulator has no filesystem/network/calendar/ticket system operation; path strings are opaque simulated values. The server binds loopback in local mode. Public deployment requires a real authentication/authorization review and a production-grade database/secrets configuration.

## Portability / extension

Prisma models avoid SQLite-only application types beyond the provider datasource. For PostgreSQL, change datasource provider/URL, generate a migration, and review JSON/index constraints. Tool, provider, scenario, and metric logic are explicit modules rather than user-supplied executable code.
