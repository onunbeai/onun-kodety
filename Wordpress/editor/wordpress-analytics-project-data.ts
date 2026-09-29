import type { AnalyticsTrackingTarget } from '@/lib/html-editor/analytics';
import { trackingTargetsForProject } from '@/lib/html-editor/editor-live-dom-helpers';
import { analyticsPageLabel } from '@/lib/html-editor/editor-wordpress-helpers';
import { readExperimentSettings } from '@/lib/html-editor/experiments';
import { getProjectHomePath } from '@/lib/html-editor/project-io';
import { publicRouteForProjectPage } from '@/lib/html-editor/redirects';
import type { HtmlProject } from '@/lib/html-editor/types';
import type {
  AnalyticsExperimentOption,
  AnalyticsPageOption,
} from '@/app/(builder)/kodety/html-editor/components/HtmlAnalyticsFunnels';

export interface WordPressAnalyticsProjectData {
  pages: AnalyticsPageOption[];
  trackingTargets: AnalyticsTrackingTarget[];
  experiments: AnalyticsExperimentOption[];
}

/** Loaded only after a project-aware Analytics tab is selected. */
export function wordpressAnalyticsProjectData(project: HtmlProject): WordPressAnalyticsProjectData {
  const htmlPages = Object.keys(project.files)
    .filter(path => !path.startsWith('.incode/') && /\.html?$/i.test(path))
    .sort();
  const homePath = getProjectHomePath(project);
  return {
    pages: htmlPages.map(path => ({
      path,
      runtimePath: publicRouteForProjectPage(path, homePath),
      label: analyticsPageLabel(path, homePath),
    })),
    trackingTargets: trackingTargetsForProject(project, htmlPages, homePath),
    experiments: readExperimentSettings(project).experiments.map(experiment => ({
      id: experiment.id,
      name: experiment.name,
      variants: experiment.variants.map(variant => ({ id: variant.id, name: variant.name })),
    })),
  };
}
