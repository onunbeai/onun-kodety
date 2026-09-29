"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ClipboardCopy,
  ExternalLink,
  FormInput,
  Plus,
  ShoppingCart,
  Sparkles,
} from "@/components/ui/gravity-icons";
import {
  CHECKOUT_PROVIDER_PRESETS,
  checkoutConfigPreview,
  createUtmMapping,
  MAX_CHECKOUT_BASE_URL_LENGTH,
  MAX_UTM_MAPPINGS,
  normalizeFormUtmConfig,
  profileToFormUtmConfig,
  providerSuggestedMappings,
  serializeFormUtmConfig,
  type CheckoutProvider,
  type FormUtmConfig,
  type UtmParameterMapping,
  type UtmSavedProfile,
} from "@/lib/html-editor/utm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button as YcodeButton } from "../ycode-style/ui/button";
import {
  formFieldsFromMarkup,
  type CmsFormField,
} from "@/lib/html-editor/form-fields";
import {
  HtmlSettingsSelectControl,
  HtmlSettingsTextControl,
  HtmlSettingsToggleControl,
} from "./HtmlSettingsControls";
import { HtmlUtmMappingControl } from "./HtmlUtmMappingControl";
import {
  AnalyticsPlanBanner,
  resolveAnalyticsFeatureAccess,
  type AnalyticsFeatureAccess,
} from "./HtmlAnalyticsUi";

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

function validCheckoutBaseUrl(value: string) {
  if (!value.trim() || value.trim().length > MAX_CHECKOUT_BASE_URL_LENGTH)
    return false;
  try {
    const url = new URL(value.trim());
    return /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
}

function draftText(value: unknown, max: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max)
    : "";
}

function draftRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseFormUtmDraft(
  value: string,
  fallback: FormUtmConfig,
): FormUtmConfig {
  if (!value.trim()) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return fallback;
  const normalized = normalizeFormUtmConfig(parsed);
  const source = draftRecord(parsed);
  if (!Array.isArray(source.mappings)) return normalized;
  const usedIds = new Set<string>();
  const mappings = source.mappings
    .slice(0, MAX_UTM_MAPPINGS)
    .flatMap((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return [];
      const raw = draftRecord(entry);
      const normalizedEntry = normalizeFormUtmConfig({
        provider: normalized.provider,
        mappings: [entry],
      }).mappings[0];
      const base =
        normalizedEntry ||
        createUtmMapping({ id: draftText(raw.id, 96) || `draft-${index + 1}` });
      const rawParameter = raw.parameter ?? raw.target;
      const preferredId = base.id || `draft-${index + 1}`;
      let id = preferredId;
      let suffix = 2;
      while (usedIds.has(id)) id = `${preferredId}-${suffix++}`;
      usedIds.add(id);
      return [
        {
          ...base,
          id,
          parameter:
            typeof rawParameter === "string"
              ? draftText(rawParameter, 64).replace(/\s/g, "")
              : base.parameter,
          sourceKey:
            typeof raw.sourceKey === "string"
              ? draftText(raw.sourceKey, 128)
              : base.sourceKey,
          value:
            typeof raw.value === "string"
              ? draftText(raw.value, 1_000)
              : base.value,
        },
      ];
    });
  return { ...normalized, mappings };
}

function serializeFormUtmDraft(config: FormUtmConfig) {
  return JSON.stringify({
    ...config,
    mappings: config.mappings.slice(0, MAX_UTM_MAPPINGS),
  });
}

