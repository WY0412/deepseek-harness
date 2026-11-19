---
description: "Opaque message-destination capability seam for providers and automation consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-message-destination

English | [中文](README.zh.md)

## Summary

Host-side capability seam for discovering, resolving, and sending to opaque message destinations. Consumers use `ctx.messageDestinations`; providers register with `MessageDestinationService.register()`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

### Contract

- `list(signal)` follows provider pages and returns at most 200 public destinations across all providers.
- `resolve(ref, signal)` revalidates the provider-owned opaque id. The saved `label` and `kind` are display summaries, never authorization inputs.
- `send(ref, text, signal)` routes only to `ref.provider`; it never falls back to another provider or destination.
- Unknown providers and invalid provider responses use `DestinationError` with stable codes.
- Providers receive the caller's exact `AbortSignal`.

Public values contain only `DestinationView` metadata. Provider credentials, channel routes, and provider-internal destination ids must remain behind the provider boundary.

### Exports for composition

- Default export and named export: `MessageDestinationService`
- Cordis injection key: `messageDestinations`
- Provider interface: `DestinationProvider`
- Consumer values: `DestinationRef`, `DestinationView`, `DestinationSendResult`
- Limit: `DESTINATION_LIMIT` (`200`)

<a id="understand-the-implementation"></a>
## Understand the implementation

The service keeps provider registrations in memory, follows provider-owned cursors, and delegates opaque ids without interpreting them. Providers own authorization and all channel-specific state.

<a id="further-exploration"></a>
## Further Exploration

The DSH-IM implementation lives in [`@deepseek-ai/dsh-message-destination-dsh-im`](../message-destination-dsh-im/README.md).

<a id="model-experience"></a>
## Model Experience

### Host destination capability

#### What the model sees

Nothing directly. Consumers may use `ctx.messageDestinations` outside model execution, but this package registers no prompt text, tool schema, Session event, or model result.

#### Token effect

Zero direct tokens; destination metadata and delivery results are not appended to model context by this package.

#### KV Cache effect

None; destination discovery and delivery do not assemble or send model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Bounded directory** — one list operation exposes at most 200 destinations; larger provider directories fail closed instead of returning a partial selector.
- **Provider-owned authorization** — the seam cannot validate a destination independently; each provider must reauthorize opaque ids during resolve and send.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

TASK-006 owns root bundle, TypeScript reference, and UI integration. This package intentionally remains independently buildable until that composition task.

</details>
