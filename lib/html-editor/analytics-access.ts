export interface AnalyticsFeatureAccessSource {
  licensed?: boolean;
  historyDays?: number | null;
  pageInsights?: boolean;
  funnels?: boolean;
  abTests?: boolean;
  utms?: boolean;
  features?: Record<string, boolean>;
  limits?: Record<string, number | null>;
  upgradeUrl?: string;
  licenseUrl?: string;
}

export interface AnalyticsFeatureAccess {
  licensed: boolean;
  historyDays: number | null;
  pageInsights: boolean;
  funnels: boolean;
  abTests: boolean;
  utms: boolean;
  upgradeUrl?: string;
  licenseUrl?: string;
}

/** All analytics capabilities are included in the open-source edition. */
export function resolveAnalyticsFeatureAccess(
  _product?: AnalyticsFeatureAccessSource,
): AnalyticsFeatureAccess {
  return {
    licensed: true,
    historyDays: null,
    pageInsights: true,
    funnels: true,
    abTests: true,
    utms: true,
  };
}
