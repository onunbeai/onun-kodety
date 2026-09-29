'use client';

import { Activity, FlaskConical, MousePointerClick, Users } from '@/components/ui/gravity-icons';
import { getAdminNumberFormatter } from '@/lib/admin-ui-locale';
import type { AnalyticsPeriod } from '@/lib/html-editor/analytics';
import {
  AnalyticsMetric,
  AnalyticsPageHeader,
  AnalyticsSectionHeader,
  AnalyticsSurface,
} from './HtmlAnalyticsUi';

const experiments = [
  {
    name: 'Hero — CTA principal',
    status: 'Vencedor provável',
    confidence: 99.4,
    variants: [
      { name: 'Controle', visitors: 2_100_000, conversions: 462_000, rate: 22 },
      { name: 'CTA “Começar agora”', visitors: 2_140_000, conversions: 621_000, rate: 29 },
    ],
  },
  {
    name: 'Checkout — prova social',
    status: 'Em andamento',
    confidence: 96.8,
    variants: [
      { name: 'Controle', visitors: 1_180_000, conversions: 259_600, rate: 22 },
      { name: 'Com depoimentos', visitors: 1_210_000, conversions: 332_750, rate: 27.5 },
    ],
  },
  {
    name: 'Pricing — destaque anual',
    status: 'Em andamento',
    confidence: 93.1,
    variants: [
      { name: 'Controle', visitors: 870_000, conversions: 147_900, rate: 17 },
      { name: 'Plano anual destacado', visitors: 900_000, conversions: 195_300, rate: 21.7 },
    ],
  },
];

const compact = () => getAdminNumberFormatter({ notation: 'compact', maximumFractionDigits: 1 });
const decimal = () => getAdminNumberFormatter({ maximumFractionDigits: 1 });

export function HtmlAnalyticsDemoAbTests({ period }: { period: AnalyticsPeriod }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-12 pt-6 sm:px-7 lg:px-9">
        <AnalyticsPageHeader
          icon={FlaskConical}
          title="Testes A/B"
          description="Desempenho simulado dos experimentos ativos."
          meta={<span>{period.from} — {period.to}</span>}
        />

        <AnalyticsSurface className="mt-5">
          <div data-kodety-analytics-metric-grid className="grid grid-cols-2 gap-px bg-[var(--kodety-divider)] lg:grid-cols-4">
            <AnalyticsMetric label="Testes ativos" value="4" tone="accent" />
            <AnalyticsMetric label="Exposições" value={compact().format(8_400_000)} />
            <AnalyticsMetric label="Conversões" value={compact().format(1_280_000)} />
            <AnalyticsMetric label="Melhor incremento" value="+32,8%" tone="success" />
          </div>
        </AnalyticsSurface>

        <div className="mt-4 grid gap-3">
          {experiments.map(experiment => (
            <AnalyticsSurface key={experiment.name}>
              <section className="p-4">
                <AnalyticsSectionHeader
                  icon={Activity}
                  title={experiment.name}
                  description={`${decimal().format(experiment.confidence)}% de confiança estatística`}
                  action={<span className="rounded-full bg-[var(--kodety-success)]/[.09] px-2 py-1 text-[8px] font-semibold text-[var(--kodety-success)]">{experiment.status}</span>}
                />
                <div className="mt-1 overflow-hidden rounded-[9px] border border-[var(--kodety-divider)]">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-4 bg-white/[.025] px-3 py-2 text-[8px] font-medium uppercase tracking-[.06em] text-[var(--kodety-text-disabled)]">
                    <span>Variante</span><span>Visitantes</span><span>Conversões</span><span>Taxa</span>
                  </div>
                  {experiment.variants.map((variant, index) => (
                    <div key={variant.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 border-t border-[var(--kodety-divider)] px-3 py-3 text-[10px]">
                      <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--kodety-text)]">
                        {index === 1 ? <MousePointerClick className="size-3 text-[var(--kodety-accent-hover)]" /> : <Users className="size-3 text-[var(--kodety-text-tertiary)]" />}
                        <span className="truncate">{variant.name}</span>
                      </span>
                      <span className="tabular-nums text-[var(--kodety-text-secondary)]">{compact().format(variant.visitors)}</span>
                      <span className="tabular-nums text-[var(--kodety-text-secondary)]">{compact().format(variant.conversions)}</span>
                      <span className={index === 1 ? 'font-semibold tabular-nums text-[var(--kodety-success)]' : 'tabular-nums text-[var(--kodety-text-secondary)]'}>{decimal().format(variant.rate)}%</span>
                    </div>
                  ))}
                </div>
              </section>
            </AnalyticsSurface>
          ))}
        </div>
      </div>
    </div>
  );
}
