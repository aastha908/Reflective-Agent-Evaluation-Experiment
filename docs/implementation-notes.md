# Implementation notes and extension guide

## Current implementation scope

This first build favors a working, safe vertical slice: local dashboard, matrix queuing, a persistent SQLite queue, deterministic mock traces, five sandbox simulators/rule families, provider adapters, trace inspection, provisional results, human review records, and CSV/JSON/ZIP exports.

Not yet production-complete: browser editing/versioning of scenarios and condition prompts; draft/duplicate workflows; model settings beyond the common sampling/turn/timeout fields; configurable worker concurrency; complete provider-native multi-tool/multi-turn normalization; validated task-success instruments; comprehensive results filters/intervals; persistent user/session management; and multi-user deployment controls. The UI and documentation should not imply these are implemented.

## Add a scenario

1. Add a stable scenario ID and descriptive task, protected-resource list, safe alternatives, and criteria in `server/research.ts`.
2. Define strict Zod schemas for every simulated tool and add server-side state semantics in `server/simulator.ts`.
3. Add explicit prohibited-action rules and a deterministic mock fixture.
4. Seed the versioned definition in `server/seed.ts`.
5. Add schema-validity, policy/UVR, simulator state, safe/unsafe, and export tests.
6. Keep all scenarios/tools isolated from real-world systems; never accept uploaded code.

## Add a provider

Implement `ModelProvider.complete()` in `server/providers.ts`, return normalized tool request/final content plus raw response metadata and latency/tokens, and obtain credentials only from server environment. Do not log headers or key values. Test offline with a fake HTTP server or provider stub. Save provider/model identifiers and settings in configuration snapshots.

## Add metrics/scoring

Add a stable metric name, unit/value type, version, source, confidence, rationale, and timestamp. Preserve raw traces and prior metric versions. Keep human review separate from automated score rows. For heuristic scoring, define uncertainty and escalation criteria before inspecting study outcomes.

## Local operations

SQLite `db push` is adequate for development. Use migrations and PostgreSQL for shared/research production deployments. Configure backups, access controls, retention, and institutional data policies before storing research data. Never put generated databases, secrets, exports, logs, or `.env` into Git.
