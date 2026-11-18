/** Browser entry for the ACK cluster credential form. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ACK_BUNDLE, readControlOrigin } from './credentials.ts'
import { CredentialForm } from './CredentialForm.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

interface OriginMeta {
  getAttribute(name: string): string | null
}

interface OriginPage {
  querySelector(selector: string): OriginMeta | null
}

/**
 * Register the form on the ACK cluster plugin page when this index names a control plane.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const doc = (globalThis as { document?: OriginPage }).document
  if (doc === undefined || readControlOrigin(doc) === null) return
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: ACK_BUNDLE,
  }, CredentialForm))
}
