# `@deepseek-ai/dsh-trace`

这是覆盖完整 Harness Turn 的内容安全 OpenTelemetry Trace 插件。它创建 `dsh.agent.turn`、`dsh.model.request`、`dsh.tool.execute` 和 `dsh.mcp.call` Span，通过 MCP 请求 `_meta` 传播 W3C Trace Context，并由进程直接使用 OTLP/HTTP protobuf 上报；不需要新增 OpenTelemetry Collector。

Trace 与 Session telemetry 相互独立。基础 Bundle 仅在 `DSH_TRACE_ENABLED=1` 时启用，并读取：

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_SERVICE_NAME`（默认 `dsh-harness`）
- `OTEL_RESOURCE_ATTRIBUTES`

缺少端点时进入内部 `config_invalid` 状态，但不会阻断对话。导出队列上限为 2048 个 Span，单批最多 256 个，退出刷新是尽力而为。

每个用户 Turn 都采样，并且整条链路最多创建 200 个非根 Span。每次 MCP 调用先消耗一个本地客户端 Span 名额，再原子预留最多 8 个下游名额。未使用或发送失败的预留不会返还，以保证并行工具调用时的分布式硬上限。

只上报固定白名单属性：操作/结果、有界错误类型、provider/model、token 数、公开工具名、重试/预算诊断和固定资源属性。不会记录 prompt/completion、工具参数/结果、异常消息/堆栈、URL、路径、Header、Cookie、凭证或任意动态属性。
