---
description: "把当前 same-Host 目标作为不透明 Harness 消息目的地暴露的 DSH-IM adapter。"
kind: "package-reference"
---

# @deepseek-ai/dsh-message-destination-dsh-im

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-message-destination` 的 DSH-IM provider。它消费现有 same-Host `ctx.dshIm` 服务，不修改或包裹 DSH-IM 存储。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

### 行为

- Cordis 注入依赖：`messageDestinations` 和 `dshIm`。
- Provider id：`dsh-im`。
- 目的地 id 为 `dsh-im:v1:` 加 `botId + NUL + targetId` 的完整小写 SHA-256 摘要。
- 枚举顺序不影响 id。公共值只包含 hash、目标显示名称、kind 和 channel，绝不包含 `botId`、`targetId` 或 `route`。
- `resolve` 和每次 `send` 都重新枚举当前 bot 与 target。解析复杂度为当前目的地数量的 O(n)，并受 service 的 200 条目录上限约束。
- bot/target 被删除或 hash 伪造、过期时关闭式失败，不改投其它目的地。
- 发送默认 5 秒超时。超时映射为 `delivery_unknown`，因为取消变得可见前 DSH-IM 可能已经接受消息。
- DSH-IM 不接受幂等键，也不保存主动投递历史。调用方不得自动重发 unknown 结果。

默认导出是 Cordis 插件函数。具名导出为 `apply`、`name`、`inject`，以及用于 same-Host 组合的结构化 `DshImService` 接口。

<a id="understand-the-implementation"></a>
## 理解实现

Adapter 枚举 same-Host DSH-IM bot 与 target，对每一对私有标识计算 hash，并且只在一次 list、resolve 或 send 操作期间短暂保留裸标识。

<a id="further-exploration"></a>
## 深入探索

通用 provider 与消费者契约位于 [`@deepseek-ai/dsh-message-destination`](../message-destination/README.zh.md)。目标配置和主动投递行为由 DSH-IM 拥有。

<a id="model-experience"></a>
## 模型体验

### Host 侧 DSH-IM 适配

#### 模型看到什么

没有直接内容。该 adapter 只向 Host 消费者暴露确定性的 `ctx.dshIm` 目录和投递操作，不注册提示或工具内容。

#### Token 影响

直接 token 为零；hash、label 和投递结果不会通过该 adapter 进入模型上下文。

#### KV Cache 影响

无；adapter 既不组装也不发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **线性解析**——每次 resolve 和 send 都以 O(n) 复杂度扫描当前 DSH-IM 目录，使过期或伪造 hash 关闭式失败。
- **超时结果未知**——DSH-IM 不提供幂等键或投递历史，因此不会自动重试超时发送。
- **仅文本投递**——本 adapter 使用现有纯文本发送路径，不暴露渠道特定卡片或附件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本包使用结构化 `DshImService` 类型，因为 DSH-IM 由池镜像安装，不属于本仓库 workspace 依赖图。

</details>
