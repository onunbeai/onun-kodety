import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sourcePath = new URL("../Wordpress/runtime-assets/forms-runtime.js", import.meta.url);
const packagedPath = new URL("../Wordpress/kodety/assets/forms-runtime.js", import.meta.url);
const editorPath = new URL("../lib/html-editor/editor-constants.ts", import.meta.url);
const [source, packaged, editorSource] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(packagedPath, "utf8"),
  readFile(editorPath, "utf8"),
]);

if (process.env.KODETY_FORMS_SOURCE_ONLY !== "1") {
  assert.equal(
    packaged,
    source,
    "O runtime empacotado deve ser copiado da fonte por scripts/package-wordpress-plugin.mjs.",
  );
}
assert.match(
  editorSource,
  /form: `<form[^`]*method="post"[^`]*enctype="multipart\/form-data"/,
  "Forms novos precisam declarar transporte multipart para aceitar File Upload.",
);
assert.match(
  editorSource,
  /'file-upload': `<label[^`]*<input[^>]*type="file"[^>]*name="file"[^>]*accept="[^"]*\.pdf[^"]*"/,
  "File Upload novo precisa ter name e uma allow-list visível para entrar no FormData.",
);

class FakeStyle {
  constructor() {
    this.values = new Map();
    this.priorities = new Map();
    this.cssText = "";
  }

  get display() {
    return this.getPropertyValue("display");
  }

  set display(value) {
    this.setProperty("display", value);
  }

  getPropertyValue(name) {
    return this.values.get(name) || "";
  }

  getPropertyPriority(name) {
    return this.priorities.get(name) || "";
  }

  setProperty(name, value, priority = "") {
    this.values.set(name, String(value));
    if (priority) this.priorities.set(name, String(priority));
    else this.priorities.delete(name);
  }

  removeProperty(name) {
    const value = this.getPropertyValue(name);
    this.values.delete(name);
    this.priorities.delete(name);
    return value;
  }
}

class FakeElement extends EventTarget {
  constructor(attributes = {}, tagName = "DIV") {
    super();
    this.attributes = new Map(Object.entries(attributes));
    this.dataset = {};
    this.tagName = tagName;
    this.hidden = false;
    this.children = [];
    this.selectorMap = new Map();
    this.style = new FakeStyle();
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.disabled = false;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  matches(selector) {
    return selector === "form" ? this.tagName === "FORM" : false;
  }

  closest() {
    return null;
  }

  querySelector(selector) {
    return this.selectorMap.get(selector) || null;
  }

  querySelectorAll() {
    return [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  contains(target) {
    return target === this || this.children.some((child) => child === target || child.contains?.(target));
  }

  focus() {}
}

class FakeForm extends FakeElement {
  constructor(attributes = {}) {
    super(attributes, "FORM");
    this.id = "";
    this.submitControls = [new FakeElement({}, "BUTTON")];
    this.submitControls[0].innerHTML = "Send";
    this.unnamedFileInputs = [];
    this.elements = [];
    this.resetCalls = 0;
  }

  querySelectorAll(selector) {
    if (selector === 'input[type="file"]:not([name])') return this.unnamedFileInputs;
    if (selector.includes('button[type="submit"]')) return this.submitControls;
    return [];
  }

  reset() {
    this.resetCalls += 1;
    this.elements.forEach((control) => {
      if (control && "value" in control) control.value = "";
    });
    this.dispatchEvent(new Event("reset"));
  }
}

class FakeFormData {
  constructor(form) {
    this.values = new Map();
    (form?.elements || []).forEach((control) => {
      if (!control?.name || control.disabled) return;
      if ((control.type === "checkbox" || control.type === "radio") && !control.checked) return;
      this.values.set(control.name, String(control.value ?? ""));
    });
  }

  set(name, value) {
    this.values.set(name, value);
  }

  has(name) {
    return this.values.has(name);
  }

  get(name) {
    return this.values.get(name) ?? null;
  }

  forEach(callback) {
    this.values.forEach((value, name) => callback(value, name, this));
  }
}

class FakeCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

class FakeDocument {
  constructor(forms, selectors = {}) {
    this.forms = forms;
    this.selectors = new Map(Object.entries(selectors));
    this.listeners = new Map();
    this.readyState = "complete";
    this.referrer = "https://example.test/origem?token=nao-deve-ser-enviado-aqui";
    this.documentElement = new FakeElement({}, "HTML");
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  querySelector(selector) {
    return this.selectors.get(selector) || null;
  }

  querySelectorAll(selector) {
    return selector === "form" ? this.forms : [];
  }

  createElement(tagName) {
    return new FakeElement({}, String(tagName).toUpperCase());
  }

  dispatchDelegatedSubmit(form) {
    const event = {
      target: form,
      defaultPrevented: false,
      immediatePropagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; },
    };
    (this.listeners.get("submit") || []).forEach((listener) => listener(event));
    return event;
  }
}

function attachStatuses(form) {
  const done = new FakeElement({ "data-kodety-form-success": "" });
  const doneMessage = new FakeElement({ "data-kodety-form-message": "" });
  done.hidden = true;
  done.selectorMap.set("[data-kodety-form-message]", doneMessage);
  done.children.push(doneMessage);
  const fail = new FakeElement({ "data-kodety-form-error": "" });
  const failMessage = new FakeElement({ "data-kodety-form-message": "" });
  fail.hidden = true;
  fail.selectorMap.set("[data-kodety-form-message]", failMessage);
  fail.children.push(failMessage);
  form.selectorMap.set("[data-kodety-form-success]", done);
  form.selectorMap.set("[data-kodety-form-error]", fail);
  return { done, doneMessage, fail, failMessage };
}

function executeRuntime(forms, {
  selectors = {},
  endpoint = "https://example.test/wp-json/kodety/v1/forms/submit",
  pageUrl = "https://example.test/contato",
  sessionValues = new Map(),
  doNotTrack = "0",
  utmEnabled = true,
  installServerConfig = true,
  online = true,
  fetchImpl,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  beforeServerConfig,
  beforeRuntime,
} = {}) {
  const bootstrapToken = "12345678123441238123123456789012";
  const serverConfigKey = `__kodetyFormsServerConfig_${bootstrapToken}`;
  const fetchCalls = [];
  const assignedUrls = [];
  const document = new FakeDocument(forms, selectors);
  document.currentScript = {
    src: `https://example.test/wp-content/plugins/kodety/assets/forms-runtime.js?ver=test#kodety-forms-bootstrap=${bootstrapToken}`,
  };
  const windowListeners = new Map();
  const window = {
    location: {
      href: pageUrl,
      assign: (url) => assignedUrls.push(url),
    },
    navigator: { doNotTrack, onLine: online },
    sessionStorage: {
      getItem: (key) => sessionValues.has(key) ? sessionValues.get(key) : null,
      setItem: (key, value) => sessionValues.set(key, String(value)),
      removeItem: (key) => sessionValues.delete(key),
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    getComputedStyle: (element) => ({
      display: element.style.getPropertyValue("display") || (element.hidden ? "none" : "block"),
    }),
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
  };
  beforeServerConfig?.(window, { bootstrapToken, serverConfigKey });
  const serverConfig = Object.freeze({
    endpoint,
    successMessage: "Enviado.",
    errorMessage: "Falhou.",
    utmEnabled,
    bootstrapToken,
  });
  if (installServerConfig) {
    try {
      Object.defineProperty(window, serverConfigKey, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: serverConfig,
      });
    } catch {}
    try {
      Object.defineProperty(window, "kodetyForms", {
        configurable: false,
        enumerable: true,
        writable: false,
        value: serverConfig,
      });
    } catch {}
  }
  beforeRuntime?.(window, { bootstrapToken, serverConfigKey });
  const fetch = (...args) => {
    fetchCalls.push(args);
    if (fetchImpl) return fetchImpl(...args);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, message: "Enviado." }),
    });
  };
  vm.runInContext(
    source,
    vm.createContext({
      console,
      AbortController,
      CustomEvent: FakeCustomEvent,
      document,
      fetch,
      FormData: FakeFormData,
      URL,
      URLSearchParams,
      window,
    }),
    { filename: sourcePath.pathname },
  );
  return { assignedUrls, document, fetchCalls, sessionValues, window };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

