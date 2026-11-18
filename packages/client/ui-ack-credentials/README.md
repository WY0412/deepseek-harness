---
description: "Enter an Aliyun key and GitHub token on the ACK cluster plugin page."
kind: "package"
---

# @deepseek-ai/dsh-client-ui-ack-credentials

English | [中文](README.zh.md)

## Summary

Show two empty credential groups on the ACK cluster plugin page. The browser posts them to the control plane. This page does not keep the values, and the form stays when the ACK plugin is switched off.

## Use this package

The Web composition loads this package. It registers a slot only when the index contains a control-plane origin. The slot key is `@deepseek-ai/dsh-experimental-ack-mcp-bundle`.

## Model Experience

None, as the browser posts the Aliyun key and GitHub token to the control plane and keeps no value a model can read.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Entry only** — ciphertext stays in the control plane, and this package never stores the typed values.
