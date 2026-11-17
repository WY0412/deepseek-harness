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
