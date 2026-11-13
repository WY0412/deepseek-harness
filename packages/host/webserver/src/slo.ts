let noted = false

/** Page or terminal accepted once. Health checks do not call this. */
export function noteConnected(): void {
  if (noted) return
  noted = true
  console.log('dsh slo: connected')
}

export function resetConnected(): void {
  noted = false
}