for (const attributes of [
  { "data-kodety-member-form": "login" },
  { "data-kodety-member-form": "" },
  { "data-kodety-form-action": "member-register" },
]) {
  const form = new FakeForm(attributes);
  let routed = null;
  form.addEventListener("kodety:member-form:ready", (event) => {
    routed = event.detail;
  });
  const runtime = executeRuntime([form]);

  assert.equal(form.dataset.kodetyFormsRoute, "member");
  assert.equal(routed?.form, form);
  assert.equal(
    routed?.action,
    attributes["data-kodety-form-action"] || attributes["data-kodety-member-form"],
  );
  const submit = new Event("submit", { cancelable: true });
  form.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, false, "O runtime genérico não deve capturar o form de membro.");
  assert.equal(runtime.fetchCalls.length, 0, "Credenciais/comandos de membro nunca devem chegar ao endpoint de leads.");
}

const regularForm = new FakeForm({ name: "contato" });
const legacyFileInput = { name: "" };
regularForm.unnamedFileInputs.push(legacyFileInput);
let successEvents = 0;
regularForm.addEventListener("kodety:form:success", () => {
  successEvents += 1;
});
const regularRuntime = executeRuntime([regularForm]);
const regularSubmit = new Event("submit", { cancelable: true });
regularForm.dispatchEvent(regularSubmit);
await settle();

