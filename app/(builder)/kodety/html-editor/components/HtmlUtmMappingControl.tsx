"use client";

import type { ReactNode } from "react";
import { ArrowRight, Trash2 } from "@/components/ui/gravity-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CmsFormField } from "@/lib/html-editor/form-fields";
import {
  CHECKOUT_PROVIDER_PRESETS,
  STANDARD_UTM_KEYS,
  validQueryParameterName,
  type CheckoutProvider,
  type UtmMappingConflict,
  type UtmMappingSource,
  type UtmMappingTransform,
  type UtmParameterMapping,
} from "@/lib/html-editor/utm";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ycode-style/ui/select";

const SOURCE_OPTIONS: Array<{ value: UtmMappingSource; label: string }> = [
  { value: "field", label: "Campo do formulário" },
  { value: "utm", label: "UTM recebida" },
  { value: "query", label: "Query recebida" },
  { value: "fixed", label: "Valor fixo" },
  { value: "template", label: "Modelo composto" },
];

const TRANSFORM_OPTIONS: Array<{
  value: UtmMappingTransform;
  label: string;
}> = [
  { value: "none", label: "Sem tratamento" },
  { value: "trim", label: "Remover espaços externos" },
  { value: "digits", label: "Somente números" },
  { value: "phone_area", label: "Somente DDD" },
  { value: "phone_number", label: "Telefone sem DDD" },
  { value: "slug", label: "Converter em slug" },
];

const INNER_TRIGGER_CLASS =
  "h-7 min-w-0 rounded-[6px] border-0 bg-transparent px-1.5 text-[10px] shadow-none outline-none transition-colors hover:bg-white/[.045] focus-visible:border-transparent focus-visible:ring-0 data-[state=open]:bg-white/[.055]";

function providerSupportsParameter(
  provider: CheckoutProvider,
  parameter: string,
) {
  if (provider === "custom") return true;
  const normalized = parameter.trim().toLocaleLowerCase();
  const preset = CHECKOUT_PROVIDER_PRESETS[provider];
  return [
    ...preset.prefillParameters,
    ...preset.advancedParameters,
    ...preset.supportedUtms,
    ...preset.protectedParameters,
  ].some((candidate) => candidate.toLocaleLowerCase() === normalized);
}

function sourceDefault(
  source: UtmMappingSource,
  fields: CmsFormField[] | undefined,
) {
  if (source === "field") return fields?.[0]?.name || "";
  if (source === "utm") return "utm_source";
  return "";
}

function StepLabel({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-4 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[8px] font-medium uppercase tracking-[.055em] text-[var(--kodety-text-tertiary)]">
      {children}
    </span>
  );
}

function StepArrow() {
  return (
    <ArrowRight
      aria-hidden="true"
      data-kodety-utm-step-arrow
      className="size-2.5 shrink-0 text-white/20"
    />
  );
}

