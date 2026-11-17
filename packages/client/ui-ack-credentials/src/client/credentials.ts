/** Request shaping for the ACK plugin credential form. Values are not stored. */

/** Bundle whose detail page owns the two credential groups. */
export const ACK_BUNDLE = '@deepseek-ai/dsh-experimental-ack-mcp-bundle'

/** Meta name written by the web server from `DSH_OCCUPANCY_ORIGIN`. */
export const CONTROL_ORIGIN_META = 'dsh-control-origin'

const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+$/

/** The slice of a document this form needs to find its control plane. */
export interface OriginDocument {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null
}

/**
 * Read the control-plane origin from the index meta tag.
 * @param doc - document that may contain the meta tag.
 * @returns an https origin, or null when the page has no usable tag.
 */
export function readControlOrigin(doc: OriginDocument | undefined): string | null {
  if (doc === undefined) return null
  const value = doc.querySelector(`meta[name="${CONTROL_ORIGIN_META}"]`)?.getAttribute('content') ?? ''
  return ORIGIN_RE.test(value) ? value : null
}

/**
 * Absolute credential endpoint on the control plane.
 * @param origin - https origin from the meta tag.
 * @returns the status and save URL.
 */
export function credentialUrl(origin: string): string {
  return `${origin}/user-credentials`
}

/**
 * Form body for one Aliyun key. Both halves travel together.
 * @param accessKeyId - typed id.
 * @param accessKeySecret - typed secret.
 * @returns urlencoded body.
 */
export function cloudBody(accessKeyId: string, accessKeySecret: string): string {
  return new URLSearchParams({ kind: 'cloud', accessKeyId, accessKeySecret }).toString()
}

/**
 * Form body for one GitHub token.
 * @param token - typed token.
 * @returns urlencoded body.
 */
export function gitBody(token: string): string {
  return new URLSearchParams({ kind: 'git', token }).toString()
}

/** Flags returned by the control plane. Never includes a stored value. */
export interface CredentialStatus {
  ready: boolean
  cloudKey: 'saved' | 'missing'
  git: 'saved' | 'missing'
}

/**
 * Accept only the documented status object.
 * @param status - HTTP status.
 * @param body - parsed JSON, if any.
 * @returns the flags, or null when the body is not the documented shape.
 */
export function parseStatus(status: number, body: unknown): CredentialStatus | null {
  if (status !== 200 || body === null || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (typeof row.ready !== 'boolean') return null
  if (row.cloudKey !== 'saved' && row.cloudKey !== 'missing') return null
  if (row.git !== 'saved' && row.git !== 'missing') return null
  return { ready: row.ready, cloudKey: row.cloudKey, git: row.git }
}

/** Outcome of one save, mapped from the status code rather than response text. */
export type SaveResult = 'saved' | 'invalid' | 'unavailable' | 'failed'

/**
 * Map a save response to a result. Unknown bodies are not displayed.
 * @param status - HTTP status.
 * @param body - parsed JSON, if any.
 * @returns the result the form can show.
 */
export function parseSave(status: number, body: unknown): SaveResult {
  if (status === 200 && body !== null && typeof body === 'object' && (body as { ok?: unknown }).ok === true) return 'saved'
  if (status === 400) return 'invalid'
  if (status === 500) return 'unavailable'
  return 'failed'
}

/**
 * Read a JSON body without throwing on an empty or non-JSON response.
 * @param response - fetch response.
 * @returns the parsed value, or null.
 */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Load the saved/missing flags. A network or shape failure returns null.
 * @param origin - control-plane origin.
 * @param fetchImpl - fetch implementation, defaulting to the page fetch.
 * @returns flags, or null when the status cannot be read.
 */
export async function loadStatus(origin: string, fetchImpl: typeof fetch = fetch): Promise<CredentialStatus | null> {
  try {
    const response = await fetchImpl(credentialUrl(origin), { credentials: 'include' })
    return parseStatus(response.status, await readJson(response))
  } catch {
    return null
  }
}

/**
 * Short result sentence. Origin and network failures share one sentence.
 * @param kind - which group was submitted.
 * @param result - mapped save result.
 * @param lang - document language.
 * @returns the sentence to show for that group.
 */
export function saveMessage(kind: 'cloud' | 'git', result: SaveResult, lang: string): string {
  const zh = !lang.toLowerCase().startsWith('en')
  if (result === 'saved') return zh ? '已保存' : 'Saved'
  if (result === 'invalid') {
    return zh
      ? (kind === 'cloud' ? '阿里云钥匙格式不对' : 'Git 凭证格式不对')
      : (kind === 'cloud' ? 'The Aliyun key is not valid' : 'The Git credential is not valid')
  }
  if (result === 'unavailable') return zh ? '还不能保存' : 'Saving is not available'
  return zh ? '这次没保存' : 'Not saved'
}