function createDraftMapping(
  provider: CheckoutProvider,
  mappings: UtmParameterMapping[],
  fields: CmsFormField[],
) {
  const used = new Set(
    mappings
      .map((mapping) => mapping.parameter.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  const presetParameter = CHECKOUT_PROVIDER_PRESETS[
    provider
  ].prefillParameters.find(
    (parameter) => !used.has(parameter.toLocaleLowerCase()),
  );
  let parameter = presetParameter || "parametro";
  let suffix = 2;
  while (used.has(parameter.toLocaleLowerCase()))
    parameter = `parametro_${suffix++}`;
  return createUtmMapping({
    parameter,
    source: "field",
    sourceKey: fields[0]?.name || "",
    transform: "trim",
  });
}

function copyPreview(value: string) {
  if (!value) return;
  navigator.clipboard
    ?.writeText(value)
    .then(() => toast.success("Modelo de checkout copiado."))
    .catch(() => toast.error("Não foi possível copiar."));
}

function MappingRow({
  mapping,
  index,
  provider,
  fields,
  readOnly,
  onChange,
  onRemove,
  duplicate,
}: {
  mapping: UtmParameterMapping;
  index: number;
  provider: CheckoutProvider;
  fields: CmsFormField[];
  readOnly: boolean;
  onChange: (patch: Partial<UtmParameterMapping>) => void;
  onRemove: () => void;
  duplicate: boolean;
}) {
  return (
    <HtmlUtmMappingControl
      mapping={mapping}
      index={index}
      provider={provider}
      fields={fields}
      readOnly={readOnly}
      duplicate={duplicate}
      onChange={onChange}
      onRemove={onRemove}
    />
  );
}

export function HtmlFormUtmSettings({
  attributes,
  selectedOuterHtml,
  profiles,
  readOnly = false,
  featureAccess: featureAccessOverride,
  onAttributesChange,
}: {
  attributes: Record<string, string>;
  selectedOuterHtml: string;
  profiles: UtmSavedProfile[];
  readOnly?: boolean;
  featureAccess?: AnalyticsFeatureAccess;
  onAttributesChange: (changes: Record<string, string>) => void;
}) {
  const featureAccess = resolveAnalyticsFeatureAccess(featureAccessOverride);
  const activationLocked = !featureAccess.utms;
  const enabled = attributes["data-kodety-utm-enabled"] === "true";
  const operationallyEnabled = enabled && !activationLocked;
  const storedConfig = attributes["data-kodety-utm-config"] || "";
  const fields = useMemo(
    () => formFieldsFromMarkup(selectedOuterHtml),
    [selectedOuterHtml],
  );
  const fieldNames = useMemo(() => fields.map((field) => field.name), [fields]);
  const config = useMemo<FormUtmConfig>(() => {
    const fallback = normalizeFormUtmConfig({
      provider: "hotmart",
      forwardUtms: false,
      rememberSession: false,
      mappings: providerSuggestedMappings("hotmart", fieldNames),
    });
    return parseFormUtmDraft(storedConfig, fallback);
  }, [fieldNames, storedConfig]);
  const provider = CHECKOUT_PROVIDER_PRESETS[config.provider];
  const checkoutProfiles = profiles.filter(
    (profile) => profile.kind === "checkout",
  );
  const baseUrl = attributes["data-kodety-redirect-url"] || "";
  const preview = checkoutConfigPreview(baseUrl, config);
  const invalidBaseUrl =
    Boolean(baseUrl.trim()) && !validCheckoutBaseUrl(baseUrl);
  const invalidConfig = Boolean(baseUrl.trim()) && !invalidBaseUrl && !preview;

  const commitConfig = (next: FormUtmConfig) => {
    if (readOnly || activationLocked) return;
    onAttributesChange({
      "data-kodety-utm-config": serializeFormUtmDraft(next),
    });
  };
  const updateMapping = (id: string, patch: Partial<UtmParameterMapping>) => {
    commitConfig({
      ...config,
      mappings: config.mappings.map((mapping) =>
        mapping.id === id ? { ...mapping, ...patch } : mapping,
      ),
    });
  };
  const applyProviderSuggestions = () => {
    const suggestions = providerSuggestedMappings(config.provider, fieldNames);
    if (!suggestions.length) {
      toast.warning(
        "Nenhum campo deste formulário coincide com o preset atual.",
      );
      return;
    }
    if (
      config.mappings.length &&
      !window.confirm(
        "Substituir o mapeamento atual usando os campos deste formulário?",
      )
    )
      return;
    commitConfig({
      ...config,
      profileId: undefined,
      mappings: suggestions,
    });
  };
  const applyProfile = (profileId: string) => {
    if (!profileId) {
      commitConfig({ ...config, profileId: undefined });
      return;
    }
    const profile = checkoutProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    onAttributesChange({
      "data-kodety-success-action": "redirect",
      "data-kodety-redirect-url": profile.baseUrl,
      "data-kodety-utm-config": serializeFormUtmConfig(
        profileToFormUtmConfig(profile),
      ),
    });
  };

  return (
    <div
      className="space-y-2.5"
      data-kodety-form-utm-settings
      onPointerDown={(event) => event.stopPropagation()}
    >
      <HtmlSettingsToggleControl
        label="Checkout pré-preenchido e UTMs"
        description={activationLocked
          ? "Recurso Pro. O redirect simples continua disponível."
          : "Ativável por formulário. Desligado mantém o redirect simples."}
        kind="tracking"
        checked={operationallyEnabled}
        disabled={readOnly || activationLocked}
        onChange={(checked) => {
          if (readOnly || activationLocked) return;
          onAttributesChange(
            checked
              ? {
                  "data-kodety-success-action": "redirect",
                  "data-kodety-utm-enabled": "true",
                  "data-kodety-utm-config": serializeFormUtmDraft(config),
                }
              : {
                  "data-kodety-utm-enabled": "",
                },
          );
        }}
      />

      {activationLocked ? (
        <AnalyticsPlanBanner
          access={featureAccess}
          compact
          showWhenLicensed
          title="Checkout e UTMs no plano Pro"
          description={enabled
            ? "A configuração existente está pausada. Ative uma licença Pro para voltar a aplicá-la neste formulário."
            : "Ative uma licença Pro para repassar UTMs, lembrar a atribuição e preencher o checkout automaticamente."}
        />
      ) : null}

      {operationallyEnabled ? (
        <div className="space-y-2.5 rounded-[10px] border border-white/[.055] bg-black/[.055] p-2.5">
          <div className="flex min-w-0 items-start gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-white/[.05] text-white/38">
              <ShoppingCart className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium text-foreground/90">
                Redirect inteligente
              </p>
              <p className="mt-0.5 text-[8px] leading-3 text-muted-foreground/80">
                Os valores são resolvidos somente após um envio aceito.
              </p>
            </div>
            {provider.documentationUrl ? (
              <a
                href={provider.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2 text-[8px] text-muted-foreground outline-none hover:bg-white/[.05] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]/70"
              >
                Critérios <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>

          {checkoutProfiles.length ? (
            <HtmlSettingsSelectControl
              value={config.profileId || ""}
              onChange={applyProfile}
              label="Modelo salvo na Central"
              kind="tracking"
              placeholder="Configurar neste formulário"
              disabled={readOnly}
              options={checkoutProfiles.map((profile) => ({
                value: profile.id,
                label: `${profile.name} · ${CHECKOUT_PROVIDER_PRESETS[profile.provider].label}`,
              }))}
            />
          ) : null}

          <div>
            <HtmlSettingsSelectControl
              value={config.provider}
              onChange={(value) => {
                const provider = value as CheckoutProvider;
                const currentDefault = providerSuggestedMappings(
                  config.provider,
                  fieldNames,
                );
                const usingProviderDefault =
                  mappingRecipeSignature(config.mappings) ===
                  mappingRecipeSignature(currentDefault);
                const mappings = usingProviderDefault
                  ? providerSuggestedMappings(provider, fieldNames)
                  : config.mappings;
                commitConfig({
                  ...config,
                  profileId: undefined,
                  provider,
                  mappings,
                });
                if (!usingProviderDefault && provider !== config.provider) {
                  toast.info(
                    `Mapeamento personalizado preservado. Revise os parâmetros ou aplique as sugestões de ${CHECKOUT_PROVIDER_PRESETS[provider].label}.`,
                  );
                }
              }}
              label="Plataforma do checkout"
              kind="option"
              allowUnset={false}
              disabled={readOnly}
              options={Object.values(CHECKOUT_PROVIDER_PRESETS).map(
                (option) => ({ value: option.id, label: option.label }),
              )}
            />
          </div>

          <HtmlSettingsTextControl
            value={baseUrl}
            onChange={(value) =>
              onAttributesChange({ "data-kodety-redirect-url": value })
            }
            label="URL do checkout"
            kind="link"
            placeholder="https://checkout.exemplo.com/oferta"
            disabled={readOnly}
          />
          {invalidBaseUrl ? (
            <p
              role="alert"
              className="px-1 text-[8px] leading-3 text-[var(--kodety-danger)]"
            >
              Informe uma URL completa em HTTP ou HTTPS.
            </p>
          ) : null}
          {invalidConfig ? (
            <p
              role="alert"
              className="px-1 text-[8px] leading-3 text-[var(--kodety-danger)]"
            >
              Revise os mapeamentos marcados antes de usar este redirect.
            </p>
          ) : null}
          {config.provider === "custom" ? (
            <p className="rounded-[8px] bg-white/[.035] px-2.5 py-2 text-[8px] leading-3 text-muted-foreground/85">
              Personalizado aceita qualquer checkout. Você define cada parâmetro
              e nenhuma query é copiada sem um mapeamento explícito.
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <HtmlSettingsToggleControl
              label="Repassar UTMs recebidas"
              description={`Allowlist: ${provider.supportedUtms.join(", ")}. Valores do checkout são preservados.`}
              kind="tracking"
              checked={config.forwardUtms}
              disabled={readOnly}
              onChange={(forwardUtms) =>
                commitConfig({ ...config, forwardUtms })
              }
            />
            <HtmlSettingsToggleControl
              label="Lembrar durante a sessão"
              description="Permite manter a atribuição ao navegar por outras páginas."
              kind="time"
              checked={config.rememberSession}
              disabled={readOnly}
              onChange={(rememberSession) =>
                commitConfig({ ...config, rememberSession })
              }
            />
          </div>

          <div className="space-y-1.5 pt-0.5">
            <div
              data-kodety-utm-mapping-heading
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-0.5"
            >
              <div className="min-w-0">
                <p className="text-[9px] font-medium text-foreground/85">
                  Campos enviados ao checkout
                </p>
                <p className="mt-0.5 text-[8px] leading-3 text-muted-foreground/75">
                  Destino → origem → tratamento → regra ·{" "}
                  {config.mappings.length}/{MAX_UTM_MAPPINGS}
                </p>
              </div>
              <div
                data-kodety-utm-mapping-toolbar
                className="ml-auto flex shrink-0 items-center gap-0.5"
              >
                <YcodeButton
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={readOnly}
                  onClick={applyProviderSuggestions}
                >
                  <Sparkles className="size-3" /> Mapear este form
                </YcodeButton>
                <YcodeButton
                  type="button"
                  size="xs"
                  variant="ghost"
                  title={
                    config.mappings.length >= MAX_UTM_MAPPINGS
                      ? `Limite de ${MAX_UTM_MAPPINGS} mapeamentos atingido`
                      : undefined
                  }
                  disabled={
                    readOnly || config.mappings.length >= MAX_UTM_MAPPINGS
                  }
                  onClick={() =>
                    commitConfig({
                      ...config,
                      mappings: [
                        ...config.mappings,
                        createDraftMapping(
                          config.provider,
                          config.mappings,
                          fields,
                        ),
                      ],
                    })
                  }
                >
                  <Plus className="size-3" /> Adicionar campo
                </YcodeButton>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2 rounded-[8px] bg-white/[.035] px-2.5 py-2">
              <FormInput className="size-3 shrink-0 text-white/32" />
              <div className="min-w-0 flex-1">
                <p className="text-[8px] text-muted-foreground/85">
                  {fields.length
                    ? `${fields.length} campo${fields.length === 1 ? "" : "s"} detectado${fields.length === 1 ? "" : "s"} neste formulário`
                    : "Nenhum campo nomeado foi encontrado neste formulário"}
                </p>
                {fieldNames.length ? (
                  <code className="mt-0.5 block truncate text-[8px] text-foreground/55">
                    {fieldNames.join(" · ")}
                  </code>
                ) : null}
              </div>
            </div>
            {config.mappings.length ? (
              config.mappings.map((mapping, index) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  index={index}
                  provider={config.provider}
                  fields={fields}
                  readOnly={readOnly}
                  duplicate={
                    Boolean(mapping.parameter) &&
                    config.mappings.filter(
                      (item) =>
                        item.parameter.trim().toLocaleLowerCase() ===
                        mapping.parameter.trim().toLocaleLowerCase(),
                    ).length > 1
                  }
                  onChange={(patch) => updateMapping(mapping.id, patch)}
                  onRemove={() =>
                    commitConfig({
                      ...config,
                      mappings: config.mappings.filter(
                        (item) => item.id !== mapping.id,
                      ),
                    })
                  }
                />
              ))
            ) : (
              <div className="rounded-[9px] border border-dashed border-white/[.07] px-3 py-4 text-center text-[8px] leading-3 text-muted-foreground/75">
                Nenhum dado pessoal será anexado. Adicione apenas o necessário.
              </div>
            )}
          </div>

          <div className="rounded-[9px] border border-[var(--kodety-warning)]/20 bg-[var(--kodety-warning)]/[.04] p-2.5">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--kodety-warning)]" />
              <p className="text-[8px] leading-3.5 text-muted-foreground/85">
                Nome, e-mail, telefone, CPF e CEP ficam visíveis na URL. Mapeie
                só o necessário e nunca dados de pagamento.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[9px] border border-transparent bg-white/[.05] focus-within:border-[var(--kodety-focus)]/65">
            <div className="flex h-8 min-w-0 items-stretch">
              <input
                readOnly
                value={preview}
                aria-label="Prévia do checkout configurado"
                placeholder="A prévia aparece com uma URL válida"
                className="min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[8px] text-foreground/70 outline-none placeholder:text-white/24"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Copiar prévia"
                    disabled={!preview}
                    onClick={() => copyPreview(preview)}
                    className="grid w-8 shrink-0 place-items-center border-l border-white/[.05] bg-black/[.06] text-white/32 outline-none hover:bg-white/[.05] hover:text-white/65 focus-visible:text-[var(--kodety-accent-hover)] disabled:opacity-30"
                  >
                    <ClipboardCopy className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copiar prévia</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