assert.equal(regularSubmit.defaultPrevented, true);
assert.equal(regularRuntime.fetchCalls.length, 1, "Forms comuns devem continuar usando a captura Kodety.");
assert.equal(regularForm.dataset.kodetyFormsBound, "true");
assert.equal(legacyFileInput.name, "file", "File Upload legado sem name deve entrar no FormData.");
assert.equal(successEvents, 1);

for (const invalidResponse of [
  {
    label: "JSON inválido",
    response: { ok: true, json: () => Promise.reject(new SyntaxError("invalid json")) },
  },
  {
    label: "sucesso parcial",
    response: { ok: true, json: () => Promise.resolve({ message: "sem recibo" }) },
  },
]) {
  const form = new FakeForm({ name: `invalid-${invalidResponse.label}` });
  const status = attachStatuses(form);
  let errorEvents = 0;
  form.addEventListener("kodety:form:error", () => { errorEvents += 1; });
  const runtime = executeRuntime([form], {
    fetchImpl: () => Promise.resolve(invalidResponse.response),
  });
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  assert.equal(runtime.fetchCalls.length, 1, `${invalidResponse.label} não deve causar retry automático do POST.`);
  assert.equal(status.done.hidden, true, `${invalidResponse.label} não pode ser tratado como sucesso.`);
  assert.equal(status.fail.hidden, false, `${invalidResponse.label} deve revelar o erro acionável.`);
  assert.equal(errorEvents, 1);
  assert.equal(form.getAttribute("aria-busy"), "false", "o formulário precisa sair do estado busy após falha fechada.");
}

const timeoutForm = new FakeForm({ name: "timeout" });
const timeoutStatus = attachStatuses(timeoutForm);
let timeoutDelay = 0;
let clearedTimeout = 0;
const timeoutRuntime = executeRuntime([timeoutForm], {
  fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }),
  setTimeoutImpl: (callback, delay) => {
    timeoutDelay = delay;
    Promise.resolve().then(callback);
    return 77;
  },
  clearTimeoutImpl: (id) => { clearedTimeout = id; },
});
timeoutForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(timeoutDelay, 12000, "o POST público deve ter timeout finito.");
assert.equal(timeoutRuntime.fetchCalls.length, 1, "timeout não pode repetir uma mutação automaticamente.");
assert.match(timeoutStatus.failMessage.textContent, /took too long/i);
assert.equal(clearedTimeout, 77, "o timer de cancelamento precisa ser limpo ao terminar.");
assert.equal(timeoutForm.getAttribute("aria-busy"), "false");

const offlineForm = new FakeForm({ name: "offline" });
const offlineStatus = attachStatuses(offlineForm);
const offlineRuntime = executeRuntime([offlineForm], {
  online: false,
  fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
});
offlineForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(offlineRuntime.fetchCalls.length, 1);
assert.match(offlineStatus.failMessage.textContent, /offline/i, "falha offline deve orientar reconexão.");

for (const action of ["message", "element", "redirect"]) {
  const form = new FakeForm({ name: `form-${action}` });
  form.dataset.kodetySuccessAction = action;
  form.dataset.kodetyResetOnSuccess = "false";
  const status = attachStatuses(form);
  const overlay = new FakeElement({}, "SECTION");
  const overlayMessage = new FakeElement({ "data-kodety-form-message": "" });
  overlay.hidden = true;
  overlay.selectorMap.set("[data-kodety-form-message]", overlayMessage);
  overlay.children.push(overlayMessage);
  if (action === "element") form.dataset.kodetySuccessTarget = "#success-overlay";
  if (action === "redirect") form.dataset.kodetyRedirectUrl = "https://example.test/obrigado";
  const runtime = executeRuntime([form], { selectors: { "#success-overlay": overlay } });
  const submit = new Event("submit", { cancelable: true });
  form.dispatchEvent(submit);
  await settle();

  assert.equal(submit.defaultPrevented, true, `${action} precisa impedir o POST nativo.`);
  assert.equal(runtime.fetchCalls.length, 1, `${action} precisa enviar ao endpoint Forms.`);
  if (action === "message") {
    assert.equal(status.done.hidden, false, "Show message precisa revelar o estado de sucesso nativo.");
    assert.equal(status.doneMessage.textContent, "Enviado.");
  }
  if (action === "element") {
    assert.equal(overlay.hidden, false, "Show element precisa revelar o seletor configurado.");
    assert.equal(overlayMessage.textContent, "Enviado.");
    assert.equal(status.done.hidden, true, "O estado inline não deve competir com o elemento externo.");
  }
  if (action === "redirect") {
    assert.deepEqual(runtime.assignedUrls, ["https://example.test/obrigado"]);
  }
}