function MappingSourceValue({
  mapping,
  fields,
  disabled,
  index,
  onChange,
}: {
  mapping: UtmParameterMapping;
  fields?: CmsFormField[];
  disabled: boolean;
  index: number;
  onChange: (patch: Partial<UtmParameterMapping>) => void;
}) {
  if (mapping.source === "utm") {
    return (
      <Select
        value={mapping.sourceKey || undefined}
        disabled={disabled}
        onValueChange={(sourceKey) => onChange({ sourceKey })}
      >
        <SelectTrigger
          data-kodety-settings-control-inner
          aria-label={`UTM de origem do mapeamento ${index + 1}`}
          className={INNER_TRIGGER_CLASS}
        >
          <SelectValue placeholder="Escolha a UTM" />
        </SelectTrigger>
        <SelectContent align="end">
          {STANDARD_UTM_KEYS.map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (mapping.source === "field" && fields?.length) {
    const options = fields.some((field) => field.name === mapping.sourceKey)
      ? fields
      : mapping.sourceKey
        ? [
            {
              name: mapping.sourceKey,
              label: `${mapping.sourceKey} · não encontrado`,
              type: "",
            },
            ...fields,
          ]
        : fields;
    return (
      <Select
        value={mapping.sourceKey || undefined}
        disabled={disabled}
        onValueChange={(sourceKey) => onChange({ sourceKey })}
      >
        <SelectTrigger
          data-kodety-settings-control-inner
          aria-label={`Campo de origem do mapeamento ${index + 1}`}
          className={cn(INNER_TRIGGER_CLASS, "font-mono")}
        >
          <SelectValue placeholder="Escolha um campo" />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((field) => (
            <SelectItem key={field.name} value={field.name}>
              <span className="min-w-0 truncate">{field.label}</span>
              <span className="ml-1 text-[8px] text-white/35">
                {field.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const value =
    mapping.source === "fixed" || mapping.source === "template"
      ? mapping.value
      : mapping.sourceKey;
  const placeholder =
    mapping.source === "field"
      ? "name do campo"
      : mapping.source === "query"
        ? "parametro_origem"
        : mapping.source === "template"
          ? "{field:email} · {utm_source}"
          : "valor";
  return (
    <input
      value={value}
      disabled={disabled}
      aria-label={`Valor de origem do mapeamento ${index + 1}`}
      placeholder={placeholder}
      onChange={(event) =>
        onChange(
          mapping.source === "fixed" || mapping.source === "template"
            ? { value: event.target.value }
            : { sourceKey: event.target.value },
        )
      }
      className="h-7 min-w-0 w-full rounded-[6px] border-0 bg-transparent px-1.5 font-mono text-[10px] text-[var(--kodety-text)] outline-none transition-colors placeholder:font-sans placeholder:text-white/24 hover:bg-white/[.045] focus:bg-white/[.055] disabled:opacity-45"
    />
  );
}

export function HtmlUtmMappingControl({
  mapping,
  index,
  provider,
  fields,
  readOnly,
  duplicate,
  onChange,
  onRemove,
}: {
  mapping: UtmParameterMapping;
  index: number;
  provider: CheckoutProvider;
  fields?: CmsFormField[];
  readOnly: boolean;
  duplicate: boolean;
  onChange: (patch: Partial<UtmParameterMapping>) => void;
  onRemove: () => void;
}) {
  const preset = CHECKOUT_PROVIDER_PRESETS[provider];
  const invalidParameter = !validQueryParameterName(mapping.parameter);
  const unsupportedParameter =
    !invalidParameter &&
    !providerSupportsParameter(provider, mapping.parameter);
  const invalidSource =
    mapping.source === "field"
      ? !mapping.sourceKey.trim()
      : mapping.source === "query"
        ? !validQueryParameterName(mapping.sourceKey)
        : mapping.source === "utm"
          ? !STANDARD_UTM_KEYS.includes(
              mapping.sourceKey as (typeof STANDARD_UTM_KEYS)[number],
            )
          : !mapping.value.trim();
  const invalid =
    invalidParameter || unsupportedParameter || invalidSource || duplicate;
  const protectedParameter = preset.protectedParameters.some(
    (parameter) =>
      parameter.toLocaleLowerCase() === mapping.parameter.toLocaleLowerCase(),
  );
  const missingField =
    fields !== undefined &&
    mapping.source === "field" &&
    Boolean(mapping.sourceKey) &&
    !fields.some((field) => field.name === mapping.sourceKey);
  const message = duplicate
    ? "Cada destino pode aparecer somente uma vez."
    : invalidParameter
      ? "Use uma chave de query válida, começando por uma letra e sem espaços."
      : unsupportedParameter
        ? `“${mapping.parameter}” não pertence ao contrato de ${preset.label}. Use Personalizado para outros parâmetros.`
        : invalidSource
          ? "Escolha ou informe de onde este valor deve vir."
          : missingField
            ? `O campo “${mapping.sourceKey}” não existe no formulário selecionado.`
            : protectedParameter
              ? `“${mapping.parameter}” é protegido e nunca será sobrescrito.`
              : "";

  return (
    <div
      data-kodety-settings-control
      data-kodety-utm-mapping
      aria-invalid={invalid || undefined}
      role="group"
      aria-label={`Mapeamento ${index + 1}: ${mapping.parameter || "sem destino"}`}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "group/mapping min-w-0 overflow-hidden rounded-[9px] border bg-white/[.045] transition-[background-color,border-color] hover:bg-white/[.06] focus-within:bg-white/[.065]",
        invalid
          ? "border-[var(--kodety-danger)]/75"
          : "border-transparent focus-within:border-[var(--kodety-focus)]/70",
      )}
    >
      <div data-kodety-utm-mapping-grid>
        <span
          data-kodety-utm-mapping-index
          aria-hidden="true"
          className="grid min-h-12 place-items-center bg-black/[.055] text-[8px] tabular-nums text-white/28"
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <div
          data-kodety-utm-mapping-step="target"
          className="min-w-0 px-2.5 py-1.5"
        >
          <StepLabel>Destino no checkout</StepLabel>
          <input
            value={mapping.parameter}
            disabled={readOnly}
            aria-label={`Parâmetro de destino ${index + 1}`}
            placeholder={preset.prefillParameters[index] || "parametro"}
            onChange={(event) =>
              onChange({ parameter: event.target.value.replace(/\s/g, "") })
            }
            className="h-7 w-full min-w-0 rounded-[6px] border-0 bg-transparent px-1.5 font-mono text-[10px] text-[var(--kodety-text)] outline-none transition-colors placeholder:text-white/24 hover:bg-white/[.045] focus:bg-white/[.055] disabled:opacity-45"
          />
        </div>

        <div
          data-kodety-utm-mapping-step="source"
          className="min-w-0 px-2.5 py-1.5"
        >
          <StepLabel>
            <StepArrow /> Valor vem de
          </StepLabel>
          <div
            data-kodety-utm-source-composite
            className="flex min-w-0 items-center"
          >
            <div
              data-kodety-utm-source-kind
              className="min-w-0 basis-[46%] border-r border-white/[.055] pr-1"
            >
              <Select
                value={mapping.source}
                disabled={readOnly}
                onValueChange={(source) =>
                  onChange({
                    source: source as UtmMappingSource,
                    sourceKey: sourceDefault(
                      source as UtmMappingSource,
                      fields,
                    ),
                    value: "",
                  })
                }
              >
                <SelectTrigger
                  data-kodety-settings-control-inner
                  aria-label={`Tipo de origem ${index + 1}`}
                  className={INNER_TRIGGER_CLASS}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div data-kodety-utm-source-value className="min-w-0 flex-1 pl-1">
              <MappingSourceValue
                mapping={mapping}
                fields={fields}
                disabled={readOnly}
                index={index}
                onChange={onChange}
              />
            </div>
          </div>
        </div>

        <div
          data-kodety-utm-mapping-step="transform"
          className="min-w-0 px-2.5 py-1.5"
        >
          <StepLabel>
            <StepArrow /> Como tratar
          </StepLabel>
          <Select
            value={mapping.transform}
            disabled={readOnly}
            onValueChange={(transform) =>
              onChange({ transform: transform as UtmMappingTransform })
            }
          >
            <SelectTrigger
              data-kodety-settings-control-inner
              aria-label={`Tratamento do mapeamento ${index + 1}`}
              className={INNER_TRIGGER_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {TRANSFORM_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          data-kodety-utm-mapping-step="conflict"
          className="min-w-0 px-2.5 py-1.5"
        >
          <StepLabel>
            <StepArrow /> Se já existir
          </StepLabel>
          <Select
            value={mapping.conflict}
            disabled={readOnly || protectedParameter}
            onValueChange={(conflict) =>
              onChange({ conflict: conflict as UtmMappingConflict })
            }
          >
            <SelectTrigger
              data-kodety-settings-control-inner
              aria-label={`Regra de conflito do mapeamento ${index + 1}`}
              className={INNER_TRIGGER_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="preserve">Manter o valor atual</SelectItem>
              <SelectItem value="replace">Substituir pelo novo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-kodety-utm-mapping-remove
              aria-label={`Remover mapeamento ${index + 1}`}
              disabled={readOnly}
              onClick={onRemove}
              className="grid min-h-12 place-items-center bg-black/[.055] text-white/30 outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-danger)] focus-visible:text-[var(--kodety-accent-hover)] disabled:opacity-35"
            >
              <Trash2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Remover mapeamento</TooltipContent>
        </Tooltip>
      </div>

      {message ? (
        <p
          data-kodety-utm-mapping-message
          className={cn(
            "border-t border-white/[.055] px-2.5 py-1.5 text-[8px] leading-3",
            invalid
              ? "text-[var(--kodety-danger)]"
              : "text-[var(--kodety-warning)]",
          )}
          role={invalid ? "alert" : undefined}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
