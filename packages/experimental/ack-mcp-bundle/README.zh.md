---
description: "让对话连接本集群共用的 ACK MCP 服务。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-ack-mcp-bundle

[English](README.md) | 中文

## 概述

向 Web 对话提供本集群共用的 ACK MCP 服务。随安装带上，默认关闭。在插件页选择它即可启用。地址是固定的，页面上没有地址输入框。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Web 中打开插件页，在官方分组启用 **ACK 集群**。关闭后移除其配置层。

开关在 Host 上挂一个 MCP 客户端，地址是 `http://dsh-ack-mcp.dsh.svc:8000/mcp`。连不上时对话仍能开始。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 在 Host 上加入 `mcp-ack` 这一行。之后的根补丁可以禁用该行；只有覆盖、没有选择这个包时不会启用。补丁顺序和错误由[配置组合](../../boot/app-boot/README.zh.md)负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[MCP 客户端](../../mcp/mcp-client/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 [MCP 客户端](../../mcp/mcp-client/README.zh.md) 注册该服务提供的工具。

#### KV Cache 影响

这一层不直接增加请求内容；工具、提示和结果对缓存的影响由 MCP 客户端负责。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 服务地址是集群内的 Service。这个包不接受别的地址。
- 配置补丁里再手写一条 `mcp-ack` 会和这一行重复。使用开关前先删掉那条。
- 共用的服务是只读的。诊断和巡检仍然不可用。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

无。

</details>