const selfTargetForm = new FakeForm({ name: "self-target" });
selfTargetForm.dataset.kodetySuccessAction = "element";
selfTargetForm.dataset.kodetySuccessTarget = "#native-success";
selfTargetForm.dataset.kodetyResetOnSuccess = "false";
const selfTargetStatus = attachStatuses(selfTargetForm);
const selfTargetRuntime = executeRuntime([selfTargetForm], {
  selectors: { "#native-success": selfTargetStatus.done },
});
selfTargetForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(selfTargetRuntime.fetchCalls.length, 1);
assert.equal(selfTargetStatus.done.hidden, false, "O próprio bloco de sucesso não pode ser ocultado após ser revelado.");

const staleMarkerForm = new FakeForm({ name: "stale-marker" });
staleMarkerForm.dataset.kodetyFormsBound = "true";
staleMarkerForm.dataset.kodetyResetOnSuccess = "false";
const staleRuntime = executeRuntime([staleMarkerForm]);
const staleSubmit = new Event("submit", { cancelable: true });
staleMarkerForm.dispatchEvent(staleSubmit);
await settle();
assert.equal(staleSubmit.defaultPrevented, true, "Um marker serializado não pode desativar a captura real.");
assert.equal(staleRuntime.fetchCalls.length, 1);

const lateRuntime = executeRuntime([]);
const lateForm = new FakeForm({ name: "late-form" });
lateForm.dataset.kodetyResetOnSuccess = "false";
const delegatedSubmit = lateRuntime.document.dispatchDelegatedSubmit(lateForm);
await settle();
assert.equal(delegatedSubmit.defaultPrevented, true, "Forms dinâmicos precisam ser capturados no primeiro submit.");
assert.equal(lateRuntime.fetchCalls.length, 1, "Forms dinâmicos devem reutilizar o snapshot válido capturado no boot.");

const disabledForm = new FakeForm({ name: "disabled" });
const disabledRuntime = executeRuntime([disabledForm], { endpoint: "" });
const disabledSubmit = new Event("submit", { cancelable: true });
disabledForm.dispatchEvent(disabledSubmit);
assert.equal(disabledSubmit.defaultPrevented, false, "Sem endpoint, o runtime não deve fingir que capturou o envio.");
assert.equal(disabledRuntime.fetchCalls.length, 0);

const cmsForm = new FakeForm({ name: "novo-lead" });
cmsForm.dataset.kodetyCmsCollection = "kodety_leads";
cmsForm.dataset.kodetyCmsStatus = "draft";
cmsForm.dataset.kodetyCmsMap = '{"email":"field:email","name":"title"}';
cmsForm.dataset.kodetyCmsToken = "a".repeat(64);
const cmsRuntime = executeRuntime([cmsForm]);
cmsForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
const cmsPayload = cmsRuntime.fetchCalls[0]?.[1]?.body?.values;
assert.equal(cmsPayload.get("_kodety_cms_collection"), "kodety_leads");
assert.equal(cmsPayload.get("_kodety_cms_status"), "draft");
assert.equal(cmsPayload.get("_kodety_cms_map"), '{"email":"field:email","name":"title"}');
assert.equal(cmsPayload.get("_kodety_cms_token"), "a".repeat(64));

function configureUtmRedirect(form, config, redirectUrl = "https://pay.hotmart.com/OFERTA") {
  form.dataset.kodetySuccessAction = "redirect";
  form.dataset.kodetyRedirectUrl = redirectUrl;
  form.setAttribute("data-kodety-redirect-url", redirectUrl);
  form.setAttribute("data-kodety-utm-enabled", "true");
  form.setAttribute("data-kodety-utm-config", JSON.stringify({ version: 1, ...config }));
}

