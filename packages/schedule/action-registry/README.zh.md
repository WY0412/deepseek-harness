---
description: "可由 Loader 独立加载的 Schedule action registry provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-action-registry

[English](README.md) | 中文

## 摘要

该包把 `ScheduleActionRegistry` 暴露为独立 Loader 插件，使 profile 可以在不改变 Schedule service 的情况下启用类型化 action。

## 模型体验

### Host action registry

#### 模型可见内容

没有直接可见内容。Registry 只在 Host 运行，也不注册工具或 prompt。

#### Token 影响

直接 token 为零；provider 元数据不会进入模型上下文。

#### KV Cache 影响

无；registry 操作不组装模型请求。

## 已知限制与后续工作

- **Profile 顺序**——profile 必须在 action provider 前加载本包。缺少本包时普通 prompt reminder 继续工作，action 任务保持冻结。
