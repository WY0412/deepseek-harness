---
description: "供消息 provider 与自动化消费者使用的不透明消息目的地能力 seam。"
kind: "package-reference"
---

# @deepseek-ai/dsh-message-destination

[English](README.md) | 中文

## 概述

用于发现、解析和发送不透明消息目的地的 Host 侧能力 seam。消费者使用 `ctx.messageDestinations`；provider 通过 `MessageDestinationService.register()` 注册。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

### 契约

- `list(signal)` 持续读取 provider 分页，所有 provider 合计最多返回 200 个公共目的地。
- `resolve(ref, signal)` 重新校验 provider 拥有的不透明 id。保存的 `label` 和 `kind` 仅用于显示，不能作为授权依据。
- `send(ref, text, signal)` 只路由到 `ref.provider`，不会回退到其它 provider 或目的地。
- 未知 provider 和无效 provider 响应使用带稳定 code 的 `DestinationError`。
- Provider 收到调用者传入的同一个 `AbortSignal`。

公共值只包含 `DestinationView` 元数据。Provider 凭证、渠道 route 和 provider 内部目的地标识必须留在 provider 边界内。

### 组合导出

- 默认导出和具名导出：`MessageDestinationService`
- Cordis 注入 key：`messageDestinations`
- Provider 接口：`DestinationProvider`
- 消费者值：`DestinationRef`、`DestinationView`、`DestinationSendResult`
- 上限：`DESTINATION_LIMIT`（`200`）

<a id="understand-the-implementation"></a>
## 理解实现

Service 在内存中保存 provider 注册，沿 provider 拥有的 cursor 读取分页，并在不解释 opaque id 的情况下完成委派。授权和所有渠道特定状态都由 provider 拥有。

<a id="further-exploration"></a>
## 深入探索

DSH-IM 实现位于 [`@deepseek-ai/dsh-message-destination-dsh-im`](../message-destination-dsh-im/README.zh.md)。

<a id="model-experience"></a>
## 模型体验

### Host 目的地能力

#### 模型看到什么

没有直接内容。消费者可以在模型执行之外使用 `ctx.messageDestinations`，但本包不注册提示文字、工具 schema、Session 事件或模型结果。

#### Token 影响

直接 token 为零；本包不会把目的地元数据或投递结果追加到模型上下文。

#### KV Cache 影响

无；目的地发现和投递不会组装或发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **有界目录**——一次 list 最多暴露 200 个目的地；更大的 provider 目录会关闭式失败，而不是返回不完整的选择器。
- **Provider 拥有授权**——seam 无法独立验证目的地；每个 provider 必须在 resolve 和 send 时重新授权 opaque id。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

TASK-006 拥有 root bundle、TypeScript 引用和 UI 集成。在该组合任务之前，本包有意保持可独立构建。

</details>