const checkoutForm = new FakeForm({ name: "checkout-hotmart" });
checkoutForm.elements = [
  { name: "full_name", value: "  Maria da Silva  ", type: "text" },
  { name: "email", value: "maria+lead@example.test", type: "email" },
  { name: "phone", value: "+55 (11) 99999-1234", type: "tel" },
];
configureUtmRedirect(checkoutForm, {
  provider: "hotmart",
  forwardUtms: true,
  rememberSession: false,
  mappings: [
    { id: "name", parameter: "name", source: "field", sourceKey: "full_name", value: "", transform: "trim", conflict: "replace" },
    { id: "email", parameter: "email", source: "field", sourceKey: "email", value: "", transform: "trim", conflict: "replace" },
    { id: "ddd", parameter: "phoneac", source: "field", sourceKey: "phone", value: "", transform: "phone_area", conflict: "replace" },
    { id: "phone", parameter: "phonenumber", source: "field", sourceKey: "phone", value: "", transform: "phone_number", conflict: "replace" },
    { id: "sck", parameter: "sck", source: "fixed", sourceKey: "", value: "nao-sobrescrever", transform: "trim", conflict: "replace" },
  ],
}, "https://pay.hotmart.com/OFERTA?sck=referencia-original&coupon=BEMVINDO#checkout");
const checkoutRuntime = executeRuntime([checkoutForm], {
  pageUrl: "https://example.test/vendas?utm_source=instagram&utm_medium=social&utm_campaign=lancamento&utm_content=stories&utm_term=curso&ref=parceiro",
});
checkoutForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(checkoutForm.resetCalls, 1, "O formulário continua sendo limpo após a submissão aceita.");
const hotmartRedirect = new URL(checkoutRuntime.assignedUrls[0]);
assert.equal(hotmartRedirect.searchParams.get("name"), "Maria da Silva", "Os campos precisam ser fotografados antes do reset.");
assert.equal(hotmartRedirect.searchParams.get("email"), "maria+lead@example.test");
assert.equal(hotmartRedirect.searchParams.get("phoneac"), "11");
assert.equal(hotmartRedirect.searchParams.get("phonenumber"), "999991234");
assert.equal(hotmartRedirect.searchParams.get("sck"), "referencia-original", "Parâmetros protegidos nunca podem ser sobrescritos.");
assert.equal(hotmartRedirect.searchParams.get("coupon"), "BEMVINDO", "A query original do checkout deve ser preservada.");
assert.equal(hotmartRedirect.searchParams.get("utm_source"), "instagram");
assert.equal(hotmartRedirect.searchParams.get("utm_term"), "curso");
assert.equal(hotmartRedirect.hash, "#checkout");

for (const providerCase of [
  {
    provider: "ticto",
    fieldParameter: "phonenumber",
    protectedParameter: "pid",
    protectedParameterInUrl: "PID",
    protectedValue: "produto-original",
  },
  {
    provider: "kiwify",
    fieldParameter: "phone",
    protectedParameter: "afid",
    protectedParameterInUrl: "AFID",
    protectedValue: "afiliado-original",
  },
]) {
  const form = new FakeForm({ name: `checkout-${providerCase.provider}` });
  form.elements = [{ name: "phone", value: "+55 (11) 99999-1234", type: "tel" }];
  configureUtmRedirect(form, {
    provider: providerCase.provider,
    forwardUtms: false,
    mappings: [
      { parameter: providerCase.fieldParameter, source: "field", sourceKey: "phone", transform: "digits", conflict: "replace" },
      { parameter: providerCase.protectedParameter, source: "fixed", value: "replacement", transform: "trim", conflict: "replace" },
    ],
  }, `https://checkout.example.test/oferta?${providerCase.protectedParameterInUrl}=${providerCase.protectedValue}&keep=1#payment`);
  const runtime = executeRuntime([form]);
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  const redirect = new URL(runtime.assignedUrls[0]);
  assert.equal(redirect.searchParams.get(providerCase.fieldParameter), "5511999991234", `${providerCase.provider} deve aceitar seu parâmetro oficial de telefone.`);
  assert.equal(redirect.searchParams.get(providerCase.protectedParameterInUrl), providerCase.protectedValue, `${providerCase.provider} deve preservar parâmetro protegido sem depender de caixa.`);
  assert.equal(redirect.searchParams.has(providerCase.protectedParameter), false, `${providerCase.provider} não pode criar uma variante duplicada do parâmetro protegido.`);
  assert.equal(redirect.searchParams.get("keep"), "1");
  assert.equal(redirect.hash, "#payment");
}

