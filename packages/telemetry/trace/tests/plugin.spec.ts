import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import { applyTracing } from '../src/plugin.ts'
import { createTraceRuntime } from '../src/runtime.ts'
import { withTurnTraceState } from '../src/context.ts'
import { SpanBudget } from '../src/budget.ts'

type Listener = (...args: never[]) => unknown

class FakeContext {
  readonly listeners = new Map<string, Listener>()

  on(name: string, listener: Listener): () => void {
    this.listeners.set(name, listener)
    return () => this.listeners.delete(name)
  }

  listener(name: string): Listener {
    const listener = this.listeners.get(name)
    if (listener === undefined) throw new Error(`missing listener ${name}`)
    return listener
  }
}

describe('trace plugin', () => {
  it('settles root/model/tool spans once without content attributes', async () => {
    const exporter = new InMemorySpanExporter()
    const runtime = createTraceRuntime({ enabled: true, serviceName: 'test' }, {
      exporter,
      registerGlobal: false,
    })
    const fake = new FakeContext()
    applyTracing(fake as unknown as Context, runtime)
    const turn = fake.listener('agent/turn') as unknown as (
      payload: { agent: unknown; turn: number; signal: AbortSignal },
      next: () => Promise<boolean>,
    ) => Promise<boolean>
    const model = fake.listener('llm/stream') as unknown as (
      options: { provider: string; model: string; signal: AbortSignal },
      next: () => AsyncIterable<unknown>,
    ) => AsyncIterable<unknown>
    const tool = fake.listener('tools/execute') as unknown as (
      exec: { name: string; signal: AbortSignal },
      next: () => Promise<{ content: never[]; isError: false }>,
    ) => Promise<unknown>
    const signal = new AbortController().signal
    const agent = {
      session: {
        snapshotEvents: () => [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }],
      },
    }

    await turn({ agent, turn: 1, signal }, async () => {
      for await (const _chunk of model({
        provider: 'provider-safe',
        model: 'model-safe',
        signal,
      }, async function* () {
        yield { type: 'text-delta', index: 0, text: 'SECRET_PROMPT_MARKER' }
        yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SAFE_CODE', message: 'SECRET_ERROR' } } }
      })) { /* consume */ }
      for await (const _chunk of model({
        provider: 'provider-safe',
        model: 'model-safe',
        signal,
      }, async function* () {
        yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })) { /* consume */ }
      await tool({ name: 'safe_tool', signal }, async () => ({ content: [], isError: false }))
      return false
    })
    await runtime.forceFlush()

    const spans = exporter.getFinishedSpans()
    expect(spans.map(span => span.name).sort()).toEqual([
      'dsh.agent.turn',
      'dsh.model.request',
      'dsh.model.request',
      'dsh.tool.execute',
    ])
    expect(JSON.stringify(spans.map(span => span.attributes))).not.toContain('SECRET_PROMPT_MARKER')
    expect(spans.find(span => span.name === 'dsh.agent.turn')?.attributes).toMatchObject({
      'dsh.result': 'success',
      'dsh.span_budget.used': 3,
    })
    const modelSpans = spans.filter(span => span.name === 'dsh.model.request')
    expect(modelSpans[0]?.attributes).toMatchObject({
      'dsh.result': 'error',
      'dsh.error.type': 'model_error',
      'dsh.retry.attempt': 0,
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
    })
    expect(modelSpans[1]?.attributes).toMatchObject({
      'dsh.result': 'success',
      'dsh.retry.attempt': 1,
      'gen_ai.usage.input_tokens': 7,
      'gen_ai.usage.output_tokens': 5,
    })
    expect(JSON.stringify(spans.map(span => span.attributes))).not.toContain('SECRET_ERROR')
    await runtime.shutdown()
  })

  it('keeps invalid exporter configuration non-fatal', () => {
    const runtime = createTraceRuntime({ enabled: true, serviceName: 'test' })
    expect(runtime.state).toBe('config_invalid')
    expect(() => applyTracing(new FakeContext() as unknown as Context, runtime)).not.toThrow()
  })

  it('ends the model span even when iterator cleanup throws', async () => {
    const exporter = new InMemorySpanExporter()
    const runtime = createTraceRuntime({ enabled: true, serviceName: 'test' }, { exporter, registerGlobal: false })
    const fake = new FakeContext()
    applyTracing(fake as unknown as Context, runtime)
    const model = fake.listener('llm/stream') as unknown as (
      options: { provider: string; model: string; signal: AbortSignal },
      next: () => AsyncIterable<unknown>,
    ) => AsyncIterable<unknown>
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false as const, value: { type: 'text-delta', index: 0, text: 'safe' } }),
          return: async () => { throw new Error('cleanup failed') },
        }
      },
    }

    const rootSpan = runtime.tracer.startSpan('test.root')
    await withTurnTraceState({ budget: new SpanBudget(200), rootSpan }, async () => {
      const iterator = model({ provider: 'p', model: 'm', signal: new AbortController().signal }, () => source)[Symbol.asyncIterator]()
      await iterator.next()
      await expect(iterator.return?.()).rejects.toThrow('cleanup failed')
    })
    rootSpan.end()
    await runtime.forceFlush()
    expect(exporter.getFinishedSpans().filter(span => span.name === 'dsh.model.request')).toHaveLength(1)
    await runtime.shutdown()
  })
})
