---
description: "生成确定性 DSH 错误预算报告的 Schedule action provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-action-error-budget

[English](README.md) | 中文

## 摘要

该 Host 插件注册 `error-budget`。它调用 MCP 内部 HTTP 接口，并把确定性报告交回 Schedule。读取成功时请求投递；读取失败时保留为不通知的失败 action。

## 使用方式

用 `baseUrl` 配置 MCP 服务来源地址。`timeoutMs` 默认 15 秒。持久 action 配置为空，因为报告始终覆盖 DSH 的四条服务目标。

## 模型体验

### Host 错误预算 action

#### 模型可见内容

没有直接可见内容。Provider 不启动模型轮次，也不注册工具或 prompt。

#### Token 影响

直接 token 为零；occurrence 历史和消息目的地投递由 Schedule 拥有。

#### KV Cache 影响

无；provider 不组装模型请求。

## 已知限制与后续工作

- **固定报告**——Prometheus 来源和查询窗口由 MCP 拥有；provider 不接受替代查询或时间范围。
