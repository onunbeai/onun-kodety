"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Braces,
  Check,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FileText,
  FormInput,
  Link2,
  Plus,
  Route,
  Save,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
} from "@/components/ui/gravity-icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildTrackedUrl,
  CHECKOUT_PROVIDER_PRESETS,
  checkoutTemplatePreview,
  createUtmMapping,
  createUtmProfile,
  decodeTrackedUrl,
  MAX_UTM_MAPPINGS,
  MAX_UTM_PROFILES,
  normalizeUtmCenterSettings,
  providerSuggestedMappings,
  readUtmCenterSettings,
  STANDARD_UTM_KEYS,
  validQueryParameterName,
  writeUtmCenterSettings,
  type CheckoutProvider,
  type StandardUtmKey,
  type UtmCenterSettings,
  type UtmParameterMapping,
  type UtmProfileKind,
  type UtmSavedProfile,
} from "@/lib/html-editor/utm";
import type { HtmlProject } from "@/lib/html-editor/types";
import {
  formPagesFromProject,
  type CmsFormField,
} from "@/lib/html-editor/form-fields";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AnalyticsEmptyState,
  AnalyticsPlanBanner,
  AnalyticsPageHeader,
  AnalyticsSectionHeader,
  AnalyticsSurface,
} from "./HtmlAnalyticsUi";
import {
  HtmlSettingsSelectControl,
  HtmlSettingsTextControl,
  HtmlSettingsToggleControl,
} from "./HtmlSettingsControls";
import { HtmlUtmMappingControl } from "./HtmlUtmMappingControl";

export interface HtmlProjectAnalyticsUtmsProps {
  readOnly?: boolean;
  /** Keeps authoring available while preventing operational use on Free. */
  activationLocked?: boolean;
  licenseUrl?: string;
  upgradeUrl?: string;
  project: HtmlProject;
  getProject?: () => HtmlProject;
  onCommit: (project: HtmlProject) => void;
  onFlush?: (project: HtmlProject) => Promise<void>;
}

type CenterMode = "library" | "decoder";

const UTM_LABELS: Record<StandardUtmKey, { label: string; hint: string }> = {
  utm_source: { label: "Origem", hint: "instagram, google, newsletter" },
  utm_medium: { label: "Canal", hint: "social, cpc, email" },
  utm_campaign: { label: "Campanha", hint: "lancamento-agosto" },
  utm_content: { label: "Conteúdo", hint: "stories-01, banner-topo" },
  utm_term: { label: "Termo", hint: "curso-marketing" },
};

function settingsSignature(settings: UtmCenterSettings) {
  return JSON.stringify(settings);
}

function mappingRecipeSignature(mappings: UtmParameterMapping[]) {
  return JSON.stringify(
    mappings.map(
      ({ parameter, source, sourceKey, value, transform, conflict }) => ({
        parameter,
        source,
        sourceKey,
        value,
        transform,
        conflict,
      }),
    ),
  );
}

function profileHasErrors(profile: UtmSavedProfile) {
  if (!profile.name.trim() || !profile.baseUrl.trim()) return true;
  const built =
    profile.kind === "link"
      ? buildTrackedUrl(profile.baseUrl, profile.parameters)
      : checkoutTemplatePreview(profile);
  if (!built) return true;
  if (profile.kind !== "checkout") return false;
  const seen = new Set<string>();
  return profile.mappings.some((mapping) => {
    const parameter = mapping.parameter.trim().toLocaleLowerCase();
    if (!validQueryParameterName(mapping.parameter) || seen.has(parameter))
      return true;
    seen.add(parameter);
    if (mapping.source === "field" || mapping.source === "query")
      return !mapping.sourceKey.trim();
    if (mapping.source === "utm")
      return !STANDARD_UTM_KEYS.includes(mapping.sourceKey as StandardUtmKey);
    return !mapping.value.trim();
  });
}

function copyText(value: string, label: string) {
  if (!value) return;
  navigator.clipboard
    ?.writeText(value)
    .then(() => toast.success(label))
    .catch(() => toast.error("Não foi possível copiar."));
}

