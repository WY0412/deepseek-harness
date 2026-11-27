type TimingField = 'readyMs' | 'firstReplyMs' | 'connectedMs'

export function summarize(rows: readonly Partial<Record<TimingField, number>>[], field: TimingField) {
  const durations = rows
    .map(row => row[field])
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)
  const percentile = (p: number) => durations.length === 0 ? null : durations[Math.ceil(p * durations.length) - 1]
  return {
    samples: rows.length, observed: durations.length,
    successRate: rows.length === 0 ? null : durations.length / rows.length,
    p50: percentile(0.50), p95: percentile(0.95),
  }
}
