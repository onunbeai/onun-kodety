import { readEditorMetadata, updateEditorMetadata } from "./project-metadata";
import type { HtmlProject } from "./types";

export const UTM_CENTER_SCHEMA_VERSION = 1 as const;
export const FORM_UTM_SCHEMA_VERSION = 1 as const;
export const MAX_UTM_PROFILES = 250;
export const MAX_UTM_MAPPINGS = 40;
export const MAX_FORM_UTM_CONFIG_LENGTH = 131_072;
export const MAX_CHECKOUT_BASE_URL_LENGTH = 4_096;
export const MAX_CHECKOUT_REDIRECT_URL_LENGTH = 8_192;

export const STANDARD_UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type StandardUtmKey = (typeof STANDARD_UTM_KEYS)[number];
export type UtmProfileKind = "link" | "checkout";
export type CheckoutProvider =
  "hotmart" | "ticto" | "kiwify" | "eduzz" | "custom";
export type UtmMappingSource = "field" | "utm" | "query" | "fixed" | "template";
export type UtmMappingTransform =
  "none" | "trim" | "digits" | "phone_area" | "phone_number" | "slug";
export type UtmMappingConflict = "preserve" | "replace";

export interface UtmParameterMapping {
  id: string;
  parameter: string;
  source: UtmMappingSource;
  sourceKey: string;
  value: string;
  transform: UtmMappingTransform;
  conflict: UtmMappingConflict;
}

export interface FormUtmConfig {
  version: typeof FORM_UTM_SCHEMA_VERSION;
  provider: CheckoutProvider;
  profileId?: string;
  forwardUtms: boolean;
  rememberSession: boolean;
  mappings: UtmParameterMapping[];
}

export interface UtmSavedProfile {
  id: string;
  name: string;
  kind: UtmProfileKind;
  baseUrl: string;
  provider: CheckoutProvider;
  parameters: Record<StandardUtmKey, string>;
  forwardUtms: boolean;
  rememberSession: boolean;
  mappings: UtmParameterMapping[];
  createdAt: string;
  updatedAt: string;
}

export interface UtmCenterSettings {
  version: typeof UTM_CENTER_SCHEMA_VERSION;
  profiles: UtmSavedProfile[];
}

export interface CheckoutProviderPreset {
  id: CheckoutProvider;
  label: string;
  description: string;
  supportedUtms: readonly StandardUtmKey[];
  prefillParameters: readonly string[];
  advancedParameters: readonly string[];
  protectedParameters: readonly string[];
  documentationUrl?: string;
}

const ALL_STANDARD_UTMS = [...STANDARD_UTM_KEYS];

export const CHECKOUT_PROVIDER_PRESETS: Record<
  CheckoutProvider,
  CheckoutProviderPreset
> = {
  hotmart: {
    id: "hotmart",
    label: "Hotmart",
    description: "Nome, e-mail e telefone separado em DDD + número.",
    supportedUtms: ALL_STANDARD_UTMS,
    prefillParameters: [
      "name",
      "email",
      "phoneac",
      "phonenumber",
      "doc",
      "zip",
    ],
    advancedParameters: ["src", "sck"],
    protectedParameters: [
      "checkoutMode",
      "src",
      "sck",
      "off",
      "offDiscount",
      "bid",
    ],
    documentationUrl:
      "https://help.hotmart.com/pt-br/article/115003588572/como-configurar-meus-parametros-da-pagina-de-pagamento-",
  },
  ticto: {
    id: "ticto",
    label: "Ticto",
    description: "Telefone completo com DDD no parâmetro phonenumber.",
    supportedUtms: ALL_STANDARD_UTMS,
    prefillParameters: ["name", "email", "phonenumber", "doc", "zip"],
    advancedParameters: ["src", "sck"],
    protectedParameters: [
      "pid",
      "PID",
      "src",
      "sck",
      "kdt_ref",
      "offer",
      "product",
    ],
    documentationUrl:
      "https://help.ticto.com.br/sou-produtor/meus-produtos/produtor/gerenciamento-e-acoes-em-produtos/templates-de-checkout/como-fazer-checkout-pre-populado-preenchido-na-ticto-usando-elementor",
  },
  kiwify: {
    id: "kiwify",
    label: "Kiwify",
    description: "Nome, e-mail e telefone; CPF e região ficam opcionais.",
    supportedUtms: ALL_STANDARD_UTMS,
    prefillParameters: ["name", "email", "phone", "cpf", "region"],
    advancedParameters: ["src", "sck", "s1", "s2", "s3"],
    protectedParameters: [
      "afid",
      "coupon",
      "src",
      "sck",
      "offer",
      "product",
      "checkout",
    ],
    documentationUrl:
      "https://ajuda.kiwify.com.br/pt-br/article/como-preencher-os-campos-do-checkout-pela-url-de7ezo/",
  },
  eduzz: {
    id: "eduzz",
    label: "Eduzz",
    description: "Aliases ingleses compatíveis com o Checkout Sun.",
    supportedUtms: ["utm_source", "utm_medium", "utm_campaign", "utm_content"],
    prefillParameters: ["name", "email", "phone", "doc", "zip"],
    advancedParameters: [
      "country",
      "num",
      "comp",
      "state",
      "city",
      "street",
      "district",
    ],
    protectedParameters: [
      "a",
      "cupom",
      "currency",
      "installments",
      "p",
      "pf",
      "np",
      "skip",
    ],
    documentationUrl:
      "https://ajuda.eduzz.com/hc/pt-br/articles/4402887369627-Como-configurar-os-Par%C3%A2metros-adicionais-no-meu-link-de-vendas-Checkout-Sun",
  },
  custom: {
    id: "custom",
    label: "Personalizado",
    description: "Qualquer checkout HTTPS com mapeamento explícito.",
    supportedUtms: ALL_STANDARD_UTMS,
    prefillParameters: [],
    advancedParameters: [],
    protectedParameters: [],
  },
};

