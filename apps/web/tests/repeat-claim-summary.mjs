export function summarize(rows, field) {
  const durations = rows.map((row) => row[field]).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  const percentile = (p) => durations.length === 0 ? null : durations[Math.ceil(p * durations.length) - 1]
  return {
    samples: rows.length, observed: durations.length,
    successRate: rows.length === 0 ? null : durations.length / rows.length,
    p50: percentile(0.50), p95: percentile(0.95),
  }
}