const optOutForm = new FakeForm({ name: "utm-off" });
optOutForm.dataset.kodetySuccessAction = "redirect";
optOutForm.dataset.kodetyRedirectUrl = "https://example.test/redirect-legado?fixo=1";
optOutForm.setAttribute("data-kodety-utm-config", JSON.stringify({
  version: 1,
  provider: "custom",
  forwardUtms: true,
  mappings: [{ parameter: "email", source: "fixed", value: "nao-enviar@example.test" }],
}));
const optOutRuntime = executeRuntime([optOutForm], {
  pageUrl: "https://example.test/?utm_source=nao-copiar",
});
optOutForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.deepEqual(optOutRuntime.assignedUrls, ["https://example.test/redirect-legado?fixo=1"], "Sem opt-in explícito, o redirect deve permanecer byte a byte no fluxo legado.");

const freePlanForm = new FakeForm({ name: "utm-free-plan" });
configureUtmRedirect(freePlanForm, {
  provider: "custom",
  forwardUtms: true,
  mappings: [{ parameter: "email", source: "fixed", value: "hidden@example.test" }],
}, "https://checkout.example.test/oferta?legado=1");
const freePlanRuntime = executeRuntime([freePlanForm], {
  pageUrl: "https://example.test/?utm_source=nao-aplicar",
  utmEnabled: false,
  beforeRuntime: (window, { serverConfigKey }) => {
    assert.equal(
      Reflect.set(window[serverConfigKey], "utmEnabled", true),
      false,
      "A configuração server-injetada deve estar congelada antes do runtime diferido executar.",
    );
    assert.equal(
      Reflect.set(window, serverConfigKey, Object.freeze({ utmEnabled: true })),
      false,
      "O snapshot interno não pode ser substituído por um script autorado entre config e runtime.",
    );
    assert.equal(
      Reflect.set(window.kodetyForms, "utmEnabled", true),
      false,
      "O alias público também deve permanecer imutável.",
    );
  },
});
freePlanForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.deepEqual(
  freePlanRuntime.assignedUrls,
  ["https://checkout.example.test/oferta?legado=1"],
  "O runtime Free precisa ignorar uma configuração UTM forjada no DOM.",
);

const beforeBootstrapForm = new FakeForm({ name: "utm-authored-before-bootstrap" });
configureUtmRedirect(beforeBootstrapForm, {
  provider: "custom",
  forwardUtms: true,
  mappings: [{ parameter: "canal", source: "fixed", value: "nao-aplicar" }],
}, "https://checkout.example.test/legado-before?keep=1");
const beforeBootstrapRuntime = executeRuntime([beforeBootstrapForm], {
  utmEnabled: false,
  beforeServerConfig: (window) => {
    Object.defineProperty(window, "kodetyForms", {
      configurable: false,
      value: { endpoint: "https://attacker.invalid/submit", utmEnabled: true },
      writable: false,
    });
  },
});
beforeBootstrapForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.deepEqual(
  beforeBootstrapRuntime.assignedUrls,
  ["https://checkout.example.test/legado-before?keep=1"],
  "Um global público plantado antes do bootstrap não pode liberar UTM no runtime Free.",
);
assert.equal(
  beforeBootstrapRuntime.fetchCalls[0]?.[0],
  "https://example.test/wp-json/kodety/v1/forms/submit",
  "O runtime deve usar o snapshot interno autenticado, não o global público plantado pelo site.",
);

const afterRuntimeForm = new FakeForm({ name: "utm-authored-after-runtime" });
configureUtmRedirect(afterRuntimeForm, {
  provider: "custom",
  forwardUtms: true,
  mappings: [{ parameter: "canal", source: "fixed", value: "nao-aplicar" }],
}, "https://checkout.example.test/legado-after?keep=1");
Reflect.set(freePlanRuntime.window, "kodetyForms", { utmEnabled: true });
Reflect.set(freePlanRuntime.window.kodetyForms, "utmEnabled", true);
freePlanRuntime.document.dispatchDelegatedSubmit(afterRuntimeForm);
await settle();
assert.deepEqual(
  freePlanRuntime.assignedUrls,
  [
    "https://checkout.example.test/oferta?legado=1",
    "https://checkout.example.test/legado-after?keep=1",
  ],
  "Alterar o global e inserir um formulário depois do boot não pode mudar a decisão Free capturada.",
);

