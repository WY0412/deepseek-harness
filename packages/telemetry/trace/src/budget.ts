import type { Attributes } from '@opentelemetry/api'

export class SpanBudget {
  private remaining: number
  private consumed = 0
  private rejected = 0

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('span budget limit must be a non-negative safe integer')
    this.remaining = limit
  }

  get used(): number {
    return this.consumed
  }

  get dropped(): number {
    return this.rejected
  }

  tryConsume(): boolean {
    if (this.remaining === 0) {
      this.rejected += 1
      return false
    }
    this.remaining -= 1
    this.consumed += 1
    return true
  }

  reserveUpTo(maximum: number): number {
    if (!Number.isSafeInteger(maximum) || maximum < 0) throw new TypeError('span reservation must be a non-negative safe integer')
    const reserved = Math.min(maximum, this.remaining)
    this.remaining -= reserved
    this.consumed += reserved
    this.rejected += maximum - reserved
    return reserved
  }
}

interface SafeTraceAttributeInput {
  operation?: string
  result?: string
  errorType?: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  toolName?: string
  retryAttempt?: number
  unsafe?: Readonly<Record<string, unknown>>
}

export function safeTraceAttributes(input: SafeTraceAttributeInput): Attributes {
  return {
    ...input.operation === undefined ? {} : { 'dsh.operation': input.operation },
    ...input.result === undefined ? {} : { 'dsh.result': input.result },
    ...input.errorType === undefined ? {} : { 'dsh.error.type': input.errorType },
    ...input.provider === undefined ? {} : { 'gen_ai.provider.name': input.provider },
    ...input.model === undefined ? {} : { 'gen_ai.request.model': input.model },
    ...input.inputTokens === undefined ? {} : { 'gen_ai.usage.input_tokens': input.inputTokens },
    ...input.outputTokens === undefined ? {} : { 'gen_ai.usage.output_tokens': input.outputTokens },
    ...input.toolName === undefined ? {} : { 'gen_ai.tool.name': input.toolName },
    ...input.retryAttempt === undefined ? {} : { 'dsh.retry.attempt': input.retryAttempt },
  }
}
