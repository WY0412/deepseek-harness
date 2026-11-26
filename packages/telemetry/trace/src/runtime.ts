import {
  SpanKind,
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import type { SpanExporter } from '@opentelemetry/sdk-trace-node'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node'

export interface TraceConfig {
  enabled: boolean
  endpoint?: string
  headers?: Readonly<Record<string, string>> | string
  serviceName: string
  resourceAttributes?: Readonly<Record<string, string>>
}

/** Parse the standard OTEL comma-separated header format without logging values. */
export function parseOtlpHeaders(input: TraceConfig['headers']): Record<string, string> {
  if (input === undefined) return {}
  if (typeof input !== 'string') return { ...input }
  const headers: Record<string, string> = {}
  for (const item of input.split(',')) {
    const separator = item.indexOf('=')
    if (separator <= 0) continue
    const key = item.slice(0, separator).trim()
    if (!key) continue
    headers[key] = decodeURIComponent(item.slice(separator + 1).trim())
  }
  return headers
}

export type TraceRuntimeState = 'disabled' | 'ready' | 'config_invalid'

export interface TraceRuntime {
  readonly state: TraceRuntimeState
  readonly tracer: Tracer
  readonly diagnostic?: string
  readonly diagnostics: TraceDiagnostics
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

export interface TraceDiagnostics {
  exportBatchesSuccess: number
  exportBatchesFailure: number
  spansDroppedExport: number
}

class ReportingExporter implements SpanExporter {
  private lastWarning = 0

  constructor(private readonly delegate: SpanExporter, private readonly diagnostics: TraceDiagnostics) {}

  export(spans: ReadableSpan[], callback: Parameters<SpanExporter['export']>[1]): void {
    this.delegate.export(spans, (result) => {
      if (result.code === 0) {
        this.diagnostics.exportBatchesSuccess += 1
      } else {
        this.diagnostics.exportBatchesFailure += 1
        this.diagnostics.spansDroppedExport += spans.length
        const now = Date.now()
        if (now - this.lastWarning >= 60_000) {
          this.lastWarning = now
          console.warn('trace export result=failure reason=export')
        }
      }
      callback(result)
    })
  }

  forceFlush(): Promise<void> { return this.delegate.forceFlush?.() ?? Promise.resolve() }
  shutdown(): Promise<void> { return this.delegate.shutdown() }
}

export interface TraceRuntimeOptions {
  exporter?: SpanExporter
  registerGlobal?: boolean
}

const SAFE_RESOURCE_KEYS = new Set(['service.version', 'deployment.environment', 'cloud.region'])

export function safeResourceAttributes(input: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => SAFE_RESOURCE_KEYS.has(key)))
}

function noOpRuntime(state: Exclude<TraceRuntimeState, 'ready'>, diagnostic?: string): TraceRuntime {
  return {
    state,
    ...diagnostic === undefined ? {} : { diagnostic },
    diagnostics: { exportBatchesSuccess: 0, exportBatchesFailure: 0, spansDroppedExport: 0 },
    tracer: trace.getTracer('dsh-trace-disabled'),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }
}

function bounded<T>(operation: Promise<T>, timeoutMillis = 2_000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMillis)
    timer.unref()
    operation.then(
      () => { clearTimeout(timer); resolve() },
      () => { clearTimeout(timer); resolve() },
    )
  })
}

/** Build the official bounded Node SDK runtime. Invalid config never blocks business startup. */
export function createTraceRuntime(config: TraceConfig, options: TraceRuntimeOptions = {}): TraceRuntime {
  if (!config.enabled) return noOpRuntime('disabled')
  if (!config.serviceName || (!options.exporter && (!config.endpoint || config.headers === undefined || config.headers === ''))) {
    return noOpRuntime('config_invalid', 'missing_service_name_endpoint_or_headers')
  }
  try {
    const endpoint = config.endpoint
    const exporter = options.exporter ?? new OTLPTraceExporter({
      ...endpoint === undefined ? {} : { url: endpoint },
      headers: parseOtlpHeaders(config.headers),
      timeoutMillis: 3000,
    })
    const diagnostics: TraceDiagnostics = { exportBatchesSuccess: 0, exportBatchesFailure: 0, spansDroppedExport: 0 }
    const processor = new BatchSpanProcessor(new ReportingExporter(exporter, diagnostics), {
      maxQueueSize: 2048,
      maxExportBatchSize: 256,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 3000,
    })
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        ...safeResourceAttributes(config.resourceAttributes),
      }),
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(1),
      }),
      spanProcessors: [processor],
    })
    if (options.registerGlobal !== false) provider.register()
    return {
      state: 'ready',
      tracer: provider.getTracer('@deepseek-ai/dsh-trace'),
      diagnostics,
      forceFlush: () => bounded(provider.forceFlush()),
      shutdown: () => bounded(provider.shutdown()),
    }
  } catch {
    return noOpRuntime('config_invalid', 'sdk_initialization_failed')
  }
}

export function settleSpan(span: Span, result: 'success' | 'error' | 'cancelled', attributes: Attributes = {}): void {
  span.setAttributes({ 'dsh.result': result, ...attributes })
  span.setStatus(result === 'success'
    ? { code: SpanStatusCode.OK }
    : { code: SpanStatusCode.ERROR })
  span.end()
}

export function startSpan(
  tracer: Tracer, name: string, kind: SpanKind, attributes: Attributes = {},
): { span: Span; active: ReturnType<typeof trace.setSpan> } {
  const parent = context.active()
  const span = tracer.startSpan(name, { kind, attributes }, parent)
  return { span, active: trace.setSpan(parent, span) }
}