const poisonedInternalForm = new FakeForm({ name: "utm-poisoned-internal-config" });
configureUtmRedirect(poisonedInternalForm, {
  provider: "custom",
  mappings: [{ parameter: "canal", source: "fixed", value: "nao-aplicar" }],
}, "https://checkout.example.test/nao-interceptar");
const poisonedInternalRuntime = executeRuntime([poisonedInternalForm], {
  utmEnabled: false,
  installServerConfig: false,
  beforeServerConfig: (window, { serverConfigKey }) => {
    Object.defineProperty(window, serverConfigKey, {
      configurable: false,
      value: Object.freeze({
        endpoint: "https://attacker.invalid/submit",
        utmEnabled: true,
        bootstrapToken: "0".repeat(32),
      }),
      writable: false,
    });
  },
});
poisonedInternalForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(poisonedInternalRuntime.fetchCalls.length, 0, "Colisão no snapshot interno deve falhar fechada.");
assert.equal(poisonedInternalRuntime.assignedUrls.length, 0, "Configuração interna sem o token da resposta nunca deve executar UTM.");

const noPassthroughForm = new FakeForm({ name: "utm-forward-off" });
configureUtmRedirect(noPassthroughForm, {
  provider: "custom",
  forwardUtms: false,
  rememberSession: false,
  mappings: [{ parameter: "canal", source: "utm", sourceKey: "utm_source", value: "", transform: "trim", conflict: "preserve" }],
}, "https://checkout.outro.test/oferta?fixo=1#fim");
const noPassthroughRuntime = executeRuntime([noPassthroughForm], {
  pageUrl: "https://example.test/?utm_source=meta&utm_campaign=campanha&token=secreto",
});
noPassthroughForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
const noPassthroughUrl = new URL(noPassthroughRuntime.assignedUrls[0]);
assert.equal(noPassthroughUrl.searchParams.get("canal"), "meta", "Custom deve aceitar qualquer parâmetro seguro mapeado explicitamente.");
assert.equal(noPassthroughUrl.searchParams.has("utm_source"), false, "O passthrough é um toggle independente e começa desligado.");
assert.equal(noPassthroughUrl.searchParams.has("token"), false, "Query não allowlisted nunca deve ser copiada por acidente.");
assert.equal(noPassthroughUrl.hash, "#fim");

const templateForm = new FakeForm({ name: "template-custom" });
templateForm.elements = [{ name: "email", value: "lead@example.test", type: "email" }];
configureUtmRedirect(templateForm, {
  provider: "custom",
  forwardUtms: false,
  mappings: [{ parameter: "tracking", source: "template", sourceKey: "", value: "{utm_source}|{query:ref}|{field:email}", transform: "none", conflict: "replace" }],
}, "https://checkout.outro.test/oferta");
const templateRuntime = executeRuntime([templateForm], {
  pageUrl: "https://example.test/?utm_source=youtube&ref=video-01",
});
templateForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(new URL(templateRuntime.assignedUrls[0]).searchParams.get("tracking"), "youtube|video-01|lead@example.test");

const eduzzForm = new FakeForm({ name: "eduzz" });
configureUtmRedirect(eduzzForm, {
  provider: "eduzz",
  forwardUtms: true,
  mappings: [],
}, "https://sun.eduzz.com/oferta");
const eduzzRuntime = executeRuntime([eduzzForm], {
  pageUrl: "https://example.test/?utm_source=google&utm_medium=cpc&utm_campaign=marca&utm_content=criativo&utm_term=nao-oficial",
});
eduzzForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
const eduzzUrl = new URL(eduzzRuntime.assignedUrls[0]);
assert.equal(eduzzUrl.searchParams.get("utm_content"), "criativo");
assert.equal(eduzzUrl.searchParams.has("utm_term"), false, "O preset Eduzz deve ficar restrito às quatro UTMs documentadas.");

const invalidEduzzTermForm = new FakeForm({ name: "eduzz-invalid-term" });
configureUtmRedirect(invalidEduzzTermForm, {
  provider: "eduzz",
  forwardUtms: false,
  mappings: [{ parameter: "utm_term", source: "fixed", value: "nao-oficial" }],
}, "https://sun.eduzz.com/fallback?legado=1");
const invalidEduzzTermRuntime = executeRuntime([invalidEduzzTermForm]);
invalidEduzzTermForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.deepEqual(invalidEduzzTermRuntime.assignedUrls, ["https://sun.eduzz.com/fallback?legado=1"], "Eduzz com utm_term explícito deve falhar fechado e usar o redirect legado.");

