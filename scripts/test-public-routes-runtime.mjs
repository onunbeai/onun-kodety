import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const runtimePath = new URL("../Wordpress/runtime-assets/public-routes-runtime.js", import.meta.url);
const runtime = await readFile(runtimePath, "utf8");

class FakeElement {
  constructor(attributes = {}, nodeName = "A") {
    this.attributes = new Map(Object.entries(attributes));
    this.nodeName = nodeName;
    this.nodeType = 1;
    this.children = [];
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

  querySelectorAll() {
    return this.children;
  }

  closest(selector) {
    return selector.includes("a[href]") && this.nodeName === "A" ? this : null;
  }

  matches(selector) {
    return selector === "form" && this.nodeName === "FORM";
  }
}

class FakeDocument {
  constructor(config, elements) {
    this.baseURI = "https://example.test/wp-content/themes/kodety-generated/site/";
    this.readyState = "complete";
    this.listeners = new Map();
    this.documentElement = new FakeElement({}, "HTML");
    this.documentElement.children = elements;
    this.configElement = { textContent: JSON.stringify(config) };
  }

  getElementById(id) {
    return id === "kodety-public-routes-config" ? this.configElement : null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, target) {
    (this.listeners.get(type) || []).forEach((listener) => listener({ target }));
  }
}

const elements = [
  new FakeElement({ href: "./contact.html" }),
  new FakeElement({ href: "#about" }),
  new FakeElement({ href: "./files/report.pdf" }),
  new FakeElement({ href: "https://external.test/page" }),
  new FakeElement({ "data-case-href": "./case.html?project=ampere" }, "SECTION"),
  new FakeElement({ href: "https://example.test/wp-content/themes/kodety-generated/site/cases.html?from=nav#grid" }),
];
const config = {
  currentFile: "index.html",
  currentUrl: "https://example.test/",
  publicBase: "https://example.test/",
  assetRoot: "https://example.test/wp-content/themes/kodety-generated/site/",
  webRoot: "",
  routes: {
    "index.html": "https://example.test/",
    "cases.html": "https://example.test/cases",
    "contact.html": "https://example.test/contact",
    "case.html": "https://example.test/case",
  },
  routeAliases: {
    index: "https://example.test/",
    cases: "https://example.test/cases",
    contact: "https://example.test/contact",
    case: "https://example.test/case",
  },
};
const document = new FakeDocument(config, elements);
const window = {
  location: { href: "https://example.test/", origin: "https://example.test" },
};

vm.runInContext(
  runtime,
  vm.createContext({ console, document, URL, window }),
  { filename: runtimePath.pathname },
);

assert.equal(elements[0].getAttribute("href"), "https://example.test/contact");
assert.equal(elements[1].getAttribute("href"), "https://example.test/#about");
assert.equal(elements[2].getAttribute("href"), "./files/report.pdf", "Assets não podem ser confundidos com páginas.");
assert.equal(elements[3].getAttribute("href"), "https://external.test/page", "Links externos não podem ser alterados.");
assert.equal(elements[4].getAttribute("data-case-href"), "https://example.test/case?project=ampere");
assert.equal(elements[5].getAttribute("href"), "https://example.test/cases?from=nav#grid");

const dynamicLink = new FakeElement({ href: "./cases.html" });
document.dispatch("click", dynamicLink);
assert.equal(
  dynamicLink.getAttribute("href"),
  "https://example.test/cases",
  "Um link criado pelo JavaScript precisa ser limpo antes da navegação padrão.",
);

const dynamicForm = new FakeElement({ action: "./contact.html" }, "FORM");
document.dispatch("submit", dynamicForm);
assert.equal(dynamicForm.getAttribute("action"), "https://example.test/contact");

console.log("Runtime de rotas públicas Kodety aprovado.");
