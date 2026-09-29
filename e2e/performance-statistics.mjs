export function rounded(value, precision = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function quantile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('quantile exige ao menos um valor.');
  }
  if (!values.every(Number.isFinite) || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error('quantile recebeu valores ou razão inválidos.');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarizeSamples(samples, metrics, expectedCount) {
  const summary = {};
  for (const metric of metrics) {
    const values = samples.map(sample => sample[metric]).filter(Number.isFinite);
    if (values.length !== expectedCount) {
      throw new Error(`${metric} deve ter exatamente ${expectedCount} amostras válidas.`);
    }
    const median = quantile(values, 0.5);
    const absoluteDeviations = values.map(value => Math.abs(value - median));
    const firstQuartile = quantile(values, 0.25);
    const thirdQuartile = quantile(values, 0.75);
    summary[metric] = {
      min: rounded(Math.min(...values)),
      median: rounded(median),
      mad: rounded(quantile(absoluteDeviations, 0.5)),
      q1: rounded(firstQuartile),
      q3: rounded(thirdQuartile),
      iqr: rounded(thirdQuartile - firstQuartile),
      max: rounded(Math.max(...values)),
      range: rounded(Math.max(...values) - Math.min(...values)),
    };
  }
  return summary;
}
