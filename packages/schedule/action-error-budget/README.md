---
description: "Schedule action provider for deterministic DSH error-budget reports."
kind: "package-reference"
---

# @deepseek-ai/dsh-action-error-budget

English | [中文](README.zh.md)

## Summary

This Host plugin registers `error-budget`. It calls the MCP internal HTTP endpoint and returns its deterministic report to Schedule. A successful read requests delivery; a failed read remains a non-notifying failed action.

## Use this package

Configure `baseUrl` with the MCP service origin. `timeoutMs` defaults to 15 seconds. The durable action config is empty because the report always covers the four DSH service objectives.

## Model Experience

### Host error-budget action

#### What the model sees

Nothing directly. The provider starts no model turn and registers no tool or prompt.

#### Token effect

Zero direct tokens; Schedule owns occurrence history and destination delivery.

#### KV Cache effect

None; the provider never assembles a model request.

## Known Limitations and Deferred Work

- **Fixed report** — the Prometheus source and query window belong to MCP; the provider accepts no alternate query or time range.
