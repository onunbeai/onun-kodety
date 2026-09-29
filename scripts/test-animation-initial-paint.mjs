import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false },
});
const pendingAttribute = "data-kodety-interactions-pending";

class Element {
  constructor(tag, id = "") {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map(id ? [["id", id]] : []);
    this.dataset = {};
    this.listeners = new Map();
    this.values = {};
    this.style = {};
    this.classList = {
      contains: (value) =>
        (this.getAttribute("class") || "").split(/\s+/).includes(value),
    };
  }
  get id() {
    return this.getAttribute("id") || "";
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  appendChild(element) {
    element.parentElement = this;
    this.children.push(element);
    return element;
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
    this.parentElement = null;
  }
  get nextElementSibling() {
    return (
      this.parentElement?.children[
        this.parentElement.children.indexOf(this) + 1
      ] || null
    );
  }
  get previousElementSibling() {
    return (
      this.parentElement?.children[
        this.parentElement.children.indexOf(this) - 1
      ] || null
    );
  }
  matches(selector) {
    if (selector === "[") throw new Error("Invalid selector");
    return selector.split(",").some((raw) => {
      const value = raw.trim();
      if (value === "*") return true;
      if (value.startsWith("#")) return this.id === value.slice(1);
      if (value.startsWith(".")) return this.classList.contains(value.slice(1));
      const attribute = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute)
        return (
          this.hasAttribute(attribute[1]) &&
          (attribute[2] === undefined ||
            this.getAttribute(attribute[1]) === attribute[2])
        );
      return value.toUpperCase() === this.tagName;
    });
  }
  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  getElementsByClassName(name) {
    return this.querySelectorAll("." + name);
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  removeEventListener(type) {
    this.listeners.delete(type);
  }
}

function environment({ frozen = false, width = 1280 } = {}) {
  const html = new Element("html");
  const head = html.appendChild(new Element("head"));
  const body = new Element("body");
  const ancestor = body.appendChild(new Element("section", "ancestor"));
  const parent = ancestor.appendChild(new Element("div", "parent"));
  const previous = parent.appendChild(new Element("p", "previous"));
  const trigger = parent.appendChild(new Element("div", "trigger"));
  const child = trigger.appendChild(new Element("span", "child"));
  const deep = child.appendChild(new Element("i", "deep"));
  const next = parent.appendChild(new Element("p", "next"));
  const sibling = parent.appendChild(new Element("p", "sibling"));
  const outside = body.appendChild(new Element("p", "outside"));
  outside.setAttribute("class", "special");
  outside.setAttribute("style", "color:red");
  const elements = {
    ancestor,
    parent,
    previous,
    trigger,
    child,
    deep,
    next,
    sibling,
    outside,
  };
  const timers = new Map();
  let timerId = 0;
  let observer;
  const listeners = new Map();
  const document = {
    documentElement: html,
    head,
    body: null,
    readyState: "loading",
    createElement: (tag) => new Element(tag),
    querySelectorAll: (selector) => html.querySelectorAll(selector),
    getElementsByClassName: (name) => html.getElementsByClassName(name),
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  };
  const window = {
    __KODETY_EDITOR_MOTION_FROZEN__: frozen,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
      this.disconnected = false;
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const execute = (code) =>
    new Function(
      "window",
      "document",
      "MutationObserver",
      "innerWidth",
      "setTimeout",
      "clearTimeout",
      "matchMedia",
      "CustomEvent",
      code,
    )(
      window,
      document,
      MutationObserver,
      width,
      window.setTimeout,
      window.clearTimeout,
      () => ({ matches: false }),
      class CustomEvent {},
    );
  return {
    document,
    window,
    head,
    elements,
    timers,
    execute,
    parseBody() {
      document.body = html.appendChild(body);
      if (observer && !observer.disconnected) observer.callback();
    },
    domReady() {
      document.readyState = "complete";
      listeners.get("DOMContentLoaded")?.();
    },
    mutate() {
      if (observer && !observer.disconnected) observer.callback();
    },
    get disconnected() {
      return observer?.disconnected;
    },
  };
}

try {
  const motion = await server.ssrLoadModule("/lib/html-editor/interactions.ts");
  const source =
    '<!doctype html><html><head></head><body><div id="trigger">Visible authored content</div></body></html>';
  const action = (scope = "trigger", selector = "") => ({
    ...motion.createInteractionAction(),
    id: scope,
    from: { opacity: 0, y: 30 },
    to: { opacity: 1, y: 0 },
    target: { scope, selector, mode: "selector", label: selector },
  });
  const definition = (actions = [action()], extra = {}) => ({
    id: "entrance",
    name: "Entrance",
    trigger: "load",
    triggerSelector: "#trigger",
    actions,
    ...extra,
  });
  const compile = (definitions) =>
    motion.patchInteractionDocument(source, {
      version: 2,
      interactions: definitions,
    });
  const script = (compiled, marker) =>
    compiled.match(
      new RegExp("<script " + marker + ">([\\s\\S]*?)<\\/script>"),
    )?.[1];
  const guard = (compiled) =>
    script(compiled, "data-kodety-interactions-initial-paint");
  const runtime = (compiled) =>
    script(compiled, "data-kodety-interactions-runtime");
  const compiled = compile([definition()]);
  assert.ok(
    guard(compiled),
    "initial From values cannot wait until the first visible DOMContentLoaded paint",
  );
  assert.ok(
    compiled.indexOf("<script data-kodety-interactions-initial-paint>") <
      compiled.indexOf("</head>"),
    "the guard must be installed before parsing visible body content",
  );
  assert.doesNotMatch(
    compiled,
    /<style[^>]*data-kodety-interactions-initial-paint|<body[^>]*(?:visibility|opacity)/,
    "without JS authored content must stay visible",
  );
  assert.doesNotMatch(
    motion.stripInteractionRuntime(compiled),
    /data-kodety-interactions-(?:initial-paint|runtime|dependency)/,
  );
  assert.equal(
    (
      motion
        .patchInteractionDocument(compiled, {
          version: 2,
          interactions: [definition()],
        })
        .match(/<script data-kodety-interactions-initial-paint>/g) || []
    ).length,
    1,
    "republication must not accumulate guards",
  );
  assert.equal(guard(compile([definition([])])), undefined);
  assert.equal(
    guard(compile([definition([action()], { enabled: false })])),
    undefined,
  );

  for (const kind of [
    "class-add",
    "class-remove",
    "class-toggle",
    "variable",
    "component-variant",
  ]) {
    const discreteAction = {
      ...motion.createInteractionAction(kind),
      id: `startup-${kind}`,
      className: "is-ready",
      componentId: "hero",
      componentVariantId: "hero-ready",
    };
    const discreteCompiled = compile([definition([discreteAction])]);
    const env = environment();
    env.execute(guard(discreteCompiled));
    env.parseBody();
    assert.equal(
      env.elements.trigger.hasAttribute(pendingAttribute),
      true,
      `load + ${kind} must not expose the authored state before its startup action`,
    );
    env.window.__kodetyInteractionsInitialPaint.release();

    assert.equal(
      guard(compile([definition([discreteAction], { trigger: "hover" })])),
      undefined,
      `${kind} on an event trigger must not conceal content at startup`,
    );
  }

  const scopes = {
    trigger: "",
    document: "#outside",
    children: "#child",
    descendants: "#deep",
    parent: "#parent",
    closest: "#ancestor",
    siblings: "#sibling",
    next: "#next",
    previous: "#previous",
  };
  for (const [scope, selector] of Object.entries(scopes)) {
    const env = environment();
    env.execute(guard(compile([definition([action(scope, selector)])])));
    assert.equal(env.document.body, null);
    env.parseBody();
    const expected =
      scope === "document"
        ? "outside"
        : scope === "children"
          ? "child"
          : scope === "descendants"
            ? "deep"
            : scope === "closest"
              ? "ancestor"
              : scope === "siblings"
                ? "sibling"
                : scope;
    assert.equal(
      env.elements[expected].hasAttribute(pendingAttribute),
      true,
      `${scope} target must be protected before a parser paint`,
    );
    assert.equal(
      Object.values(env.elements).filter((element) =>
        element.hasAttribute(pendingAttribute),
      ).length,
      1,
      `${scope} must not hide unrelated content`,
    );
    const guardState = env.window.__kodetyInteractionsInitialPaint;
    guardState.release();
    assert.equal(env.disconnected, true);
    assert.equal(env.timers.size, 0);
    assert.ok(
      Object.values(env.elements).every(
        (element) => !element.hasAttribute(pendingAttribute),
      ),
    );
    assert.equal(
      env.elements.outside.getAttribute("style"),
      "color:red",
      "guarding must never overwrite authored inline styles",
    );
    assert.equal(env.head.children.length, 0);
    env.mutate();
    assert.equal(env.elements[expected].hasAttribute(pendingAttribute), false);
  }
  for (const options of [{ frozen: true }, { width: 500 }]) {
    const env = environment(options);
    env.execute(
      guard(
        compile([definition([action()], { enabledBreakpoints: ["desktop"] })]),
      ),
    );
    env.parseBody();
    assert.equal(
      env.window.__kodetyInteractionsInitialPaint,
      undefined,
      "Design and disabled breakpoints must remain visible",
    );
    assert.equal(env.head.children.length, 0);
  }
  for (const triggerSelector of ["#missing", "["]) {
    const env = environment();
    env.execute(guard(compile([definition([action()], { triggerSelector })])));
    env.parseBody();
    assert.equal(
      env.document.body.hasAttribute(pendingAttribute),
      false,
      "invalid/missing targets must never fall back to hiding the page",
    );
    assert.ok(
      Object.values(env.elements).every(
        (element) => !element.hasAttribute(pendingAttribute),
      ),
    );
  }
  const legacy = environment();
  legacy.elements.trigger.setAttribute(
    "data-kodety-interaction-id",
    "legacy-trigger",
  );
  legacy.execute(
    guard(
      compile([
        definition(
          [
            {
              ...action("document", ".special"),
              target: {
                scope: "document",
                selector: ".special",
                mode: "class",
              },
            },
          ],
          {
            triggerSelector: '[data-kodety-interaction-id="legacy-trigger"]',
            triggerLabel: "div",
            triggerTargetMode: "element",
          },
        ),
      ]),
    ),
  );
  legacy.parseBody();
  assert.ok(
    legacy.elements.outside.hasAttribute(pendingAttribute),
    "legacy target identities must resolve exactly as in the timeline",
  );
  const keyframes = environment();
  keyframes.execute(
    guard(
      compile([
        definition([
          {
            ...action(),
            from: {},
            textSplit: "chars",
            keyframes: [
              { id: "a", time: 0, values: { opacity: 0 } },
              { id: "b", time: 1, values: { opacity: 1 } },
            ],
          },
        ]),
      ]),
    ),
  );
  keyframes.parseBody();
  assert.ok(
    keyframes.elements.trigger.hasAttribute(pendingAttribute),
    "split text must be protected before spans and first keyframes exist",
  );

  function installMotionEngine(env) {
    const calls = [];
    const set = (elements, values) => {
      calls.push({
        kind: "seed",
        protected: elements[0].hasAttribute(pendingAttribute),
        visibilityMasked: env.head.children.some(element => element.textContent?.includes('visibility:hidden')),
        values,
      });
      elements.forEach((element) => Object.assign(element.values, values));
    };
    env.window.__ONUN_MOTION_ENGINE__ = {
      set,
      to() {},
      timeline() {
        const sets = [];
        return {
          set(elements, values) {
            sets.push({ elements, values });
            calls.push({ kind: "set", values });
            return this;
          },
          fromTo() {
            calls.push({ kind: "animate" });
            return this;
          },
          to() {
            return this;
          },
          call() {
            return this;
          },
          play() {
            sets.forEach(({ elements, values }) => set(elements, values));
            return this;
          },
          pause() {
            return this;
          },
          progress() {
            return this;
          },
          totalTime() {
            return 0;
          },
          totalDuration() {
            return 0.5;
          },
          duration() {
            return 0.5;
          },
          reversed() {
            return false;
          },
          kill() {},
        };
      },
    };
    return calls;
  }
  const normal = environment();
  const normalCalls = installMotionEngine(normal);
  normal.execute(guard(compiled));
  normal.parseBody();
  normal.execute(runtime(compiled));
  assert.ok(
    normal.elements.trigger.hasAttribute(pendingAttribute),
    "waiting for DOMContentLoaded must not reveal the final state",
  );
  normal.domReady();
  assert.deepEqual(
    normalCalls.find((call) => call.kind === "seed"),
    { kind: "seed", protected: true, visibilityMasked: false, values: { opacity: 0, y: 30 } },
    "The Motion engine seeds before the guard reveals anything",
  );
  assert.equal(normal.elements.trigger.hasAttribute(pendingAttribute), false);
  assert.equal(normal.window.__kodetyInteractionsInitialPaint, undefined);

  const delayed = environment();
  const delayedCalls = installMotionEngine(delayed);
  delayed.execute(guard(compiled));
  delayed.parseBody();
  delayed.timers.values().next().value();
  assert.equal(delayed.window.__kodetyInteractionsInitialPaint.expired, true);
  assert.equal(
    delayed.elements.trigger.hasAttribute(pendingAttribute),
    false,
    "a missing runtime must release the content",
  );
  delayed.execute(runtime(compiled));
  delayed.domReady();
  assert.equal(
    delayedCalls.some(
      (call) => call.kind === "animate" || call.values?.opacity === 0,
    ),
    false,
    "late initialization must never replay 100% → 0% after the safety timeout",
  );
  assert.equal(delayed.elements.trigger.values.opacity, 1);
  console.log(
    "animation-initial-paint: ok (parser paint, nine scopes, legacy, breakpoints, Design, keyframes, cleanup and fail-open)",
  );
} finally {
  await server.close();
}
