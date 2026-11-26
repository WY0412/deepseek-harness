---
description: "执行确定性 ACK 集群快照的 Schedule action provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-action-cluster-watch

[English](README.md) | 中文

## 摘要

该 Host 插件注册 `cluster-watch`。每个已准入 occurrence 会把稳定任务 id、集群 id 和 occurrence 时间提交到配置的 MCP 内部 HTTP 接口，并把经过校验的确定性结果交回 Schedule；provider 自身不发送消息。

## 使用方式

用 `baseUrl` 配置 MCP 服务来源地址。`timeoutMs` 默认 20 秒。持久动作配置接受 ACK 集群 ID 和可选的 `notification_policy`。省略或设为 `changes` 时沿用 MCP 的变化通知规则。设为 `always` 时每次实际执行请求一次投递，包括首次基线、无变化和失败。取消会中止 HTTP 请求及后续投递。

## 模型体验

### Host 集群巡检 action

#### 模型可见内容

没有直接可见内容。Provider 不启动模型轮次，也不注册工具或 prompt。

#### Token 影响

直接 token 为零；HTTP 结果和投递状态只进入 Schedule 任务历史。

#### KV Cache 影响

无；provider 不组装模型请求。

## 已知限制与后续工作

- **租约身份**——provider 依赖 MCP 的来源地址租约鉴权。
- **不重试 HTTP**——MCP 状态使用 CAS，且 occurrence 重试策略由 Schedule 拥有，因此 provider 对每个已准入尝试只发送一次。