function SegmentedMode({
  value,
  onChange,
}: {
  value: CenterMode;
  onChange: (value: CenterMode) => void;
}) {
  const modes: CenterMode[] = ["library", "decoder"];
  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    mode: CenterMode,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = modes.indexOf(mode);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? modes.length - 1
          : (currentIndex +
              (event.key === "ArrowRight" ? 1 : -1) +
              modes.length) %
            modes.length;
    const nextMode = modes[nextIndex];
    onChange(nextMode);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      );
    tabs?.[nextIndex]?.focus();
  };
  return (
    <div
      className="inline-flex h-8 min-w-0 rounded-[8px] bg-white/[.055] p-[3px]"
      role="tablist"
      aria-label="Ferramentas UTM"
    >
      {(
        [
          ["library", "Biblioteca", Link2],
          ["decoder", "Decodificar", Braces],
        ] as const
      ).map(([mode, label, Icon]) => (
        <button
          key={mode}
          type="button"
          role="tab"
          id={`kodety-utm-${mode}-tab`}
          aria-controls={`kodety-utm-${mode}-panel`}
          aria-selected={value === mode}
          tabIndex={value === mode ? 0 : -1}
          onClick={() => onChange(mode)}
          onKeyDown={(event) => handleKeyDown(event, mode)}
          className={cn(
            "flex h-[26px] min-w-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[10px] font-medium outline-none transition-[background-color,color] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]/70",
            value === mode
              ? "bg-white/[.13] text-[var(--kodety-text)]"
              : "text-[var(--kodety-text-tertiary)] hover:bg-white/[.055] hover:text-[var(--kodety-text-secondary)]",
          )}
        >
          <Icon className="size-3" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

function LabeledControl({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <label className="truncate text-[10px] font-medium text-[var(--kodety-text-secondary)]">
          {label}
        </label>
        {hint ? (
          <span className="truncate text-[8px] text-[var(--kodety-text-tertiary)]">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function mappingFieldSummary(fields: CmsFormField[]) {
  const names = fields.map((field) => field.name);
  const visible = names.slice(0, 5).join(" · ");
  return names.length > 5 ? `${visible} · +${names.length - 5}` : visible;
}

function MappingEditor({
  mappings,
  provider,
  project,
  readOnly,
  onChange,
}: {
  mappings: UtmParameterMapping[];
  provider: CheckoutProvider;
  project: HtmlProject;
  readOnly: boolean;
  onChange: (mappings: UtmParameterMapping[]) => void;
}) {
  const preset = CHECKOUT_PROVIDER_PRESETS[provider];
  const pages = useMemo(
    () => formPagesFromProject(project),
    [project.files, project.mainHtmlPath],
  );
  const preferredPage =
    pages.find(
      (page) => page.path === project.mainHtmlPath && page.forms.length,
    ) ||
    pages.find((page) => page.forms.length) ||
    pages.find((page) => page.path === project.mainHtmlPath) ||
    pages[0];
  const [requestedPagePath, setRequestedPagePath] = useState("");
  const [requestedFormId, setRequestedFormId] = useState("");
  const selectedPage =
    pages.find((page) => page.path === requestedPagePath) || preferredPage;
  const selectedForm =
    selectedPage?.forms.find((form) => form.id === requestedFormId) ||
    selectedPage?.forms[0];
  const selectedFields = selectedForm?.fields;
  const formSuggestions = useMemo(
    () =>
      selectedFields
        ? providerSuggestedMappings(
            provider,
            selectedFields.map((field) => field.name),
          )
        : [],
    [provider, selectedFields],
  );

  const update = (id: string, patch: Partial<UtmParameterMapping>) => {
    onChange(
      mappings.map((mapping) =>
        mapping.id === id ? { ...mapping, ...patch } : mapping,
      ),
    );
  };
  const replaceMappings = (next: UtmParameterMapping[], question: string) => {
    if (mappings.length && !window.confirm(question)) return;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-[var(--kodety-text-secondary)]">
            Campos enviados ao checkout
          </p>
          <p className="mt-0.5 text-[9px] leading-4 text-[var(--kodety-info-copy)]">
            Leia da esquerda para a direita: destino → origem → tratamento →
            regra · {mappings.length}/{MAX_UTM_MAPPINGS}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {provider !== "custom" ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={readOnly}
              onClick={() =>
                replaceMappings(
                  providerSuggestedMappings(provider),
                  `Substituir o mapeamento atual pelo preset de ${preset.label}?`,
                )
              }
            >
              <Route />
              Preset {preset.label}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly || mappings.length >= MAX_UTM_MAPPINGS}
            title={
              mappings.length >= MAX_UTM_MAPPINGS
                ? `Limite de ${MAX_UTM_MAPPINGS} mapeamentos atingido`
                : undefined
            }
            onClick={() => onChange([...mappings, createUtmMapping()])}
          >
            <Plus />
            Adicionar campo
          </Button>
        </div>
      </div>

      <div className="rounded-[9px] border border-white/[.055] bg-white/[.022] p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.05] text-white/38">
            <FormInput className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium text-[var(--kodety-text-secondary)]">
              Usar um formulário existente como referência
            </p>
            <p className="mt-0.5 text-[9px] leading-4 text-[var(--kodety-info-copy)]">
              Escolha a página e o formulário. O modelo continua reutilizável;
              usamos apenas os nomes reais dos campos para sugerir o mapeamento.
            </p>
          </div>
        </div>

        <div
          data-kodety-settings-control
          className="mt-3 grid min-w-0 overflow-hidden rounded-[9px] border border-transparent bg-white/[.05] transition-[background-color,border-color] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065] sm:grid-cols-[minmax(0,.95fr)_minmax(0,1.05fr)_auto]"
        >
          <div className="min-w-0 px-2.5 py-1.5">
            <span className="flex h-4 items-center gap-1 text-[8px] font-medium uppercase tracking-[.055em] text-[var(--kodety-text-tertiary)]">
              <FileText className="size-2.5 text-white/28" /> Página
            </span>
            <Select
              value={selectedPage?.path}
              disabled={!pages.length}
              onValueChange={(path) => {
                setRequestedPagePath(path);
                setRequestedFormId("");
              }}
            >
              <SelectTrigger
                data-kodety-settings-control-inner
                aria-label="Página de referência"
                className="h-7 min-w-0 rounded-[6px] border-0 bg-transparent px-1.5 text-[10px] shadow-none hover:bg-white/[.045] focus-visible:ring-0"
              >
                <SelectValue placeholder="Nenhuma página disponível" />
              </SelectTrigger>
              <SelectContent align="start">
                {pages.map((page) => (
                  <SelectItem key={page.path} value={page.path}>
                    <span className="min-w-0 truncate">{page.label}</span>
                    <span className="ml-1 text-[8px] text-white/35">
                      {page.forms.length
                        ? `${page.forms.length} form${page.forms.length === 1 ? "" : "s"}`
                        : "sem form"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 border-t border-white/[.055] px-2.5 py-1.5 sm:border-l sm:border-t-0">
            <span className="flex h-4 items-center gap-1 text-[8px] font-medium uppercase tracking-[.055em] text-[var(--kodety-text-tertiary)]">
              <FormInput className="size-2.5 text-white/28" /> Formulário
              encontrado
            </span>
            <Select
              value={selectedForm?.id}
              disabled={!selectedPage?.forms.length}
              onValueChange={setRequestedFormId}
            >
              <SelectTrigger
                data-kodety-settings-control-inner
                aria-label="Formulário de referência"
                className="h-7 min-w-0 rounded-[6px] border-0 bg-transparent px-1.5 text-[10px] shadow-none hover:bg-white/[.045] focus-visible:ring-0"
              >
                <SelectValue placeholder="Nenhum formulário nesta página" />
              </SelectTrigger>
              <SelectContent align="start">
                {selectedPage?.forms.map((form) => (
                  <SelectItem key={form.id} value={form.id}>
                    <span className="min-w-0 truncate">{form.label}</span>
                    <span className="ml-1 text-[8px] text-white/35">
                      {form.fields.length} campo
                      {form.fields.length === 1 ? "" : "s"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            type="button"
            disabled={readOnly || !formSuggestions.length}
            onClick={() =>
              replaceMappings(
                formSuggestions,
                `Substituir o mapeamento atual pelas sugestões de “${selectedForm?.label || "formulário"}”?`,
              )
            }
            className="flex min-h-11 items-center justify-center gap-1.5 border-t border-white/[.055] px-3 text-[9px] font-medium text-[var(--kodety-text-secondary)] outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-accent-hover)] disabled:cursor-not-allowed disabled:text-[var(--kodety-text-disabled)] sm:border-l sm:border-t-0"
          >
            <Sparkles className="size-3" />
            Gerar sugestões
          </button>

          <div className="min-w-0 border-t border-white/[.055] px-2.5 py-2 text-[8px] leading-3 text-[var(--kodety-info-copy)] sm:col-span-3">
            {selectedFields?.length ? (
              <>
                <span className="font-medium text-[var(--kodety-text-tertiary)]">
                  {selectedFields.length} campo
                  {selectedFields.length === 1 ? "" : "s"} detectado
                  {selectedFields.length === 1 ? "" : "s"}:
                </span>{" "}
                <code className="break-words text-[var(--kodety-text-secondary)]">
                  {mappingFieldSummary(selectedFields)}
                </code>
                {!formSuggestions.length ? (
                  <span className="ml-1 text-[var(--kodety-warning)]">
                    Nenhum coincide com o preset atual; você ainda pode mapear
                    manualmente.
                  </span>
                ) : null}
              </>
            ) : selectedPage ? (
              "Nenhum formulário com campos nomeados foi encontrado nesta página."
            ) : (
              "O source das páginas não está disponível neste modo de acesso."
            )}
          </div>
        </div>
      </div>

      {!mappings.length ? (
        <div className="rounded-[9px] border border-dashed border-white/[.08] px-4 py-5 text-center">
          <p className="text-[10px] text-[var(--kodety-text-secondary)]">
            Nenhum campo será enviado ao checkout.
          </p>
          <p className="mt-1 text-[9px] text-[var(--kodety-info-copy)]">
            Use um formulário como referência, aplique o preset ou adicione um
            campo manualmente.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {mappings.map((mapping, index) => {
            const duplicate =
              Boolean(mapping.parameter) &&
              mappings.filter(
                (item) =>
                  item.parameter.trim().toLocaleLowerCase() ===
                  mapping.parameter.trim().toLocaleLowerCase(),
              ).length > 1;
            return (
              <HtmlUtmMappingControl
                key={mapping.id}
                mapping={mapping}
                index={index}
                provider={provider}
                fields={selectedFields}
                readOnly={readOnly}
                duplicate={duplicate}
                onChange={(patch) => update(mapping.id, patch)}
                onRemove={() =>
                  onChange(mappings.filter((item) => item.id !== mapping.id))
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileList({
  settings,
  selectedId,
  search,
  onSearch,
  onSelect,
}: {
  settings: UtmCenterSettings;
  selectedId: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const filtered = settings.profiles.filter((profile) =>
    `${profile.name} ${profile.baseUrl} ${profile.provider}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase().trim()),
  );
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-b border-[var(--kodety-divider)] md:border-b-0 md:border-r">
      <div className="border-b border-[var(--kodety-divider)] p-2.5">
        <div className="flex h-8 min-w-0 items-center overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-colors focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]">
          <span className="grid h-full w-8 shrink-0 place-items-center border-r border-white/[.05] text-white/30">
            <Search className="size-3.5" />
          </span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Buscar links e checkouts…"
            aria-label="Buscar na Central de UTMs"
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[10px] text-[var(--kodety-text)] outline-none placeholder:text-white/28"
          />
        </div>
      </div>
      <div className="max-h-56 min-h-0 overflow-y-auto p-2 md:max-h-none md:flex-1">
        {filtered.length ? (
          <div className="space-y-1">
            {filtered.map((profile) => {
              const active = profile.id === selectedId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(profile.id)}
                  className={cn(
                    "group relative flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]/70",
                    active ? "bg-white/[.085]" : "hover:bg-white/[.045]",
                  )}
                >
                  {active ? (
                    <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-[var(--kodety-accent-hover)]" />
                  ) : null}
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-[7px] bg-white/[.045]",
                      active
                        ? "text-[var(--kodety-accent-hover)]"
                        : "text-white/32 group-hover:text-white/52",
                    )}
                  >
                    {profile.kind === "checkout" ? (
                      <ShoppingCart className="size-3.5" />
                    ) : (
                      <Link2 className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-medium text-[var(--kodety-text-secondary)]">
                      {profile.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[8px] text-[var(--kodety-info-copy)]">
                      {profile.kind === "checkout"
                        ? CHECKOUT_PROVIDER_PRESETS[profile.provider].label
                        : profile.baseUrl || "Sem destino"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-8 text-center text-[9px] leading-4 text-[var(--kodety-info-copy)]">
            Nenhum item corresponde à busca.
          </p>
        )}
      </div>
    </aside>
  );
}

function DecoderPanel() {
  const [value, setValue] = useState("");
  const decoded = useMemo(() => decodeTrackedUrl(value), [value]);
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5 lg:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <AnalyticsPageHeader
          icon={Braces}
          title="Decodificador de links"
          description="Cole qualquer URL para separar destino, UTMs e parâmetros adicionais sem alterar o link."
        />
        <AnalyticsSurface onboardingId="analytics-utm-decode" className="p-4 sm:p-5">
          <LabeledControl label="Link para decodificar" hint="http ou https">
            <HtmlSettingsTextControl
              value={value}
              onChange={setValue}
              label="Link para decodificar"
              kind="link"
              placeholder="https://seudominio.com/pagina?utm_source=meta"
            />
          </LabeledControl>
        </AnalyticsSurface>
        {value && !decoded ? (
          <div
            role="alert"
            className="rounded-[9px] border border-[var(--kodety-danger)]/25 bg-[var(--kodety-danger)]/[.05] px-4 py-3 text-[10px] text-[var(--kodety-danger)]"
          >
            Informe uma URL completa e válida.
          </div>
        ) : decoded ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,.65fr)]">
            <AnalyticsSurface className="p-4 sm:p-5">
              <AnalyticsSectionHeader
                icon={Route}
                title="Destino"
                description={decoded.baseUrl}
              />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {STANDARD_UTM_KEYS.map((key) => (
                  <div
                    key={key}
                    className="min-w-0 rounded-[8px] bg-white/[.035] px-3 py-2.5"
                  >
                    <p className="font-mono text-[8px] text-[var(--kodety-text-tertiary)]">
                      {key}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-[var(--kodety-text-secondary)]">
                      {decoded.parameters[key] || "—"}
                    </p>
                  </div>
                ))}
              </div>
            </AnalyticsSurface>
            <AnalyticsSurface className="p-4 sm:p-5">
              <AnalyticsSectionHeader
                icon={Braces}
                title="Outros parâmetros"
                description={`${decoded.extras.length} encontrado${decoded.extras.length === 1 ? "" : "s"}`}
              />
              <div className="mt-3 space-y-1.5">
                {decoded.extras.length ? (
                  decoded.extras.map(([key, entry], index) => (
                    <div
                      key={`${key}-${index}`}
                      className="flex min-w-0 items-center gap-2 rounded-[7px] bg-white/[.035] px-2.5 py-2 text-[9px]"
                    >
                      <code className="shrink-0 text-[var(--kodety-text-tertiary)]">
                        {key}
                      </code>
                      <ArrowRight className="size-3 shrink-0 text-white/20" />
                      <span className="min-w-0 flex-1 truncate text-[var(--kodety-text-secondary)]">
                        {entry}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[9px] text-[var(--kodety-info-copy)]">
                    Nenhum parâmetro adicional.
                  </p>
                )}
              </div>
            </AnalyticsSurface>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProfileEditor({
  profile,
  project,
  readOnly,
  activationLocked,
  onChange,
  onDuplicate,
  onDelete,
  canDuplicate,
}: {
  profile: UtmSavedProfile;
  project: HtmlProject;
  readOnly: boolean;
  activationLocked: boolean;
  onChange: (patch: Partial<UtmSavedProfile>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDuplicate: boolean;
}) {
  const generated =
    profile.kind === "link"
      ? buildTrackedUrl(profile.baseUrl, profile.parameters)
      : checkoutTemplatePreview(profile);
  const preset = CHECKOUT_PROVIDER_PRESETS[profile.provider];
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-5 lg:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-white/[.045] text-white/38">
            {profile.kind === "checkout" ? (
              <ShoppingCart className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <input
              value={profile.name}
              disabled={readOnly}
              aria-label="Nome do item"
              onChange={(event) => onChange({ name: event.target.value })}
              className="h-7 w-full min-w-0 border-0 bg-transparent p-0 text-[16px] font-semibold tracking-[-.02em] text-[var(--kodety-text)] outline-none placeholder:text-white/25 disabled:opacity-60"
            />
            <p className="mt-0.5 text-[9px] leading-4 text-[var(--kodety-info-copy)]">
              {profile.kind === "checkout"
                ? "Modelo reutilizável para redirects de formulário."
                : "Link com UTMs explícitas, pronto para divulgação."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Duplicar item"
                  disabled={readOnly || !canDuplicate}
                  onClick={onDuplicate}
                >
                  <Copy />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canDuplicate
                  ? "Duplicar"
                  : `Limite de ${MAX_UTM_PROFILES} itens atingido`}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remover item"
                  disabled={readOnly}
                  onClick={onDelete}
                  className="hover:text-[var(--kodety-danger)]"
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remover</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <AnalyticsSurface onboardingId="analytics-utm-destination" className="p-4 sm:p-5">
          <AnalyticsSectionHeader
            icon={Route}
            title={
              profile.kind === "checkout"
                ? "Destino do checkout"
                : "Destino principal"
            }
            description="Parâmetros já existentes, repetições desconhecidas e o fragmento do link serão preservados."
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <LabeledControl label="URL base" hint="https://">
              <HtmlSettingsTextControl
                value={profile.baseUrl}
                onChange={(value) => onChange({ baseUrl: value })}
                label="URL base"
                kind="link"
                placeholder={
                  profile.kind === "checkout"
                    ? "https://checkout.exemplo.com/oferta"
                    : "https://seudominio.com/pagina"
                }
                disabled={readOnly}
              />
            </LabeledControl>
            {profile.kind === "checkout" ? (
              <LabeledControl label="Plataforma" hint="preset editável">
                <HtmlSettingsSelectControl
                  value={profile.provider}
                  onChange={(value) => {
                    const provider = value as CheckoutProvider;
                    const currentDefault = providerSuggestedMappings(
                      profile.provider,
                    );
                    const usingProviderDefault =
                      mappingRecipeSignature(profile.mappings) ===
                      mappingRecipeSignature(currentDefault);
                    const mappings = usingProviderDefault
                      ? providerSuggestedMappings(provider)
                      : profile.mappings;
                    onChange({ provider, mappings });
                    if (
                      !usingProviderDefault &&
                      provider !== profile.provider
                    ) {
                      toast.info(
                        `Mapeamento personalizado preservado. Revise os parâmetros ou aplique as sugestões de ${CHECKOUT_PROVIDER_PRESETS[provider].label}.`,
                      );
                    }
                  }}
                  label="Plataforma"
                  kind="option"
                  disabled={readOnly}
                  allowUnset={false}
                  options={Object.values(CHECKOUT_PROVIDER_PRESETS).map(
                    (option) => ({ value: option.id, label: option.label }),
                  )}
                />
              </LabeledControl>
            ) : (
              <div />
            )}
          </div>
        </AnalyticsSurface>

        {profile.kind === "link" ? (
          <AnalyticsSurface onboardingId="analytics-utm-parameters" className="p-4 sm:p-5">
            <AnalyticsSectionHeader
              icon={Link2}
              title="Parâmetros de rastreamento"
              description="Origem, canal e campanha identificam a divulgação; conteúdo e termo refinam criativo ou palavra-chave."
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {STANDARD_UTM_KEYS.map((key, index) => (
                <LabeledControl
                  key={key}
                  label={UTM_LABELS[key].label}
                  hint={key}
                >
                  <HtmlSettingsTextControl
                    value={profile.parameters[key]}
                    onChange={(value) =>
                      onChange({
                        parameters: { ...profile.parameters, [key]: value },
                      })
                    }
                    label={UTM_LABELS[key].label}
                    kind="tracking"
                    placeholder={UTM_LABELS[key].hint}
                    disabled={readOnly}
                    className={index === 0 ? "sm:col-span-2" : undefined}
                  />
                </LabeledControl>
              ))}
            </div>
          </AnalyticsSurface>
        ) : (
          <>
            <AnalyticsSurface onboardingId="analytics-utm-attribution" className="p-4 sm:p-5">
              <AnalyticsSectionHeader
                icon={ShoppingCart}
                title={`Preset ${preset.label}`}
                description={preset.description}
                action={
                  preset.documentationUrl ? (
                    <Button asChild variant="ghost" size="xs">
                      <a
                        href={preset.documentationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Critérios oficiais
                        <ExternalLink />
                      </a>
                    </Button>
                  ) : undefined
                }
              />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <HtmlSettingsToggleControl
                  label="Repassar UTMs recebidas"
                  description={activationLocked
                    ? "Disponível com uma licença Pro ativa. O rascunho permanece salvo."
                    : `Somente ${preset.supportedUtms.join(", ")}; valores já existentes são mantidos.`}
                  kind="tracking"
                  checked={activationLocked ? false : profile.forwardUtms}
                  disabled={readOnly || activationLocked}
                  onChange={(forwardUtms) => {
                    if (!activationLocked) onChange({ forwardUtms });
                  }}
                />
                <HtmlSettingsToggleControl
                  label="Lembrar nesta sessão"
                  description={activationLocked
                    ? "Disponível com uma licença Pro ativa. A memória de sessão não será executada."
                    : "Mantém a atribuição entre páginas da mesma sessão, quando disponível."}
                  kind="time"
                  checked={activationLocked ? false : profile.rememberSession}
                  disabled={readOnly || activationLocked}
                  onChange={(rememberSession) => {
                    if (!activationLocked) onChange({ rememberSession });
                  }}
                />
              </div>
              <div className="mt-3 rounded-[8px] border border-[var(--kodety-warning)]/20 bg-[var(--kodety-warning)]/[.045] px-3 py-2.5 text-[9px] leading-4 text-[var(--kodety-info-copy)]">
                Nome, e-mail, telefone, CPF e CEP ficam visíveis na URL e podem
                aparecer no histórico e no referrer. Mapeie apenas o necessário
                e nunca dados de pagamento.
              </div>
            </AnalyticsSurface>
            <AnalyticsSurface onboardingId="analytics-utm-mapping" className="p-4 sm:p-5">
              <MappingEditor
                mappings={profile.mappings}
                provider={profile.provider}
                project={project}
                readOnly={readOnly}
                onChange={(mappings) => onChange({ mappings })}
              />
            </AnalyticsSurface>
          </>
        )}

        <AnalyticsSurface className="p-4 sm:p-5">
          <AnalyticsSectionHeader
            icon={Check}
            title={
              profile.kind === "checkout" ? "Modelo gerado" : "Link gerado"
            }
            description={
              generated
                ? "Atualizado em tempo real e codificado uma única vez."
                : "Preencha uma URL completa para gerar a prévia."
            }
          />
          <div className="mt-3 flex min-w-0 overflow-hidden rounded-[9px] border border-transparent bg-white/[.05] focus-within:border-[var(--kodety-focus)]/70">
            <input
              readOnly
              value={activationLocked ? "" : generated}
              aria-label={
                profile.kind === "checkout"
                  ? "Modelo de checkout gerado"
                  : "Link UTM gerado"
              }
              placeholder={activationLocked ? "Prévia disponível com o Pro" : "O link aparecerá aqui"}
              className="h-9 min-w-0 flex-1 border-0 bg-transparent px-3 text-[10px] text-[var(--kodety-text-secondary)] outline-none placeholder:text-white/25"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Copiar link gerado"
                  disabled={activationLocked || !generated}
                  title={activationLocked ? "Ative uma licença Pro para copiar e usar este link" : undefined}
                  onClick={() =>
                    !activationLocked && copyText(
                      generated,
                      profile.kind === "checkout"
                        ? "Modelo copiado."
                        : "Link copiado.",
                    )
                  }
                  className="grid w-9 shrink-0 place-items-center border-l border-white/[.055] bg-black/[.07] text-white/36 outline-none hover:bg-white/[.055] hover:text-white/70 focus-visible:text-[var(--kodety-accent-hover)] disabled:opacity-30"
                >
                  <ClipboardCopy className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Copiar</TooltipContent>
            </Tooltip>
          </div>
          {profile.kind === "checkout" ? (
            <p className="mt-2 text-[8px] leading-3 text-[var(--kodety-info-copy)]">
              Os tokens da prévia representam valores resolvidos no navegador.
              No formulário, o mapeamento é persistido de forma estruturada —
              nenhum dado pessoal é salvo na Central.
            </p>
          ) : null}
        </AnalyticsSurface>
      </div>
    </div>
  );
}

export function HtmlProjectAnalyticsUtms({
  readOnly = false,
  activationLocked: _legacyActivationLocked = false,
  licenseUrl,
  upgradeUrl,
  project,
  getProject,
  onCommit,
  onFlush,
}: HtmlProjectAnalyticsUtmsProps) {
  const activationLocked = false;
  const projectSettings = useMemo(
    () => readUtmCenterSettings(project),
    [project],
  );
  const [settings, setSettings] = useState<UtmCenterSettings>(projectSettings);
  const [savedSignature, setSavedSignature] = useState(() =>
    settingsSignature(projectSettings),
  );
  const [selectedId, setSelectedId] = useState(
    projectSettings.profiles[0]?.id || "",
  );
  const [mode, setMode] = useState<CenterMode>("library");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const saveChainRef = useRef(Promise.resolve());
  const settingsRef = useRef(projectSettings);
  const profileCountRef = useRef(projectSettings.profiles.length);
  const optimisticSignatureRef = useRef("");

  useEffect(() => {
    settingsRef.current = settings;
    profileCountRef.current = settings.profiles.length;
  }, [settings]);

  const currentSignature = settingsSignature(settings);
  const dirty = currentSignature !== savedSignature;

  useEffect(() => {
    const nextSignature = settingsSignature(projectSettings);
    if (nextSignature === optimisticSignatureRef.current) return;
    if (currentSignature !== savedSignature) return;
    if (nextSignature === savedSignature) return;
    setSettings(projectSettings);
    setSavedSignature(nextSignature);
    setSelectedId((current) =>
      projectSettings.profiles.some((profile) => profile.id === current)
        ? current
        : projectSettings.profiles[0]?.id || "",
    );
  }, [currentSignature, projectSettings, savedSignature]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const selected =
    settings.profiles.find((profile) => profile.id === selectedId) || null;
  const invalid = settings.profiles.some(profileHasErrors);
  const persist = (
    candidate = settings,
    successMessage = "Central de UTMs salva.",
  ) => {
    if (candidate.profiles.length > MAX_UTM_PROFILES) {
      toast.error(`A Central aceita até ${MAX_UTM_PROFILES} itens.`);
      return Promise.resolve();
    }
    const normalized = normalizeUtmCenterSettings(candidate);
    const candidateSignature = settingsSignature(normalized);
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (readOnly)
          throw new Error("A Central de UTMs está em modo somente leitura.");
        if (!onFlush)
          throw new Error(
            "O salvamento da Central de UTMs não está disponível neste contexto.",
          );
        setSaving(true);
        const current = getProject?.() || project;
        const nextProject = writeUtmCenterSettings(current, normalized);
        optimisticSignatureRef.current = candidateSignature;
        onCommit(nextProject);
        await onFlush?.(nextProject);
        if (settingsSignature(settingsRef.current) === candidateSignature)
          setSettings(normalized);
        setSavedSignature(candidateSignature);
        optimisticSignatureRef.current = "";
        if (successMessage) toast.success(successMessage);
      })
      .catch((error) => {
        optimisticSignatureRef.current = "";
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a Central de UTMs.",
        );
      })
      .finally(() => setSaving(false));
    saveChainRef.current = operation.catch(() => undefined);
    return operation;
  };
  const createProfile = (kind: UtmProfileKind) => {
    if (profileCountRef.current >= MAX_UTM_PROFILES) {
      toast.error(`A Central aceita até ${MAX_UTM_PROFILES} itens.`);
      return;
    }
    const profile = createUtmProfile(kind);
    profileCountRef.current += 1;
    setSettings((current) => ({
      ...current,
      profiles: [...current.profiles, profile],
    }));
    setSelectedId(profile.id);
    setMode("library");
  };
  const updateSelected = (patch: Partial<UtmSavedProfile>) => {
    const updatedAt = new Date().toISOString();
    setSettings((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === selectedId
          ? { ...profile, ...patch, updatedAt }
          : profile,
      ),
    }));
  };
  const duplicateSelected = () => {
    if (!selected) return;
    if (profileCountRef.current >= MAX_UTM_PROFILES) {
      toast.error(`A Central aceita até ${MAX_UTM_PROFILES} itens.`);
      return;
    }
    const created = createUtmProfile(selected.kind, selected.provider);
    const copy = {
      ...selected,
      id: created.id,
      name: `${selected.name} · cópia`,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      mappings: selected.mappings.map((mapping) =>
        createUtmMapping({ ...mapping, id: undefined }),
      ),
    };
    profileCountRef.current += 1;
    setSettings((current) => ({
      ...current,
      profiles: [...current.profiles, copy],
    }));
    setSelectedId(copy.id);
  };
  const deleteSelected = () => {
    if (!selected || !window.confirm(`Remover “${selected.name}”?`)) return;
    const next = {
      ...settings,
      profiles: settings.profiles.filter(
        (profile) => profile.id !== selected.id,
      ),
    };
    profileCountRef.current = next.profiles.length;
    setSettings(next);
    setSelectedId(next.profiles[0]?.id || "");
  };

  return (
    <section
      data-kodety-utm-center
      data-kodety-onboarding="analytics-utms-body"
      data-kodety-onboarding-draft={dirty ? 'utm' : undefined}
      className="flex h-full min-h-0 flex-col bg-[var(--kodety-panel)]"
    >
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 border-b border-[var(--kodety-divider)] px-3 py-2">
        <SegmentedMode value={mode} onChange={setMode} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="xs"
            disabled={readOnly || settings.profiles.length >= MAX_UTM_PROFILES}
            onClick={() => createProfile("link")}
          >
            <Link2 />
            Novo link
          </Button>
          <Button
            variant="secondary"
            size="xs"
            disabled={readOnly || settings.profiles.length >= MAX_UTM_PROFILES}
            onClick={() => createProfile("checkout")}
          >
            <ShoppingCart />
            Novo checkout
          </Button>
          <Button
            size="xs"
            disabled={readOnly || !onFlush || saving || !dirty || invalid}
            onClick={() => void persist()}
          >
            <Save />
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
      {activationLocked ? (
        <div className="shrink-0 border-b border-[var(--kodety-divider)] px-3 py-3">
          <AnalyticsPlanBanner
            access={{
              licensed: false,
              historyDays: 7,
              pageInsights: false,
              funnels: false,
              abTests: false,
              utms: false,
              licenseUrl,
              upgradeUrl,
            }}
            compact
            title="Central de UTMs no plano Pro"
            description="Continue criando e salvando rascunhos. Repasse, memória de sessão, cópia de links gerados e aplicação em formulários exigem uma licença Pro ativa."
          />
        </div>
      ) : null}
      {dirty && invalid ? (
        <div
          role="alert"
          className="shrink-0 border-b border-[var(--kodety-danger)]/15 bg-[var(--kodety-danger)]/[.035] px-3 py-2 text-[9px] text-[var(--kodety-danger)]"
        >
          Revise a URL e os mapeamentos marcados antes de salvar.
        </div>
      ) : null}
      {mode === "decoder" ? (
        <div
          id="kodety-utm-decoder-panel"
          role="tabpanel"
          aria-labelledby="kodety-utm-decoder-tab"
          className="min-h-0 flex-1"
        >
          <DecoderPanel />
        </div>
      ) : (
        <div
          id="kodety-utm-library-panel"
          role="tabpanel"
          aria-labelledby="kodety-utm-library-tab"
          className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1"
        >
          <ProfileList
            settings={settings}
            selectedId={selectedId}
            search={search}
            onSearch={setSearch}
            onSelect={setSelectedId}
          />
          <div data-kodety-onboarding-navigation-draft={selected ? 'utm' : undefined} className="min-h-0 min-w-0">
            {selected ? (
              <ProfileEditor
                profile={selected}
                project={project}
                readOnly={readOnly}
                activationLocked={activationLocked}
                canDuplicate={settings.profiles.length < MAX_UTM_PROFILES}
                onChange={updateSelected}
                onDuplicate={duplicateSelected}
                onDelete={deleteSelected}
              />
            ) : (
              <AnalyticsEmptyState
                icon={Route}
                title="Sua biblioteca de UTMs começa aqui"
                description="Crie links rastreáveis ou modelos de checkout que depois podem ser aplicados visualmente aos formulários."
                className="h-full"
                action={
                  !readOnly ? (
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => createProfile("link")}
                      >
                        <Link2 />
                        Criar link
                      </Button>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => createProfile("checkout")}
                      >
                        <ShoppingCart />
                        Criar checkout
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
