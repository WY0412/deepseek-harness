# `@deepseek-ai/dsh-trace`

Content-safe OpenTelemetry tracing for a complete Harness turn. The plugin creates `dsh.agent.turn`, `dsh.model.request`, `dsh.tool.execute`, and `dsh.mcp.call` spans, propagates W3C Trace Context through MCP request `_meta`, and exports OTLP/HTTP protobuf directly from the process. It does not deploy or require an OpenTelemetry Collector.

Tracing is independent from Session telemetry. The base bundle enables it only when `DSH_TRACE_ENABLED=1` and reads:

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_SERVICE_NAME` (defaults to `dsh-harness`)
- `OTEL_RESOURCE_ATTRIBUTES`

Missing endpoint configuration produces the internal `config_invalid` state and leaves conversations operational. Export queues are bounded to 2048 spans, batches to 256, and shutdown flush remains best effort.

Each user turn is sampled and has a hard budget of 200 non-root spans. An MCP call consumes one local client-span slot and atomically reserves up to eight downstream slots. Unused or failed-call reservations are intentionally not refunded, which makes the distributed upper bound deterministic under parallel tool calls.

Only fixed attributes are emitted: operation/result, bounded error type, provider/model, token counts, public tool name, retry/budget diagnostics, and fixed resource attributes. Prompt/completion content, tool arguments/results, exception messages/stacks, URLs, paths, headers, cookies, credentials, and arbitrary dynamic attributes are never recorded.
