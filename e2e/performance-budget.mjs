export const PERFORMANCE_GATE_METRICS = Object.freeze([
  'ttfbMs',
  'fcpMs',
  'lcpMs',
  'cls',
  'loadMs',
  'readyMs',
  'requestCount',
  'transferBytes',
  'blockingTimeUntilReadyMs',
  'inpMs',
  'cpuTaskDurationMs',
]);

export const PUBLISHED_PERFORMANCE_GATE_METRICS = Object.freeze([
  ...PERFORMANCE_GATE_METRICS,
  'speedIndexMs',
  'thirdPartyRequestCount',
  'thirdPartyTransferBytes',
]);

export const SOAK_GATE_METRICS = Object.freeze([
  'heapGrowthBytes',
  'listenerGrowth',
  'nodeGrowth',
  'documentGrowth',
]);

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} deve ser um número finito não negativo.`);
  }
  return value;
}

function entryKey(entry) {
  return [
    entry.projectProfile,
    entry.throttle,
    entry.reportKind,
    entry.target,
    entry.mode,
    entry.metric,
  ].join('\u0000');
}

function gateMetricsForReport(reportKind) {
  return reportKind === 'published-page'
    ? PUBLISHED_PERFORMANCE_GATE_METRICS
    : PERFORMANCE_GATE_METRICS;
}

export function parsePerformanceBudget(source) {
  let budget;
  try {
    budget = typeof source === 'string' ? JSON.parse(source) : source;
  } catch {
    throw new Error('O budget E2E deve ser JSON válido.');
  }
  if (budget?.schemaVersion !== 1 || !Array.isArray(budget.entries)) {
    throw new Error('O budget E2E exige schemaVersion 1 e entries.');
  }
  const keys = new Set();
  for (const entry of budget.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Entrada de budget E2E inválida.');
    for (const field of [
      'projectProfile',
      'throttle',
      'reportKind',
      'target',
      'mode',
      'metric',
    ]) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`A entrada de budget E2E exige ${field}.`);
      }
    }
    finiteNonNegative(entry.baselineMedian, `baselineMedian de ${entry.metric}`);
    finiteNonNegative(entry.maximumMedian, `maximumMedian de ${entry.metric}`);
    if (entry.maximumMedian < entry.baselineMedian) {
      throw new Error(`maximumMedian deve ser >= baselineMedian para ${entry.metric}.`);
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length < 8) {
      throw new Error(`O budget de ${entry.metric} exige rationale explícita.`);
    }
    const key = entryKey(entry);
    if (keys.has(key)) throw new Error('O budget E2E contém uma chave duplicada.');
    keys.add(key);
  }
  return budget;
}

export function validateReleasePerformanceBudget({
  budget: rawBudget,
  projectProfiles = ['small', 'large', 'legacy'],
  throttles = ['slow4g', 'fast3g'],
  workspaceTargets = [
    'Builder',
    'Settings',
    'CMS',
    'Analytics',
    'Localization',
    'Email',
    'File System',
  ],
}) {
  const budget = parsePerformanceBudget(rawBudget);
  const keys = new Set(budget.entries.map(entryKey));
  const requiredKeys = new Set();
  const missing = [];
  const requireEntry = entry => {
    const key = entryKey(entry);
    requiredKeys.add(key);
    if (!keys.has(key)) missing.push(entry);
  };
  for (const projectProfile of projectProfiles) {
    for (const throttle of throttles) {
      for (const target of workspaceTargets) {
        for (const mode of ['cold', 'warm']) {
          for (const metric of PERFORMANCE_GATE_METRICS) {
            requireEntry({
              projectProfile,
              throttle,
              reportKind: 'workspaces',
              target,
              mode,
              metric,
            });
          }
        }
      }
      for (const mode of ['cold', 'warm']) {
        for (const metric of PUBLISHED_PERFORMANCE_GATE_METRICS) {
          requireEntry({
            projectProfile,
            throttle,
            reportKind: 'published-page',
            target: 'Published Page',
            mode,
            metric,
          });
        }
      }
      for (const metric of SOAK_GATE_METRICS) {
        requireEntry({
          projectProfile,
          throttle,
          reportKind: 'soak',
          target: 'Builder',
          mode: 'duration',
          metric,
        });
      }
    }
  }
  if (missing.length) {
    const labels = missing.slice(0, 12).map(entry => (
      `${entry.projectProfile}/${entry.throttle}/${entry.reportKind}/${entry.target}/${entry.mode}/${entry.metric}`
    ));
    const remainder = missing.length > labels.length ? ` (+${missing.length - labels.length})` : '';
    throw new Error(`Budget E2E de release incompleto: ${labels.join(', ')}${remainder}.`);
  }
  return {
    schemaVersion: 1,
    entryCount: budget.entries.length,
    requiredEntryCount: requiredKeys.size,
  };
}

export function evaluatePerformanceBudget({
  budget: rawBudget,
  projectProfile,
  throttle,
  reportKind,
  targets,
}) {
  const budget = parsePerformanceBudget(rawBudget);
  const entries = new Map();
  for (const entry of budget.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Entrada de budget E2E inválida.');
    const key = entryKey(entry);
    if (entries.has(key)) throw new Error('O budget E2E contém uma chave duplicada.');
    entries.set(key, entry);
  }

  const comparisons = [];
  for (const target of targets) {
    for (const mode of ['cold', 'warm']) {
      for (const metric of gateMetricsForReport(reportKind)) {
        const key = entryKey({
          projectProfile,
          throttle,
          reportKind,
          target: target.name,
          mode,
          metric,
        });
        const entry = entries.get(key);
        if (!entry) {
          throw new Error(
            `Budget E2E ausente para ${projectProfile}/${throttle}/${reportKind}/${target.name}/${mode}/${metric}.`,
          );
        }
        const baselineMedian = finiteNonNegative(
          entry.baselineMedian,
          `baselineMedian de ${target.name}/${mode}/${metric}`,
        );
        const maximumMedian = finiteNonNegative(
          entry.maximumMedian,
          `maximumMedian de ${target.name}/${mode}/${metric}`,
        );
        if (maximumMedian < baselineMedian) {
          throw new Error(`maximumMedian deve ser >= baselineMedian para ${target.name}/${mode}/${metric}.`);
        }
        if (typeof entry.rationale !== 'string' || entry.rationale.trim().length < 8) {
          throw new Error(`O budget de ${target.name}/${mode}/${metric} exige rationale explícita.`);
        }
        const measuredMedian = finiteNonNegative(
          target.summary?.[mode]?.[metric]?.median,
          `mediana medida de ${target.name}/${mode}/${metric}`,
        );
        comparisons.push({
          target: target.name,
          mode,
          metric,
          baselineMedian,
          maximumMedian,
          measuredMedian,
          deltaFromBaseline: measuredMedian - baselineMedian,
          deltaPercent: baselineMedian > 0
            ? ((measuredMedian - baselineMedian) / baselineMedian) * 100
            : null,
          passed: measuredMedian <= maximumMedian,
        });
      }
    }
  }
  const violations = comparisons.filter(comparison => !comparison.passed);
  return {
    schemaVersion: 1,
    source: 'reviewed-external-baseline',
    passed: violations.length === 0,
    comparisons,
    violations,
  };
}

export function evaluatePerformanceMeasurementsBudget({
  budget: rawBudget,
  projectProfile,
  throttle,
  reportKind,
  target,
  mode,
  measurements,
}) {
  const budget = parsePerformanceBudget(rawBudget);
  const entries = new Map();
  for (const entry of budget.entries) {
    const key = entryKey(entry);
    if (entries.has(key)) throw new Error('O budget E2E contém uma chave duplicada.');
    entries.set(key, entry);
  }
  const comparisons = Object.entries(measurements).map(([metric, measuredValue]) => {
    const key = entryKey({
      projectProfile,
      throttle,
      reportKind,
      target,
      mode,
      metric,
    });
    const entry = entries.get(key);
    if (!entry) {
      throw new Error(
        `Budget E2E ausente para ${projectProfile}/${throttle}/${reportKind}/${target}/${mode}/${metric}.`,
      );
    }
    const baselineMedian = finiteNonNegative(entry.baselineMedian, `baselineMedian de ${metric}`);
    const maximumMedian = finiteNonNegative(entry.maximumMedian, `maximumMedian de ${metric}`);
    if (maximumMedian < baselineMedian) {
      throw new Error(`maximumMedian deve ser >= baselineMedian para ${metric}.`);
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length < 8) {
      throw new Error(`O budget de ${metric} exige rationale explícita.`);
    }
    const measuredMedian = finiteNonNegative(measuredValue, `valor medido de ${metric}`);
    return {
      target,
      mode,
      metric,
      baselineMedian,
      maximumMedian,
      measuredMedian,
      deltaFromBaseline: measuredMedian - baselineMedian,
      deltaPercent: baselineMedian > 0
        ? ((measuredMedian - baselineMedian) / baselineMedian) * 100
        : null,
      passed: measuredMedian <= maximumMedian,
    };
  });
  const violations = comparisons.filter(comparison => !comparison.passed);
  return {
    schemaVersion: 1,
    source: 'reviewed-external-baseline',
    passed: violations.length === 0,
    comparisons,
    violations,
  };
}

export function performanceBudgetFailureMessage(evaluation) {
  return evaluation.violations
    .map(item => (
      `${item.target}/${item.mode}/${item.metric}: mediana ${item.measuredMedian} > ${item.maximumMedian}`
    ))
    .join(' | ');
}
