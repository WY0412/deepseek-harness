---
description: "在 ACK 集群插件页填写阿里云钥匙和 GitHub token。"
kind: "package"
---

# @deepseek-ai/dsh-client-ui-ack-credentials

[English](README.md) | 中文

## 概述

在 ACK 集群插件页显示两组空的凭证输入。浏览器把它们交给控制面。这个页面不保留填写的值，关闭 ACK 插件后表单仍在。

## 使用此包

Web 组合加载这个包。只有页面带有控制面源时才注册槽位。槽位键是 `@deepseek-ai/dsh-experimental-ack-mcp-bundle`。

## 模型体验

无，因为浏览器把阿里云钥匙和 GitHub token 交给控制面，不保留模型能读到的值。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **只负责填写入口**——密文留在控制面，本包不保存填写的值。