const EMPTY_PARAMETERS = Object.fromEntries(
  STANDARD_UTM_KEYS.map((key) => [key, ""]),
) as Record<StandardUtmKey, string>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, max = 500) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, max)
    : "";
}

function stableId(value: unknown, prefix: string) {
  const cleaned = cleanText(value, 96).replace(/[^a-zA-Z0-9._:-]/g, "-");
  return cleaned || `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function timestamp(value: unknown, fallback = new Date().toISOString()) {
  const candidate = cleanText(value, 64);
  return candidate && Number.isFinite(Date.parse(candidate))
    ? candidate
    : fallback;
}

export function createUtmMapping(
  partial: Partial<UtmParameterMapping> = {},
): UtmParameterMapping {
  return {
    id: stableId(partial.id, "map"),
    parameter: cleanText(partial.parameter, 64),
    source: ["field", "utm", "query", "fixed", "template"].includes(
      partial.source || "",
    )
      ? (partial.source as UtmMappingSource)
      : "field",
    sourceKey: cleanText(partial.sourceKey, 128),
    value: cleanText(partial.value, 1_000),
    transform: [
      "none",
      "trim",
      "digits",
      "phone_area",
      "phone_number",
      "slug",
    ].includes(partial.transform || "")
      ? (partial.transform as UtmMappingTransform)
      : "trim",
    conflict: partial.conflict === "replace" ? "replace" : "preserve",
  };
}

export function normalizeUtmMapping(
  value: unknown,
  index = 0,
): UtmParameterMapping | null {
  const source = record(value);
  const nestedSource = record(source.source);
  const origin = Object.keys(nestedSource).length
    ? nestedSource
    : record(source.origin);
  const sourceType =
    typeof source.source === "string" ? source.source : origin.type;
  const explicitId = cleanText(source.id, 96);
  const mapping = createUtmMapping({
    id: explicitId || `map-${index + 1}`,
    parameter: cleanText(
      source.parameter ?? source.param ?? source.target ?? source.name,
      64,
    ),
    source: cleanText(sourceType, 20) as UtmMappingSource,
    sourceKey: cleanText(
      source.sourceKey ??
        source.key ??
        origin.key ??
        origin.name ??
        origin.field ??
        origin.parameter,
      128,
    ),
    value: cleanText(source.value ?? origin.template ?? origin.value, 1_000),
    transform: cleanText(
      source.transform ?? origin.transform,
      24,
    ) as UtmMappingTransform,
    conflict: cleanText(source.conflict, 16) as UtmMappingConflict,
  });
  // An explicitly identified blank row is an editor draft created by “Adicionar”.
  // Keep it serializable so the user can fill it in; the public runtime remains
  // strict and rejects it until a valid destination/source is configured.
  return explicitId || mapping.parameter || mapping.sourceKey || mapping.value
    ? mapping
    : null;
}

export function validQueryParameterName(value: string) {
  return /^[A-Za-z][A-Za-z0-9_.:[\]-]{0,63}$/.test(value);
}

function normalizeProvider(value: unknown): CheckoutProvider {
  const provider = cleanText(value, 20) as CheckoutProvider;
  return provider in CHECKOUT_PROVIDER_PRESETS ? provider : "custom";
}

function normalizeParameters(value: unknown) {
  const source = record(value);
  return Object.fromEntries(
    STANDARD_UTM_KEYS.map((key) => [key, cleanText(source[key], 500)]),
  ) as Record<StandardUtmKey, string>;
}

export function normalizeFormUtmConfig(value: unknown): FormUtmConfig {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = {};
    }
  }
  const source = record(candidate);
  const mappings = Array.isArray(source.mappings)
    ? source.mappings.slice(0, MAX_UTM_MAPPINGS).flatMap((mapping, index) => {
        const normalized = normalizeUtmMapping(mapping, index);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    version: FORM_UTM_SCHEMA_VERSION,
    provider: normalizeProvider(source.provider),
    ...(cleanText(source.profileId, 96)
      ? { profileId: cleanText(source.profileId, 96) }
      : {}),
    forwardUtms: source.forwardUtms === true,
    rememberSession: source.rememberSession === true,
    mappings,
  };
}

export function serializeFormUtmConfig(value: unknown) {
  return JSON.stringify(normalizeFormUtmConfig(value));
}

function normalizeProfile(value: unknown, index: number): UtmSavedProfile {
  const source = record(value);
  const createdAt = timestamp(source.createdAt);
  const kind: UtmProfileKind = source.kind === "checkout" ? "checkout" : "link";
  const config = normalizeFormUtmConfig({
    provider: source.provider,
    forwardUtms: source.forwardUtms,
    rememberSession: source.rememberSession,
    mappings: source.mappings,
  });
  return {
    id: stableId(source.id, `utm-${index + 1}`),
    name:
      cleanText(source.name, 100) ||
      (kind === "checkout" ? `Checkout ${index + 1}` : `Link ${index + 1}`),
    kind,
    baseUrl: cleanText(source.baseUrl ?? source.url, 2_048),
    provider: kind === "checkout" ? config.provider : "custom",
    parameters: normalizeParameters(source.parameters ?? source.utms),
    forwardUtms: kind === "checkout" && config.forwardUtms,
    rememberSession: config.rememberSession,
    mappings: kind === "checkout" ? config.mappings : [],
    createdAt,
    updatedAt: timestamp(source.updatedAt, createdAt),
  };
}

export function normalizeUtmCenterSettings(value: unknown): UtmCenterSettings {
  const source = record(value);
  const rawProfiles = Array.isArray(source.profiles)
    ? source.profiles
    : Array.isArray(source.links)
      ? source.links
      : [];
  const usedIds = new Set<string>();
  const profiles = rawProfiles
    .slice(0, MAX_UTM_PROFILES)
    .map(normalizeProfile)
    .map((profile, index) => {
      if (!usedIds.has(profile.id)) {
        usedIds.add(profile.id);
        return profile;
      }
      const id = `${profile.id}-${index + 1}`;
      usedIds.add(id);
      return { ...profile, id };
    });
  return { version: UTM_CENTER_SCHEMA_VERSION, profiles };
}

export function readUtmCenterSettings(project: HtmlProject): UtmCenterSettings {
  const metadata = readEditorMetadata(project) as unknown as Record<
    string,
    unknown
  >;
  const analytics = record(metadata.analytics);
  return normalizeUtmCenterSettings(
    analytics.utmCenter ?? analytics.utms ?? metadata.utmCenter,
  );
}

export function writeUtmCenterSettings(
  project: HtmlProject,
  value: unknown,
): HtmlProject {
  const settings = normalizeUtmCenterSettings(value);
  return updateEditorMetadata(project, (metadata) => {
    const source = metadata as unknown as Record<string, unknown>;
    const analytics = record(source.analytics);
    const next = {
      ...source,
      analytics: {
        ...analytics,
        utmCenterVersion: UTM_CENTER_SCHEMA_VERSION,
        utmCenter: settings,
      },
    };
    delete (next as Record<string, unknown>).utmCenter;
    return next as unknown as typeof metadata;
  });
}

function newId(prefix: string) {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  );
}

function normalizedFieldToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizedFieldSegments(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function suggestedField(fields: string[], aliases: string[]) {
  const normalized = fields.map((field) => ({
    field,
    token: normalizedFieldToken(field),
    segments: normalizedFieldSegments(field),
  }));
  for (const alias of aliases) {
    const token = normalizedFieldToken(alias);
    const exact = normalized.find((item) => item.token === token);
    if (exact) return exact.field;
    const contextual = normalized.find(
      (item) =>
        item.segments.includes(token) ||
        (token.length >= 5 &&
          (item.token.startsWith(token) || item.token.endsWith(token))),
    );
    if (contextual) return contextual.field;
  }
  return "";
}

export function providerSuggestedMappings(
  provider: CheckoutProvider,
  formFields: string[] = [],
): UtmParameterMapping[] {
  if (provider === "custom") {
    return formFields
      .filter(validQueryParameterName)
      .slice(0, MAX_UTM_MAPPINGS)
      .map((field) => {
        const token = normalizedFieldToken(field);
        const numeric =
          /(?:phone|telefone|celular|whatsapp|cpf|cnpj|documento|doc|cep|zip)/.test(
            token,
          );
        return createUtmMapping({
          parameter: field,
          source: "field",
          sourceKey: field,
          transform: numeric ? "digits" : "trim",
        });
      });
  }

  const useConventionalFallbacks = formFields.length === 0;
  const resolve = (aliases: string[], fallback: string) =>
    suggestedField(formFields, aliases) ||
    (useConventionalFallbacks ? fallback : "");
  const name = resolve(
    ["name", "nome", "fullname", "nomecompleto", "full_name"],
    "name",
  );
  const email = resolve(
    ["email", "e-mail", "emailaddress", "correio"],
    "email",
  );
  const phone = resolve(
    ["phone", "telefone", "celular", "whatsapp", "tel", "mobile"],
    "phone",
  );
  const document = resolve(
    ["doc", "document", "documento", "cpf", "cnpj", "cpfcnpj"],
    "",
  );
  const zip = resolve(
    ["zip", "zipcode", "postalcode", "cep", "codigopostal"],
    "",
  );
  const mappings: UtmParameterMapping[] = [];
  const add = (
    parameter: string,
    sourceKey: string,
    transform: UtmMappingTransform = "trim",
  ) => {
    if (!sourceKey) return;
    mappings.push(
      createUtmMapping({
        parameter,
        source: "field",
        sourceKey,
        transform,
      }),
    );
  };
  add("name", name);
  add("email", email);
  if (provider === "hotmart") {
    add("phoneac", phone, "phone_area");
    add("phonenumber", phone, "phone_number");
    add("doc", document, "digits");
    add("zip", zip, "digits");
    return mappings;
  }
  if (provider === "ticto") {
    add("phonenumber", phone, "digits");
    add("doc", document, "digits");
    add("zip", zip, "digits");
    return mappings;
  }
  if (provider === "kiwify") {
    add("phone", phone, "digits");
    add("cpf", document, "digits");
    add("region", resolve(["region", "state", "estado", "uf"], ""));
    return mappings;
  }
  if (provider === "eduzz") {
    add("phone", phone, "digits");
    add("doc", document, "digits");
    add("zip", zip, "digits");
    add("country", resolve(["country", "pais"], ""));
    add(
      "num",
      resolve(["num", "numero", "addressnumber", "numeroendereco"], ""),
    );
    add("comp", resolve(["comp", "complement", "complemento"], ""));
    add("state", resolve(["state", "estado", "uf"], ""));
    add("city", resolve(["city", "cidade"], ""));
    add("street", resolve(["street", "rua", "logradouro", "endereco"], ""));
    add("district", resolve(["district", "bairro"], ""));
    return mappings;
  }
  return mappings;
}

export function createUtmProfile(
  kind: UtmProfileKind,
  provider: CheckoutProvider = "hotmart",
): UtmSavedProfile {
  const now = new Date().toISOString();
  return {
    id: newId(kind === "checkout" ? "checkout" : "utm"),
    name:
      kind === "checkout"
        ? `Checkout ${CHECKOUT_PROVIDER_PRESETS[provider].label}`
        : "Novo link rastreável",
    kind,
    baseUrl: "",
    provider: kind === "checkout" ? provider : "custom",
    parameters: { ...EMPTY_PARAMETERS },
    forwardUtms: false,
    rememberSession: false,
    mappings: kind === "checkout" ? providerSuggestedMappings(provider) : [],
    createdAt: now,
    updatedAt: now,
  };
}

export function profileToFormUtmConfig(
  profile: UtmSavedProfile,
): FormUtmConfig {
  return normalizeFormUtmConfig({
    provider: profile.provider,
    profileId: profile.id,
    forwardUtms: profile.forwardUtms,
    rememberSession: profile.rememberSession,
    mappings: profile.mappings,
  });
}

export function buildTrackedUrl(
  baseUrl: string,
  parameters: Partial<Record<StandardUtmKey, string>>,
) {
  const input = baseUrl.trim();
  if (!input) return "";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(url.protocol)) return "";
  STANDARD_UTM_KEYS.forEach((key) => {
    const value = cleanText(parameters[key], 500);
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

export function decodeTrackedUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    const parameters = Object.fromEntries(
      STANDARD_UTM_KEYS.map((key) => [key, url.searchParams.get(key) || ""]),
    ) as Record<StandardUtmKey, string>;
    return {
      baseUrl: `${url.origin}${url.pathname}${url.hash}`,
      parameters,
      extras: Array.from(url.searchParams.entries()).filter(
        ([key]) => !STANDARD_UTM_KEYS.includes(key as StandardUtmKey),
      ),
    };
  } catch {
    return null;
  }
}

export function checkoutTemplatePreview(profile: UtmSavedProfile) {
  return checkoutConfigPreview(profile.baseUrl, profile);
}

export function checkoutConfigPreview(
  baseUrl: string,
  config: Pick<FormUtmConfig, "provider" | "forwardUtms" | "mappings">,
) {
  const input = baseUrl.trim();
  if (!input || input.length > MAX_CHECKOUT_BASE_URL_LENGTH) return "";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(url.protocol)) return "";
  const preset = CHECKOUT_PROVIDER_PRESETS[config.provider];
  if (
    !preset ||
    !Array.isArray(config.mappings) ||
    config.mappings.length > MAX_UTM_MAPPINGS
  )
    return "";
  const supportedParameters =
    config.provider === "custom"
      ? null
      : new Set(
          [
            ...preset.supportedUtms,
            ...preset.prefillParameters,
            ...preset.advancedParameters,
            ...preset.protectedParameters,
          ].map((parameter) => parameter.toLocaleLowerCase()),
        );
  const protectedParameters = new Set(
    preset.protectedParameters.map((parameter) =>
      parameter.toLocaleLowerCase(),
    ),
  );
  const seenParameters = new Set<string>();
  const matchingParameterNames = (parameter: string) => {
    const normalized = parameter.toLocaleLowerCase();
    return Array.from(
      new Set(
        Array.from(url.searchParams.keys()).filter(
          (name) => name.toLocaleLowerCase() === normalized,
        ),
      ),
    );
  };
  const setParameter = (
    parameter: string,
    value: string,
    conflict: UtmMappingConflict,
  ) => {
    const existingNames = matchingParameterNames(parameter);
    if (
      existingNames.length &&
      (protectedParameters.has(parameter.toLocaleLowerCase()) ||
        conflict !== "replace")
    )
      return;
    existingNames.forEach((name) => url.searchParams.delete(name));
    url.searchParams.set(parameter, value);
  };
  for (const mapping of config.mappings) {
    const parameter = mapping.parameter.trim();
    const normalizedParameter = parameter.toLocaleLowerCase();
    if (
      !validQueryParameterName(parameter) ||
      seenParameters.has(normalizedParameter) ||
      (supportedParameters && !supportedParameters.has(normalizedParameter))
    )
      return "";
    seenParameters.add(normalizedParameter);
    if (
      !["field", "utm", "query", "fixed", "template"].includes(mapping.source)
    )
      return "";
    if (
      (mapping.source === "field" && !mapping.sourceKey.trim()) ||
      (mapping.source === "query" &&
        !validQueryParameterName(mapping.sourceKey.trim())) ||
      (mapping.source === "utm" &&
        !STANDARD_UTM_KEYS.includes(
          mapping.sourceKey.trim().toLocaleLowerCase() as StandardUtmKey,
        ))
    )
      return "";
    if (
      mapping.transform &&
      ![
        "none",
        "trim",
        "digits",
        "phone_area",
        "phone_number",
        "slug",
      ].includes(mapping.transform)
    )
      return "";
    const value =
      mapping.source === "field"
        ? `{field:${mapping.sourceKey || "campo"}}`
        : mapping.source === "utm"
          ? `{${mapping.sourceKey || "utm_source"}}`
          : mapping.source === "query"
            ? `{query:${mapping.sourceKey || "parametro"}}`
            : mapping.value;
    if (!value) continue;
    setParameter(parameter, value, mapping.conflict);
  }
  if (config.forwardUtms) {
    preset.supportedUtms.forEach((key) => {
      setParameter(key, `{${key}}`, "preserve");
    });
  }
  const result = url.toString();
  return result.length <= MAX_CHECKOUT_REDIRECT_URL_LENGTH ? result : "";
}
