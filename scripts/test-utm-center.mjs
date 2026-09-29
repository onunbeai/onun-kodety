import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true },
});

const FIXED_DATE = "2026-08-25T12:00:00.000Z";

const projectWithMetadata = (metadata) => ({
  name: "UTM Center test",
  files: {
    ".incode/project.json": {
      path: ".incode/project.json",
      mimeType: "application/json",
      text: JSON.stringify(metadata, null, 2),
    },
  },
  mainHtmlPath: "index.html",
  rootPath: "",
  openedAt: 0,
});

const mappingSummary = (mappings) =>
  mappings.map((mapping) => ({
    parameter: mapping.parameter,
    source: mapping.source,
    sourceKey: mapping.sourceKey,
    transform: mapping.transform,
    conflict: mapping.conflict,
  }));

try {
  const utm = await server.ssrLoadModule("/lib/html-editor/utm.ts");
  const standardUtms = [...utm.STANDARD_UTM_KEYS];

  assert.deepEqual(
    standardUtms,
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"],
    "the shared UTM vocabulary must retain the five standard keys",
  );

  const emptyConfig = utm.normalizeFormUtmConfig(undefined);
  assert.equal(emptyConfig.version, utm.FORM_UTM_SCHEMA_VERSION);
  assert.equal(emptyConfig.provider, "custom");
  assert.equal(emptyConfig.forwardUtms, false, "UTM forwarding must be opt-in");
  assert.equal(
    emptyConfig.rememberSession,
    false,
    "cross-page attribution memory must be opt-in",
  );
  assert.deepEqual(emptyConfig.mappings, []);

  assert.deepEqual(
    JSON.parse(utm.serializeFormUtmConfig("{}")),
    emptyConfig,
    "serialized form configuration must round-trip through the canonical normalizer",
  );
  assert.deepEqual(
    utm.normalizeFormUtmConfig("{invalid json"),
    emptyConfig,
    "invalid legacy attributes must fail closed with every tracking toggle disabled",
  );
  assert.equal(
    utm.normalizeFormUtmConfig({ forwardUtms: "true", rememberSession: 1 })
      .forwardUtms,
    false,
    "truthy legacy values must not accidentally activate UTM forwarding",
  );
  assert.equal(
    utm.normalizeFormUtmConfig({ forwardUtms: "true", rememberSession: 1 })
      .rememberSession,
    false,
    "truthy legacy values must not accidentally activate session memory",
  );

  const editableDraftMapping = utm.createUtmMapping();
  const editableDraftConfig = JSON.parse(
    utm.serializeFormUtmConfig({
      mappings: [editableDraftMapping],
    }),
  );
  assert.equal(
    editableDraftConfig.mappings.length,
    1,
    "an explicitly identified blank editor row must survive serialization",
  );
  assert.equal(editableDraftConfig.mappings[0].id, editableDraftMapping.id);
  assert.equal(editableDraftConfig.mappings[0].parameter, "");
  assert.equal(
    utm.checkoutConfigPreview(
      "https://checkout.example.test/fallback",
      editableDraftConfig,
    ),
    "",
    "an editable blank row must remain invalid until the user configures it",
  );

  const expectedProviders = {
    hotmart: {
      prefill: ["name", "email", "phoneac", "phonenumber", "doc", "zip"],
      advanced: ["src", "sck"],
      supportedUtms: standardUtms,
      protected: ["checkoutMode", "src", "sck"],
    },
    ticto: {
      prefill: ["name", "email", "phonenumber", "doc", "zip"],
      advanced: ["src", "sck"],
      supportedUtms: standardUtms,
      protected: ["pid", "PID", "src", "sck"],
    },
    kiwify: {
      prefill: ["name", "email", "phone", "cpf", "region"],
      advanced: ["src", "sck", "s1", "s2", "s3"],
      supportedUtms: standardUtms,
      protected: ["afid", "coupon", "src", "sck"],
    },
    eduzz: {
      prefill: ["name", "email", "phone", "doc", "zip"],
      advanced: [
        "country",
        "num",
        "comp",
        "state",
        "city",
        "street",
        "district",
      ],
      supportedUtms: [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
      ],
      protected: ["a", "cupom", "currency", "p", "pf", "np", "skip"],
    },
    custom: {
      prefill: [],
      advanced: [],
      supportedUtms: standardUtms,
      protected: [],
    },
  };

  assert.deepEqual(
    Object.keys(utm.CHECKOUT_PROVIDER_PRESETS),
    Object.keys(expectedProviders),
    "the checkout selector must expose every official preset plus Custom",
  );
  for (const [provider, expected] of Object.entries(expectedProviders)) {
    const preset = utm.CHECKOUT_PROVIDER_PRESETS[provider];
    assert.deepEqual(
      [...preset.prefillParameters],
      expected.prefill,
      `${provider} prefill parameters must match its checkout contract`,
    );
    assert.deepEqual(
      [...preset.advancedParameters],
      expected.advanced,
      `${provider} advanced parameters must remain explicit`,
    );
    assert.deepEqual(
      [...preset.supportedUtms],
      expected.supportedUtms,
      `${provider} must forward only documented UTMs`,
    );
    expected.protected.forEach((parameter) => {
      assert.ok(
        preset.protectedParameters.includes(parameter),
        `${provider} must protect the existing ${parameter} parameter`,
      );
    });
    if (provider === "custom") {
      assert.equal(preset.documentationUrl, undefined);
    } else {
      assert.match(
        preset.documentationUrl,
        /^https:\/\//,
        `${provider} must link to primary HTTPS documentation`,
      );
    }

    const profile = utm.createUtmProfile("checkout", provider);
    assert.equal(profile.provider, provider);
    assert.equal(
      profile.forwardUtms,
      false,
      `${provider} profiles must start with UTM forwarding disabled`,
    );
    assert.equal(
      profile.rememberSession,
      false,
      `${provider} profiles must start with session memory disabled`,
    );
  }
  assert.equal(
    utm.CHECKOUT_PROVIDER_PRESETS.eduzz.supportedUtms.includes("utm_term"),
    false,
    "Eduzz must not claim utm_term support without primary documentation",
  );
  assert.deepEqual(
    utm.providerSuggestedMappings("custom"),
    [],
    "Custom checkout must never invent vendor-specific buyer parameters",
  );

  const formFields = ["Nome Completo", "E-mail", "WhatsApp"];
  const expectedSuggestions = {
    hotmart: [
      ["name", "Nome Completo", "trim"],
      ["email", "E-mail", "trim"],
      ["phoneac", "WhatsApp", "phone_area"],
      ["phonenumber", "WhatsApp", "phone_number"],
    ],
    ticto: [
      ["name", "Nome Completo", "trim"],
      ["email", "E-mail", "trim"],
      ["phonenumber", "WhatsApp", "digits"],
    ],
    kiwify: [
      ["name", "Nome Completo", "trim"],
      ["email", "E-mail", "trim"],
      ["phone", "WhatsApp", "digits"],
    ],
    eduzz: [
      ["name", "Nome Completo", "trim"],
      ["email", "E-mail", "trim"],
      ["phone", "WhatsApp", "digits"],
    ],
  };
  for (const [provider, expected] of Object.entries(expectedSuggestions)) {
    const suggestions = utm.providerSuggestedMappings(provider, formFields);
    assert.deepEqual(
      suggestions.map((mapping) => [
        mapping.parameter,
        mapping.sourceKey,
        mapping.transform,
      ]),
      expected,
      `${provider} suggestions must resolve real localized form field names`,
    );
    assert.ok(suggestions.every((mapping) => mapping.source === "field"));
    assert.ok(suggestions.every((mapping) => mapping.conflict === "preserve"));
    assert.equal(
      new Set(suggestions.map((mapping) => mapping.id)).size,
      suggestions.length,
      `${provider} suggestions need independent mapping IDs`,
    );
  }

  assert.deepEqual(
    utm
      .providerSuggestedMappings("kiwify", ["unrelated"])
      .map((mapping) => mapping.sourceKey),
    [],
    "page-aware suggestions must never invent fields that are absent from the selected form",
  );

  assert.deepEqual(
    utm
      .providerSuggestedMappings("hotmart", [
        "nome_completo",
        "lead_email",
        "whatsapp",
        "cpf",
        "cep",
      ])
      .map((mapping) => [
        mapping.parameter,
        mapping.sourceKey,
        mapping.transform,
      ]),
    [
      ["name", "nome_completo", "trim"],
      ["email", "lead_email", "trim"],
      ["phoneac", "whatsapp", "phone_area"],
      ["phonenumber", "whatsapp", "phone_number"],
      ["doc", "cpf", "digits"],
      ["zip", "cep", "digits"],
    ],
    "form-aware Hotmart suggestions must include every recognized optional field without guessing missing ones",
  );

  assert.deepEqual(
    utm
      .providerSuggestedMappings("hotmart", [
        "buyer_name",
        "buyer_email",
        "mobile",
      ])
      .map((mapping) => [mapping.parameter, mapping.sourceKey]),
    [
      ["name", "buyer_name"],
      ["email", "buyer_email"],
      ["phoneac", "mobile"],
      ["phonenumber", "mobile"],
    ],
    "page-aware suggestions must understand semantic field-name segments without matching unrelated words such as username",
  );

  assert.deepEqual(
    utm
      .providerSuggestedMappings("custom", [
        "lead_name",
        "lead[email]",
        "telefone",
        "campo com espaço",
      ])
      .map((mapping) => [
        mapping.parameter,
        mapping.sourceKey,
        mapping.transform,
      ]),
    [
      ["lead_name", "lead_name", "trim"],
      ["lead[email]", "lead[email]", "trim"],
      ["telefone", "telefone", "digits"],
    ],
    "Custom must build explicit one-to-one suggestions for every safe field name in the selected form",
  );

  const nestedLegacy = utm.normalizeFormUtmConfig({
    provider: "ticto",
    mappings: [
      {
        id: " Legacy buyer email ",
        target: "email",
        origin: { type: "field", name: "lead_email" },
        transform: "trim",
        conflict: "replace",
      },
      {
        target: "sck",
        origin: { type: "fixed", value: "instagram|social|launch" },
        transform: "slug",
      },
      null,
      {},
    ],
  });
  assert.deepEqual(mappingSummary(nestedLegacy.mappings), [
    {
      parameter: "email",
      source: "field",
      sourceKey: "lead_email",
      transform: "trim",
      conflict: "replace",
    },
    {
      parameter: "sck",
      source: "fixed",
      sourceKey: "",
      transform: "slug",
      conflict: "preserve",
    },
  ]);
  assert.equal(nestedLegacy.mappings[0].id, "Legacy-buyer-email");
  assert.equal(nestedLegacy.mappings[1].value, "instagram|social|launch");

  const nestedSourceLegacy = utm.normalizeFormUtmConfig({
    provider: "custom",
    mappings: [
      {
        id: "nested-source",
        name: "tracking",
        source: {
          type: "template",
          template: "{utm_source}|{field:email}",
          transform: "none",
        },
      },
    ],
  });
  assert.deepEqual(mappingSummary(nestedSourceLegacy.mappings), [
    {
      parameter: "tracking",
      source: "template",
      sourceKey: "",
      transform: "none",
      conflict: "preserve",
    },
  ]);
  assert.equal(
    nestedSourceLegacy.mappings[0].value,
    "{utm_source}|{field:email}",
  );

  const tracked = utm.buildTrackedUrl(
    "https://example.test/sales?utm_source=existing&ref=one&ref=two&coupon=SAVE#checkout",
    {
      utm_source: "",
      utm_medium: " email ",
      utm_campaign: "",
    },
  );
  const trackedUrl = new URL(tracked);
  assert.equal(
    trackedUrl.searchParams.get("utm_source"),
    "existing",
    "an empty editor field must preserve an existing UTM",
  );
  assert.equal(trackedUrl.searchParams.get("utm_medium"), "email");
  assert.deepEqual(
    trackedUrl.searchParams.getAll("ref"),
    ["one", "two"],
    "unknown repeated query parameters must survive generation",
  );
  assert.equal(trackedUrl.searchParams.get("coupon"), "SAVE");
  assert.equal(trackedUrl.hash, "#checkout");

  const protectedCases = [
    ["hotmart", "checkoutMode"],
    ["ticto", "pid"],
    ["kiwify", "afid"],
    ["eduzz", "p"],
  ];
  for (const [provider, parameter] of protectedCases) {
    const preview = utm.checkoutConfigPreview(
      `https://checkout.example.test/offer?${parameter}=original&keep=1#payment`,
      {
        provider,
        forwardUtms: false,
        mappings: [
          utm.createUtmMapping({
            parameter,
            source: "fixed",
            value: "replacement",
            conflict: "replace",
          }),
        ],
      },
    );
    const previewUrl = new URL(preview);
    assert.equal(
      previewUrl.searchParams.get(parameter),
      "original",
      `${provider} must never overwrite an existing protected ${parameter}`,
    );
    assert.equal(previewUrl.searchParams.get("keep"), "1");
    assert.equal(previewUrl.hash, "#payment");
  }

  const protectedCaseInsensitive = new URL(
    utm.checkoutConfigPreview(
      "https://pay.hotmart.com/example?SCK=original#payment",
      {
        provider: "hotmart",
        forwardUtms: false,
        mappings: [
          utm.createUtmMapping({
            parameter: "sck",
            source: "fixed",
            value: "replacement",
            conflict: "replace",
          }),
        ],
      },
    ),
  );
  assert.equal(
    protectedCaseInsensitive.searchParams.get("SCK"),
    "original",
    "protected query names must be matched case-insensitively",
  );
  assert.equal(
    protectedCaseInsensitive.searchParams.has("sck"),
    false,
    "preview must not create a case-variant duplicate",
  );

  assert.equal(
    utm.checkoutConfigPreview("https://sun.eduzz.com/example", {
      provider: "eduzz",
      forwardUtms: false,
      mappings: [
        utm.createUtmMapping({
          parameter: "utm_term",
          source: "fixed",
          value: "unsupported",
        }),
      ],
    }),
    "",
    "the preview must reject an explicit undocumented Eduzz utm_term just like the runtime",
  );
  assert.equal(
    utm.checkoutConfigPreview("https://pay.hotmart.com/example", {
      provider: "hotmart",
      forwardUtms: false,
      mappings: [
        utm.createUtmMapping({
          parameter: "arbitrary",
          source: "fixed",
          value: "unsupported",
        }),
      ],
    }),
    "",
    "vendor presets must reject mappings outside their documented allowlist",
  );

  const explicitReplacement = new URL(
    utm.checkoutConfigPreview("https://checkout.example.test/offer?name=old", {
      provider: "custom",
      forwardUtms: false,
      mappings: [
        utm.createUtmMapping({
          parameter: "name",
          source: "fixed",
          value: "new buyer",
          conflict: "replace",
        }),
      ],
    }),
  );
  assert.equal(
    explicitReplacement.searchParams.get("name"),
    "new buyer",
    "an explicit mapping may replace a non-protected value",
  );

  const eduzzForwarding = new URL(
    utm.checkoutConfigPreview(
      "https://sun.eduzz.com/example?utm_source=fixed#payment",
      { provider: "eduzz", forwardUtms: true, mappings: [] },
    ),
  );
  assert.equal(
    eduzzForwarding.searchParams.get("utm_source"),
    "fixed",
    "forwarding must preserve a UTM already fixed in the checkout link",
  );
  ["utm_medium", "utm_campaign", "utm_content"].forEach((key) => {
    assert.equal(eduzzForwarding.searchParams.get(key), `{${key}}`);
  });
  assert.equal(
    eduzzForwarding.searchParams.has("utm_term"),
    false,
    "Eduzz forwarding must omit undocumented utm_term",
  );
  assert.equal(eduzzForwarding.hash, "#payment");

  const deterministicProfile = {
    ...utm.createUtmProfile("checkout", "kiwify"),
    id: "checkout-main",
    name: "Checkout principal",
    baseUrl: "https://pay.kiwify.com.br/offer?coupon=SAVE",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };
  const deterministicLink = {
    ...utm.createUtmProfile("link"),
    id: "campaign-main",
    name: "Campanha principal",
    baseUrl: "https://example.test/landing",
    parameters: {
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "launch",
      utm_content: "",
      utm_term: "",
    },
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };
  const settings = {
    version: 999,
    profiles: [deterministicProfile, deterministicLink],
  };
  const project = projectWithMetadata({
    version: 1,
    name: "Metadata round-trip",
    untouched: { keep: true },
    analytics: { provider: "native", untouchedAnalytics: true },
    utmCenter: { profiles: [{ id: "stale-root" }] },
  });
  const writtenProject = utm.writeUtmCenterSettings(project, settings);
  const writtenMetadata = JSON.parse(
    writtenProject.files[".incode/project.json"].text,
  );
  assert.equal(
    writtenMetadata.utmCenter,
    undefined,
    "the deprecated root-level metadata key must be removed on write",
  );
  assert.deepEqual(writtenMetadata.untouched, { keep: true });
  assert.equal(writtenMetadata.analytics.provider, "native");
  assert.equal(writtenMetadata.analytics.untouchedAnalytics, true);
  assert.equal(
    writtenMetadata.analytics.utmCenterVersion,
    utm.UTM_CENTER_SCHEMA_VERSION,
  );
  assert.deepEqual(
    utm.readUtmCenterSettings(writtenProject),
    utm.normalizeUtmCenterSettings(settings),
    "UTM Center settings must survive a metadata write/read round-trip",
  );

  const legacyProject = projectWithMetadata({
    version: 1,
    analytics: {
      utms: {
        links: [
          {
            id: "legacy-link",
            name: "Legacy campaign",
            url: "https://example.test/legacy",
            utms: { utm_source: "newsletter" },
            createdAt: FIXED_DATE,
            updatedAt: FIXED_DATE,
          },
        ],
      },
    },
  });
  const normalizedLegacy = utm.readUtmCenterSettings(legacyProject);
  assert.equal(normalizedLegacy.profiles.length, 1);
  assert.equal(
    normalizedLegacy.profiles[0].baseUrl,
    "https://example.test/legacy",
  );
  assert.equal(
    normalizedLegacy.profiles[0].parameters.utm_source,
    "newsletter",
  );
  assert.equal(normalizedLegacy.profiles[0].provider, "custom");
  assert.equal(normalizedLegacy.profiles[0].forwardUtms, false);
  assert.equal(normalizedLegacy.profiles[0].rememberSession, false);

  const duplicateProfile = (index) => ({
    id: "duplicate",
    name: `Duplicate ${index}`,
    kind: "link",
    baseUrl: `https://example.test/${index}`,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  });
  const deduplicated = utm.normalizeUtmCenterSettings({
    profiles: [duplicateProfile(1), duplicateProfile(2), duplicateProfile(3)],
  });
  assert.deepEqual(
    deduplicated.profiles.map((profile) => profile.id),
    ["duplicate", "duplicate-2", "duplicate-3"],
    "duplicate profile IDs must be made stable and unique for rendering and persistence",
  );

  const overProfileLimit = utm.normalizeUtmCenterSettings({
    profiles: Array.from({ length: utm.MAX_UTM_PROFILES + 5 }, (_, index) => ({
      id: `profile-${index}`,
      name: `Profile ${index}`,
      kind: "link",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    })),
  });
  assert.equal(
    overProfileLimit.profiles.length,
    utm.MAX_UTM_PROFILES,
    "profile normalization must enforce the storage limit",
  );
  assert.equal(
    overProfileLimit.profiles.at(-1).id,
    `profile-${utm.MAX_UTM_PROFILES - 1}`,
  );

  const overMappingLimit = utm.normalizeFormUtmConfig({
    mappings: Array.from({ length: utm.MAX_UTM_MAPPINGS + 5 }, (_, index) => ({
      id: `mapping-${index}`,
      target: `parameter_${index}`,
      origin: { type: "fixed", value: `value-${index}` },
    })),
  });
  assert.equal(
    overMappingLimit.mappings.length,
    utm.MAX_UTM_MAPPINGS,
    "form normalization must enforce the mapping limit",
  );
  assert.equal(
    overMappingLimit.mappings.at(-1).parameter,
    `parameter_${utm.MAX_UTM_MAPPINGS - 1}`,
  );

  const maximumCanonicalConfig = utm.serializeFormUtmConfig({
    provider: "custom",
    mappings: Array.from({ length: utm.MAX_UTM_MAPPINGS }, (_, index) => {
      const suffix = String(index).padStart(2, "0");
      return {
        id: `m${suffix}${"i".repeat(93)}`,
        parameter: `p${suffix}`,
        source: "field",
        sourceKey: "missing_field",
        value: "v".repeat(1_000),
        transform: "none",
        conflict: "preserve",
      };
    }),
  });
  assert.ok(
    maximumCanonicalConfig.length > 16_384,
    "the canonical 40-row contract can legitimately exceed the old 16 KiB runtime ceiling",
  );
  assert.ok(
    maximumCanonicalConfig.length <= utm.MAX_FORM_UTM_CONFIG_LENGTH,
    "the runtime config ceiling must fit every canonical mapping row",
  );
  assert.ok(
    utm.checkoutConfigPreview(
      "https://checkout.example.test/large-config?keep=1",
      JSON.parse(maximumCanonicalConfig),
    ),
    "a maximum-sized canonical config with inactive field mappings remains structurally valid",
  );

  console.log("UTM Center regression tests passed.");
} finally {
  await server.close();
}
