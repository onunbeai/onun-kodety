import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function section(contents, start, end) {
  const startIndex = contents.indexOf(start);
  assert.notEqual(startIndex, -1, `missing contract marker: ${start}`);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing contract marker: ${end}`);
  return contents.slice(startIndex, endIndex);
}

function assertInOrder(contents, first, second, message) {
  const firstIndex = contents.indexOf(first);
  const secondIndex = contents.indexOf(second);
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex, message);
}

const [
  workspaceSource,
  wordpressSource,
  legacyEditorSource,
  centerSource,
  formSettingsSource,
  mappingControlSource,
  formFieldsSource,
  globalCssSource,
  inspectorSource,
  pluginSource,
] = await Promise.all([
  source(
    "app/(builder)/kodety/html-editor/components/HtmlAnalyticsWorkspace.tsx",
  ),
  source("Wordpress/editor/WordPressAnalyticsWorkspace.tsx"),
  source("app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx"),
  source(
    "app/(builder)/kodety/html-editor/components/HtmlProjectAnalyticsUtms.tsx",
  ),
  source("app/(builder)/kodety/html-editor/components/HtmlFormUtmSettings.tsx"),
  source(
    "app/(builder)/kodety/html-editor/components/HtmlUtmMappingControl.tsx",
  ),
  source("lib/html-editor/form-fields.ts"),
  source("app/globals.css"),
  source("app/(builder)/kodety/html-editor/components/HtmlInspector.tsx"),
  source("Wordpress/kodety/includes/class-kodety-plugin.php"),
]);

assert.match(
  workspaceSource,
  /export type HtmlAnalyticsWorkspaceView\s*=\s*[^;]*'utms'[^;]*;/,
  "the Analytics view union must include utms",
);
assert.ok(
  workspaceSource.includes("utmSlot?: ReactNode;"),
  "the workspace must expose the UTM slot",
);
assertInOrder(
  workspaceSource,
  ">Testes A/B</SidebarButton>",
  ">Central de UTMs</SidebarButton>",
  "Central de UTMs must remain immediately after the A/B navigation entry",
);

const persistentSlot = section(
  workspaceSource,
  "{utmSlot ? (",
  "{activeView === 'utms' ? null",
);
assert.ok(
  persistentSlot.includes("className={activeView === 'utms' ?") &&
    persistentSlot.includes("aria-hidden={activeView === 'utms' ?") &&
    persistentSlot.includes("{utmSlot}"),
  "the UTM slot must stay mounted and only be hidden while another view is active",
);

assert.ok(
  wordpressSource.includes("requested === 'utms'"),
  "the standalone WordPress parser must accept ?view=utms",
);
assert.ok(
  (legacyEditorSource.match(/requestedView === 'utms'/g) || []).length >= 2,
  "both legacy Analytics entry paths must accept ?view=utms",
);
assert.ok(
  (legacyEditorSource.match(/utmSlot=\{/g) || []).length >= 2,
  "both legacy Analytics entry paths must provide the UTM slot",
);

const loadSurface = section(
  wordpressSource,
  "const loadSurface = useCallback",
  "const loadFullProject = useCallback",
);
assert.ok(
  loadSurface.includes("acknowledgedSurfaceSnapshotRef.current = null;") &&
    loadSurface.includes("surfaceWriteReadyRevisionRef.current = -1;") &&
    loadSurface.includes("setSurfaceWriteReady(false);"),
  "a cached or failed surface must remain write-locked until WordPress confirms it",
);
assert.ok(
  loadSurface.includes("acknowledgedSurfaceSnapshotRef.current = next;") &&
    loadSurface.includes(
      "surfaceWriteReadyRevisionRef.current = next.workspaceRevision;",
    ) &&
    loadSurface.includes("setSurfaceWriteReady(true);"),
  "a network-confirmed surface must establish the writable revision",
);

const persistFull = section(
  wordpressSource,
  "const persistFullProject = useCallback",
  "const commitFullProject = useCallback",
);
assert.ok(
  persistFull.includes("surfaceSnapshotRef.current = null;") &&
    persistFull.includes("acknowledgedSurfaceSnapshotRef.current = null;") &&
    persistFull.includes("setSurfaceSnapshot(null);"),
  "a full A/B save must invalidate the light UTM baseline",
);

const persistSurface = section(
  wordpressSource,
  "const persistAnalyticsSurfaceProject = useCallback",
  "const commitAnalyticsSurfaceProject = useCallback",
);
assert.ok(
  persistSurface.includes(
    "surfaceWriteReadyRevisionRef.current !== previous.workspaceRevision",
  ),
  "a light UTM save must enforce the acknowledged CAS revision",
);
assert.ok(
  persistSurface.includes("fullSnapshotRef.current = null;") &&
    persistSurface.includes("acknowledgedFullSnapshotRef.current = null;") &&
    persistSurface.includes("fullProjectRef.current = null;") &&
    persistSurface.includes("setFullSnapshot(null);"),
  "a light UTM save must invalidate the full A/B baseline",
);

assert.ok(
  wordpressSource.includes(
    "const utmReadOnly = readOnly || !config.projectDeltaUrl || !surfaceWriteReady;",
  ),
  "the UTM panel must stay read-only without a confirmed writable surface",
);
assert.ok(
  pluginSource.includes("private function analytics_viewer_project_metadata") &&
    pluginSource.includes(
      "foreach (['experiments', 'utmCenter', 'utms', 'utmCenterVersion'] as $key)",
    ) &&
    pluginSource.includes("$surface === 'analytics'") &&
    pluginSource.includes("$relative === '.incode/project.json'"),
  "Analytics viewers must receive only the sanitized experiment/UTM metadata instead of the full project metadata",
);

assert.ok(
  /const enabled = attributes\[["']data-kodety-utm-enabled["']\] === ["']true["'];/.test(
    formSettingsSource,
  ) &&
    /["']data-kodety-utm-enabled["']:\s*["']true["']/.test(
      formSettingsSource,
    ) &&
    /["']data-kodety-utm-enabled["']:\s*["']["']/.test(formSettingsSource),
  "form UTM behavior must remain explicit opt-in and removable",
);
assert.ok(
  formSettingsSource.includes("forwardUtms: false") &&
    formSettingsSource.includes("rememberSession: false"),
  "new form UTM configurations must default to no forwarding or session memory",
);
assert.ok(
  centerSource.includes("formPagesFromProject(project)") &&
    centerSource.includes("Página de referência") &&
    centerSource.includes("Formulário de referência") &&
    centerSource.includes("selectedFields.map((field) => field.name)"),
  "the Central must discover forms by page and feed only the selected form fields into suggestions",
);
assert.ok(
  formFieldsSource.includes("export function formsFromMarkup") &&
    formFieldsSource.includes("export function formPagesFromProject") &&
    formFieldsSource.includes("data-kodety-form-name"),
  "page discovery must preserve separate named forms instead of flattening every field on a page",
);
assert.ok(
  centerSource.includes("<HtmlUtmMappingControl") &&
    formSettingsSource.includes("<HtmlUtmMappingControl") &&
    mappingControlSource.includes("data-kodety-utm-mapping") &&
    mappingControlSource.includes("Destino no checkout") &&
    mappingControlSource.includes("Valor vem de") &&
    mappingControlSource.includes("Como tratar") &&
    mappingControlSource.includes("Se já existir"),
  "Central and form settings must share the same four-step compound mapping control",
);
assert.ok(
  globalCssSource.includes("@container (max-width: 235px)") &&
    globalCssSource.includes("[data-kodety-utm-source-composite]") &&
    globalCssSource.includes("flex-direction: column;"),
  "the compound mapping must retain readable source controls at the 224px inspector width",
);

const customAttributes = section(
  inspectorSource,
  "const customAttributes =",
  "const formStepCount =",
);
assert.ok(
  customAttributes.includes("'data-kodety-utm-enabled'") &&
    customAttributes.includes("'data-kodety-utm-config'"),
  "managed UTM attributes must not be duplicated in the generic custom-attributes editor",
);
assert.ok(
  inspectorSource.includes(
    "selection.attributes['data-kodety-utm-enabled'] !== 'true'",
  ) && inspectorSource.includes("<HtmlFormUtmSettings"),
  "the form inspector must keep simple redirect and opt-in UTM settings mutually coherent",
);

const persistCenter = section(
  centerSource,
  "const persist = (",
  "const createProfile =",
);
assertInOrder(
  persistCenter,
  "await onFlush?.(nextProject);",
  "setSavedSignature(candidateSignature);",
  "the Central must remain dirty until the persistence flush is acknowledged",
);
assert.ok(
  centerSource.includes(
    "if (nextSignature === optimisticSignatureRef.current) return;",
  ),
  "an optimistic project prop update must not masquerade as a persistence acknowledgement",
);
assert.ok(
  centerSource.includes("settings.profiles.length >= MAX_UTM_PROFILES"),
  "the Central UI must enforce the shared profile limit before creating another item",
);

const server = await createServer({
  root,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const utm = await server.ssrLoadModule("/lib/html-editor/utm.ts");
  assert.equal(
    utm.MAX_UTM_PROFILES,
    250,
    "the UTM profile limit is part of the persisted schema contract",
  );
  const normalized = utm.normalizeUtmCenterSettings({
    profiles: Array.from({ length: 251 }, (_, index) => ({
      id: `profile-${index}`,
      name: `Profile ${index}`,
      kind: "link",
      baseUrl: `https://example.test/${index}`,
    })),
  });
  assert.equal(
    normalized.profiles.length,
    250,
    "normalization must cap persisted UTM profiles at 250",
  );
} finally {
  await server.close();
}

console.log("UTM workspace contract tests passed.");
