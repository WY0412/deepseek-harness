/** At most one occupancy touch per minute. A failed POST may try again immediately. */

let last = 0

export function noteActivity(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
): void {
  const url = env.DSH_TOUCH_URL
  if (!url) return
  if (now - last < 60_000) return
  last = now
  void Promise.resolve(fetchImpl(url, { method: 'POST' })).catch(() => {
    last = 0
  })
}
