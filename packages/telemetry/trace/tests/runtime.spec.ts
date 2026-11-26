import { describe, expect, it, vi } from 'vitest'
import { createTraceRuntime } from '../src/runtime.ts'

describe('trace runtime diagnostics', () => {
  it('counts failed export batches and dropped spans without exposing failure details', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const exporter = {
      export(_spans: unknown[], done: (result: { code: number }) => void) { done({ code: 1 }) },
      shutdown: async () => {},
    }
    const runtime = createTraceRuntime({ enabled: true, serviceName: 'test' }, {
      exporter: exporter as never,
      registerGlobal: false,
    })
    runtime.tracer.startSpan('test').end()
    await runtime.forceFlush()

    expect(runtime.diagnostics).toEqual({
      exportBatchesSuccess: 0,
      exportBatchesFailure: 1,
      spansDroppedExport: 1,
    })
    expect(warning).toHaveBeenCalledWith('trace export result=failure reason=export')
    warning.mockRestore()
    await runtime.shutdown()
  })
})