const sessionValues = new Map();
const sessionCaptureForm = new FakeForm({ name: "session-capture" });
configureUtmRedirect(sessionCaptureForm, {
  provider: "custom",
  forwardUtms: true,
  rememberSession: true,
  mappings: [],
}, "https://checkout.outro.test/primeira");
const sessionCaptureRuntime = executeRuntime([sessionCaptureForm], {
  pageUrl: "https://example.test/landing?utm_source=newsletter&utm_campaign=boas-vindas",
  sessionValues,
});
sessionCaptureForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(new URL(sessionCaptureRuntime.assignedUrls[0]).searchParams.get("utm_source"), "newsletter");
const sessionReuseForm = new FakeForm({ name: "session-reuse" });
configureUtmRedirect(sessionReuseForm, {
  provider: "custom",
  forwardUtms: true,
  rememberSession: true,
  mappings: [],
}, "https://checkout.outro.test/segunda");
const sessionReuseRuntime = executeRuntime([sessionReuseForm], {
  pageUrl: "https://example.test/segunda-pagina",
  sessionValues,
});
sessionReuseForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(new URL(sessionReuseRuntime.assignedUrls[0]).searchParams.get("utm_campaign"), "boas-vindas", "A sessão deve recuperar somente as UTMs previamente filtradas.");

const dntValues = new Map();
const dntForm = new FakeForm({ name: "dnt" });
configureUtmRedirect(dntForm, {
  provider: "custom",
  forwardUtms: true,
  rememberSession: true,
  mappings: [],
}, "https://checkout.outro.test/dnt");
const dntRuntime = executeRuntime([dntForm], {
  pageUrl: "https://example.test/?utm_source=privado",
  sessionValues: dntValues,
  doNotTrack: "1",
});
dntForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.equal(dntValues.size, 0, "DNT deve impedir qualquer persistência de atribuição em sessionStorage.");
assert.equal(new URL(dntRuntime.assignedUrls[0]).searchParams.get("utm_source"), "privado", "DNT não precisa descartar a UTM presente na URL atual.");

const maximumCanonicalMappings = Array.from({ length: 40 }, (_, index) => {
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
});
const maximumCanonicalRuntimeConfig = {
  provider: "custom",
  forwardUtms: false,
  rememberSession: false,
  mappings: maximumCanonicalMappings,
};
assert.ok(JSON.stringify({ version: 1, ...maximumCanonicalRuntimeConfig }).length > 16_384, "O teste precisa ultrapassar o teto legado de 16 KiB.");
const maximumConfigForm = new FakeForm({ name: "maximum-canonical-config" });
configureUtmRedirect(maximumConfigForm, maximumCanonicalRuntimeConfig, "https://checkout.outro.test/large-config?keep=1#payment");
const maximumConfigRuntime = executeRuntime([maximumConfigForm]);
maximumConfigForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
const maximumConfigUrl = new URL(maximumConfigRuntime.assignedUrls[0]);
assert.equal(maximumConfigUrl.searchParams.get("keep"), "1", "O runtime deve aceitar todas as 40 linhas dentro do contrato canônico, mesmo acima de 16 KiB.");
assert.equal(maximumConfigUrl.hash, "#payment");

const duplicateForm = new FakeForm({ name: "invalid-duplicate" });
configureUtmRedirect(duplicateForm, {
  provider: "custom",
  mappings: [
    { parameter: "ref", source: "fixed", value: "a" },
    { parameter: "REF", source: "fixed", value: "b" },
  ],
}, "https://checkout.outro.test/fallback?legado=1");
const duplicateRuntime = executeRuntime([duplicateForm]);
duplicateForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.deepEqual(duplicateRuntime.assignedUrls, ["https://checkout.outro.test/fallback?legado=1"], "Config inválida deve cair integralmente no redirect legado.");

const blankDraftForm = new FakeForm({ name: "invalid-blank-draft" });
configureUtmRedirect(blankDraftForm, {
  provider: "custom",
  mappings: [{ id: "editable-draft", parameter: "", source: "field", sourceKey: "", transform: "trim", conflict: "preserve" }],
}, "https://checkout.outro.test/fallback?draft=1");
const blankDraftRuntime = executeRuntime([blankDraftForm]);
blankDraftForm.dispatchEvent(new Event("submit", { cancelable: true }));
await settle();
assert.deepEqual(blankDraftRuntime.assignedUrls, ["https://checkout.outro.test/fallback?draft=1"], "Uma linha vazia pode persistir no editor, mas o runtime deve rejeitá-la até ser configurada.");

console.log("Runtime de formulários Kodety aprovado.");
