# Tasks

> Implementation starts in a new session. Order is incremental and verifiable;
> each phase ends in a typecheck + `eve build`.

## Phase 1 — Shared-kit telemetry infra

- [x] Add `@vercel/otel`, `@opentelemetry/api`,
      `@opentelemetry/exporter-trace-otlp-proto`, and
      `@arizeai/openinference-vercel` to `shared/package.json`.
- [x] Add `shared/lib/instrumentation.ts` — `createAgentInstrumentation`
      factory per the design sketch:
      - `setup` registers `registerOTel` with an
        `OpenInferenceSimpleSpanProcessor` wrapping an `OTLPTraceExporter`
        pointed at `<endpoint>/v1/traces`.
      - Endpoint resolves `PHOENIX_COLLECTOR_ENDPOINT` →
        `OTEL_EXPORTER_OTLP_ENDPOINT`; **returns without registering when
        neither is set**.
      - Headers parsed from `OTEL_EXPORTER_OTLP_HEADERS`
        (`key=value,key2=value2`).
      - `recordInputs` / `recordOutputs` wired to
        `TELEMETRY_RECORD_IO !== "false"`.
      - `events["step.started"]` merges the caller's `attributes(input)`
        result into `runtimeContext`.
- [x] Add `shared/lib/telemetry.ts` — `withSpan`, `logEvent`, `counter`,
      `histogram` over `@opentelemetry/api` (global-API no-op contract; no
      feature flags at call sites; `withSpan` records exceptions and
      re-throws).
- [x] Add both modules to the `shared` package `exports` map
      (`./lib/instrumentation.js`, `./lib/telemetry.js`).
- [x] `npm -w shared run typecheck` clean.

## Phase 2 — First adoption: linkedin-cover-generator

- [x] Add `agent/instrumentation.ts` calling
      `createAgentInstrumentation({ attributes: () => ({
      "cover.orchestrator_model": ..., "cover.image_model": ... }) })`.
- [x] Wrap the image-API `fetch` in `agent/tools/generate_image.ts` in
      `withSpan("cover.image_generation", { model, width, height }, ...)`
      (exemplar need-basis custom span; no behavior change).
- [x] Add a commented telemetry block to `.env.example`
      (`PHOENIX_COLLECTOR_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
      `TELEMETRY_RECORD_IO`) — all off by default.
- [x] `npm -w linkedin-cover-generator run typecheck` clean; `eve build`
      clean; `eve info` shows the instrumentation file discovered.

## Phase 3 — Verify locally against Phoenix

- [ ] `docker run -d --name phoenix -p 6006:6006 arizephoenix/phoenix:latest`
      and set `PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006` in `.env`.
- [ ] Run one cover generation (`input=inputs/article.md`) via
      `npx eve dev`; confirm in the Phoenix UI:
      - one trace per turn with the `ai.eve.turn` root span;
      - child spans for each orchestrator step and every tool call
        (`create_run` … `sync_run_to_host`);
      - the custom `cover.image_generation` span nested under
        `generate_image`'s tool span, with its own latency;
      - prompts/completions visible; token counts populated;
      - `cover.orchestrator_model` / `cover.image_model` attributes present;
      - `eve.session.id` matches `perSession[].sessionId` in the run's
        `summary.json`.
- [ ] Set `TELEMETRY_RECORD_IO=false`, run again, confirm spans keep
      timing/tokens but omit message and payload content.
- [ ] **No-op checks:**
      - Unset both endpoint vars → run works, no exporter registered, custom
        `withSpan` call adds no errors or latency.
      - Endpoint set but Phoenix container stopped → run completes normally;
        export failures stay out of the agent output.

## Phase 4 — Documentation

- [x] Add an "Observability" section to the agent `README.md`: the
      three-layer picture (run rollup / `$eve.*` tags / OTel traces), env-var
      contract, Phoenix Docker quickstart, generic-OTLP example, the
      custom-signals API with the `generate_image` exemplar, the one-file
      adoption recipe for other agents, session-id ↔ run-folder correlation,
      and the `TELEMETRY_RECORD_IO` privacy note.
- [x] Cross-reference the shared modules from `shared/README.md` so other
      agents discover the adoption pattern.

## Phase 5 — (Optional, deploy-time)

- [ ] For the Vercel deployment: point `PHOENIX_COLLECTOR_ENDPOINT` (or
      `OTEL_EXPORTER_OTLP_ENDPOINT` + headers) at a reachable collector via
      `vercel env add`, set `TELEMETRY_RECORD_IO=false`, redeploy, run the
      standard smoke test, and confirm the trace arrives.

## Verification (Definition of Done)

- [ ] With Phoenix running and the endpoint configured, every cover run
      produces a complete, navigable trace (model + tool spans, the custom
      image-generation span, tokens, timing, custom attributes) in Phoenix.
- [ ] With no telemetry env vars set, agent behavior, output, and logs are
      byte-for-byte unchanged — including the instrumented `generate_image`
      path.
- [ ] With an unreachable endpoint, runs complete normally.
- [ ] All pipeline code lives in `shared/`; the agent contributes only the
      thin `agent/instrumentation.ts` and its own custom-signal call sites.
- [ ] No changes to `agent/instructions.md`, the usage hook, or the report
      pipeline.
- [ ] `eve build` and `npx tsgo` clean in both `shared` and the agent.
