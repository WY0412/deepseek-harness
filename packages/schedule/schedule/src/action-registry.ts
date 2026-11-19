/** Process-local registry for typed Schedule action providers. */
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type {
  ScheduleActionProvider, ScheduleActionRequest, ScheduleActionResult, ScheduleJsonValue,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Typed action providers available to Host Schedule tasks. */
    scheduleActions: ScheduleActionRegistry
  }
}

const jsonValue = z.json()
const resultSchema: z.ZodType<ScheduleActionResult> = z.object({
  outcome: z.enum(['succeeded', 'failed']),
  code: z.string().min(1).refine(value => value.trim() === value),
  summary: z.string().max(500),
  notify: z.boolean(),
  message: z.string().min(1).max(2000).optional(),
}).strict().refine(result => !result.notify || result.message !== undefined, {
  message: 'An action result with notify=true must include message', path: ['message'],
})

/** Owns action provider registration, configuration validation, and execution dispatch. */
export class ScheduleActionRegistry extends Service {
  private readonly providers = new Map<string, ScheduleActionProvider>()

  constructor(ctx: Context) {
    super(ctx, 'scheduleActions')
  }

  /**
   * Register one provider until the returned disposer runs.
   * @param provider - Provider identity, display metadata, config validator, and executor.
   * @returns Idempotent disposer removing this exact registration.
   */
  register(provider: ScheduleActionProvider): () => void {
    const id = provider.id.trim()
    if (id.length === 0 || id !== provider.id) throw new Error('schedule action provider id must be a non-empty trimmed string')
    if (provider.title.trim().length === 0 || provider.title !== provider.title.trim()) {
      throw new Error(`schedule action provider ${JSON.stringify(id)} title must be a non-empty trimmed string`)
    }
    if (this.providers.has(id)) throw new Error(`schedule action provider ${JSON.stringify(id)} is already registered`)
    this.providers.set(id, provider)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.providers.get(id) === provider) this.providers.delete(id)
    }
  }

  /**
   * Read one provider without changing registry state.
   * @param id - Stable provider identity.
   * @returns Registered provider, or undefined when unavailable.
   */
  get(id: string): ScheduleActionProvider | undefined {
    return this.providers.get(id)
  }

  /** Return browser-safe provider display metadata in registration order. */
  list(): readonly { readonly id: string; readonly title: string }[] {
    return [...this.providers.values()].map(provider => ({ id: provider.id, title: provider.title }))
  }

  /**
   * Validate provider-owned durable configuration.
   * @param id - Stable provider identity.
   * @param config - Untrusted provider configuration.
   * @returns Lossless JSON accepted by the provider schema.
   */
  validate(id: string, config: ScheduleJsonValue): ScheduleJsonValue {
    const provider = this.require(id)
    return jsonValue.parse(provider.config.parse(config))
  }

  /**
   * Validate configuration, execute the provider, and validate its result.
   * @param id - Stable provider identity.
   * @param request - Admitted occurrence and cancellation signal.
   * @returns Validated deterministic provider outcome.
   */
  async execute(id: string, request: ScheduleActionRequest): Promise<ScheduleActionResult> {
    const provider = this.require(id)
    request.signal.throwIfAborted()
    const config = jsonValue.parse(provider.config.parse(request.config))
    const result = await provider.execute({ ...request, config })
    return resultSchema.parse(result)
  }

  private require(id: string): ScheduleActionProvider {
    const provider = this.providers.get(id)
    if (provider === undefined) throw new Error(`schedule action provider ${JSON.stringify(id)} is unavailable`)
    return provider
  }
}

export default ScheduleActionRegistry
