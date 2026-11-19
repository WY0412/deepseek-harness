---
description: "Loader-addressable provider for the Schedule action registry."
kind: "package-reference"
---

# @deepseek-ai/dsh-action-registry

English | [中文](README.zh.md)

## Summary

This package exposes `ScheduleActionRegistry` as a standalone Loader plugin so profiles can enable typed actions independently of the Schedule service.

## Model Experience

### Host action registry

#### What the model sees

Nothing directly. The registry is Host-only and registers no tool or prompt.

#### Token effect

Zero direct tokens; provider metadata stays outside model context.

#### KV Cache effect

None; registry operations never assemble a model request.

## Known Limitations and Deferred Work

- **Profile ordering** — profiles load this package before action providers. Without it, prompt reminders continue normally and action tasks remain frozen.
