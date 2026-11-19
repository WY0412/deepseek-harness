---
description: "Schedule action provider for deterministic ACK cluster snapshots."
kind: "package-reference"
---

# @deepseek-ai/dsh-action-cluster-watch

English | [中文](README.zh.md)

## Summary

This Host plugin registers `cluster-watch`. Each admitted occurrence posts the stable task id, cluster id, and occurrence time to the configured MCP internal HTTP endpoint. It returns the validated deterministic outcome to Schedule and never sends a message itself.

## Use this package

Configure `baseUrl` with the MCP service origin. `timeoutMs` defaults to 20 seconds. The durable action config accepts only an ACK cluster id. Cancellation and timeout abort the HTTP request.

## Model Experience

### Host cluster-watch action

#### What the model sees

Nothing directly. The provider starts no model turn and registers no tool or prompt.

#### Token effect

Zero direct tokens; the HTTP result and delivery state stay in Schedule task history.

#### KV Cache effect

None; the provider never assembles a model request.

## Known Limitations and Deferred Work

- **Lease identity** — the provider depends on source-address lease authentication at MCP.
- **No HTTP retry** — MCP state uses CAS and Schedule owns occurrence retry policy, so the provider sends each admitted attempt once.
