---
description: "Connect chat to the shared ACK MCP server in this cluster."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-ack-mcp-bundle

English | [中文](README.zh.md)

## Summary

Offer the cluster's shared ACK MCP server to Web chat. It ships switched off. Select it in Plugins to enable it. The address is fixed; the page has no URL field.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

In Web, open Plugins and enable **ACK cluster** in Official. Switch it off to remove its profile layer.

The switch mounts one Host MCP client at `http://dsh-ack-mcp.dsh.svc:8000/mcp`. A failed connection does not stop chat from starting.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) contributes the `mcp-ack` row on the Host. Later root patches can disable that row; an override alone does not select the bundle. The [profile composer](../../boot/app-boot/README.md) owns patch ordering and errors.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[MCP client](../../mcp/mcp-client/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [MCP client](../../mcp/mcp-client/README.md), which registers the server's tools.

#### KV Cache effect

The layer adds no request content directly; the MCP client owns cache effects from tools, prompts, and results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The server address is the in-cluster service. This bundle does not accept another URL.
- A hand-written `mcp-ack` insert in the profile patch duplicates this row. Remove that insert before using the switch.
- The shared server is read-only. Diagnose and inspect stay unavailable.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
