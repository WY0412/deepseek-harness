---
description: "DSH-IM adapter that exposes current same-Host targets as opaque Harness message destinations."
kind: "package-reference"
---

# @deepseek-ai/dsh-message-destination-dsh-im

English | [中文](README.zh.md)

## Summary

DSH-IM provider for `@deepseek-ai/dsh-message-destination`. It consumes the existing same-Host `ctx.dshIm` service and does not modify or wrap DSH-IM storage.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

### Behavior

- Cordis injection requirements: `messageDestinations` and `dshIm`.
- Provider id: `dsh-im`.
- A destination id is `dsh-im:v1:` plus the full lowercase SHA-256 digest of `botId + NUL + targetId`.
- Enumeration order does not affect ids. Public values contain the hash, target display name, kind, and channel; they never contain `botId`, `targetId`, or `route`.
- `resolve` and every `send` call enumerate current bots and targets again. Resolution is O(n) in the current destination count and is bounded by the service's 200-entry directory limit.
- A removed bot/target or forged/stale hash fails closed. The adapter never reroutes.
- Sends time out after 5 seconds by default. A timeout is `delivery_unknown`, because DSH-IM may have accepted the message before cancellation became observable.
- DSH-IM does not accept an idempotency key and does not keep proactive-delivery history. Callers must not automatically resend an unknown result.

The default export is the Cordis plugin function. Named exports are `apply`, `name`, `inject`, and the structural `DshImService` interface used for same-Host composition.

<a id="understand-the-implementation"></a>
## Understand the implementation

The adapter enumerates same-Host DSH-IM bots and targets, hashes each private pair, and retains raw identifiers only for the duration of one list, resolve, or send operation.

<a id="further-exploration"></a>
## Further Exploration

The generic provider and consumer contract lives in [`@deepseek-ai/dsh-message-destination`](../message-destination/README.md). DSH-IM owns target configuration and proactive-delivery behavior.

<a id="model-experience"></a>
## Model Experience

### Host-side DSH-IM adaptation

#### What the model sees

Nothing directly. The adapter exposes deterministic `ctx.dshIm` directory and delivery operations only to Host consumers and registers no prompt or tool content.

#### Token effect

Zero direct tokens; hashes, labels, and delivery results do not enter model context through this adapter.

#### KV Cache effect

None; the adapter neither assembles nor sends model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Linear resolution** — every resolve and send is O(n) over the current DSH-IM directory so stale and forged hashes fail closed.
- **Unknown timeout outcome** — DSH-IM has no idempotency key or delivery history, so a timed-out send is not automatically retried.
- **Text delivery only** — this adapter requests the existing plain-text send path and does not expose channel-specific cards or attachments.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package uses a structural `DshImService` type because DSH-IM is installed by the pool image rather than this repository's workspace dependency graph.

</details>
