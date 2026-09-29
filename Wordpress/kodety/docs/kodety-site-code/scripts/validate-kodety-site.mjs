#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const input = process.argv[2];
const errors = [];
const warnings = [];
const notes = [];
const addError = (message) => errors.push(message);
const addWarning = (message) => warnings.push(message);
const addNote = (message) => notes.push(message);
const slash = (value) => value.split(path.sep).join("/");

function walk(directory) {
  const ignored = new Set([".git", "node_modules", "dist", ".DS_Store"]);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function attributeValues(source, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`${escaped}\\s*=\\s*(["'])(.*?)\\1`, "gi");
  return [...source.matchAll(matcher)].map((match) => match[2]);
}

function attributeValueFromTag(tag, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? "";
}

function openingTagsWithAttribute(source, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`\\b${escaped}\\s*=\\s*(["']).*?\\1`, "is");
  return [...source.matchAll(/<[a-z][^>]*>/gis)]
    .map((match) => match[0])
    .filter((tag) => matcher.test(tag));
}

function sourceLine(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") line += 1;
  }
  return line;
}

function skipCssWhitespaceAndComments(source, start) {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function cssIdentifierAt(source, start) {
  let cursor = start;
  let value = "";
  while (cursor < source.length) {
    const character = source[cursor];
    if (/[A-Za-z0-9_-]/.test(character) || character.codePointAt(0) >= 0x80) {
      value += character;
      cursor += 1;
      continue;
    }
    if (character !== "\\" || cursor + 1 >= source.length) break;
    const escaped = source[cursor + 1];
    if (escaped === "\n" || escaped === "\r" || escaped === "\f") break;
    const hexadecimal = source.slice(cursor + 1).match(/^[0-9a-f]{1,6}/i)?.[0] ?? "";
    if (hexadecimal) {
      const codePoint = Number.parseInt(hexadecimal, 16);
      value += String.fromCodePoint(
        codePoint === 0 || codePoint > 0x10ffff ? 0xfffd : codePoint,
      );
      cursor += 1 + hexadecimal.length;
      if (/\s/.test(source[cursor] ?? "")) cursor += 1;
      continue;
    }
    value += escaped;
    cursor += 2;
  }
  return { value, end: cursor };
}

function findCssImportant(source) {
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      cursor += 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += source[cursor + 1] === "\r" && source[cursor + 2] === "\n" ? 3 : 2;
          continue;
        }
        const current = source[cursor];
        cursor += 1;
        if (current === quote) break;
      }
      continue;
    }
    if (character === "!") {
      const identifierStart = skipCssWhitespaceAndComments(source, cursor + 1);
      const identifier = cssIdentifierAt(source, identifierStart);
      if (identifier.value.toLowerCase() === "important") return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function findHtmlTagEnd(source, start) {
  let quote = "";
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return cursor;
  }
  return source.length - 1;
}

function decodeHtmlCssEntities(source) {
  return source
    .replace(/&#x([0-9a-f]+);?/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#([0-9]+);?/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&excl;/gi, "!")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function htmlStyleAndScriptSegments(source) {
  const segments = [];
  const lowerSource = source.toLowerCase();
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf("<", cursor);
    if (opening < 0) break;
    if (source.startsWith("<!--", opening)) {
      const close = source.indexOf("-->", opening + 4);
      cursor = close < 0 ? source.length : close + 3;
      continue;
    }
    const tagEnd = findHtmlTagEnd(source, opening);
    const tag = source.slice(opening, tagEnd + 1);
    const name = tag.match(/^<\s*([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase() ?? "";
    if (!name) {
      cursor = tagEnd + 1;
      continue;
    }

    const styleAttribute = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    for (const match of tag.matchAll(styleAttribute)) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      const equals = match[0].indexOf("=");
      let valueOffset = equals + 1;
      while (/\s/.test(match[0][valueOffset] ?? "")) valueOffset += 1;
      if (match[0][valueOffset] === '"' || match[0][valueOffset] === "'") valueOffset += 1;
      segments.push({
        kind: "estilo inline",
        language: "css",
        source: decodeHtmlCssEntities(value),
        index: opening + (match.index ?? 0) + valueOffset,
      });
    }

    if ((name === "style" || name === "script") && !/\/\s*>$/.test(tag)) {
      const closeStart = lowerSource.indexOf(`</${name}`, tagEnd + 1);
      const contentEnd = closeStart < 0 ? source.length : closeStart;
      segments.push({
        kind: name === "style" ? "bloco <style>" : "bloco <script>",
        language: name === "style" ? "css" : "javascript",
        source: source.slice(tagEnd + 1, contentEnd),
        index: tagEnd + 1,
      });
      cursor = closeStart < 0 ? source.length : findHtmlTagEnd(source, closeStart) + 1;
      continue;
    }
    cursor = tagEnd + 1;
  }
  return segments;
}

function javascriptStringToken(source, start) {
  const quote = source[start];
  let cursor = start + 1;
  let value = "";
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === quote) return { type: quote === "`" ? "template" : "string", value, start, end: cursor + 1 };
    if (character !== "\\") {
      value += character;
      cursor += 1;
      continue;
    }
    const escaped = source[cursor + 1] ?? "";
    if (escaped === "\r" || escaped === "\n") {
      cursor += escaped === "\r" && source[cursor + 2] === "\n" ? 3 : 2;
      continue;
    }
    const hexadecimal = escaped === "x"
      ? source.slice(cursor + 2, cursor + 4).match(/^[0-9a-f]{2}/i)?.[0]
      : escaped === "u"
        ? source.slice(cursor + 2, cursor + 6).match(/^[0-9a-f]{4}/i)?.[0]
        : null;
    if (hexadecimal) {
      value += String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      cursor += hexadecimal.length + 2;
      continue;
    }
    const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
    value += escapes[escaped] ?? escaped;
    cursor += 2;
  }
  return { type: quote === "`" ? "template" : "string", value, start, end: cursor };
}

function javascriptTokens(source) {
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "/") {
      const close = source.indexOf("\n", cursor + 2);
      cursor = close < 0 ? source.length : close + 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const token = javascriptStringToken(source, cursor);
      tokens.push(token);
      cursor = token.end;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = cursor;
      cursor += 1;
      while (/[A-Za-z0-9_$]/.test(source[cursor] ?? "")) cursor += 1;
      tokens.push({ type: "identifier", value: source.slice(start, cursor), start, end: cursor });
      continue;
    }
    if (source.startsWith("?.", cursor)) {
      tokens.push({ type: "punctuation", value: "?.", start: cursor, end: cursor + 2 });
      cursor += 2;
      continue;
    }
    tokens.push({ type: "punctuation", value: character, start: cursor, end: cursor + 1 });
    cursor += 1;
  }
  return tokens;
}

function javascriptCallArguments(tokens, openIndex) {
  const argumentsList = [[]];
  const stack = [];
  for (let cursor = openIndex + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.value === ")" && stack.length === 0) {
      return { arguments: argumentsList, end: cursor };
    }
    if (["(", "[", "{"].includes(token.value)) stack.push(token.value);
    else if ([")", "]", "}"].includes(token.value)) stack.pop();
    if (token.value === "," && stack.length === 0) argumentsList.push([]);
    else argumentsList.at(-1).push(token);
  }
  return { arguments: argumentsList, end: tokens.length };
}

function javascriptLiteral(argument) {
  return argument?.length === 1 && ["string", "template"].includes(argument[0].type)
    ? argument[0]
    : null;
}

function javascriptMemberReceiver(tokens, index) {
  return [".", "?."].includes(tokens[index - 1]?.value)
    ? tokens[index - 2]?.value ?? ""
    : "";
}

function javascriptStyleReceiver(value) {
  return /^(?:style|sheet|stylesheet)$/i.test(value)
    || /(?:^|[_$])(?:style(?:el|element|node|tag|sheet)?|sheet|stylesheet)$/i.test(value)
    || /(?:Style(?:El|Element|Node|Tag|Sheet)|Sheet)$/.test(value);
}

function cssFindingFromJavascriptLiteral(token, kind) {
  if (!token) return null;
  const important = findCssImportant(token.value);
  return important < 0 ? null : { index: token.start, kind };
}

function findJavascriptImportant(source) {
  const tokens = javascriptTokens(source);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    const receiver = javascriptMemberReceiver(tokens, index);
    if (receiver && tokens[index + 1]?.value === "(") {
      const call = javascriptCallArguments(tokens, index + 1);
      if (token.value === "setProperty") {
        const priority = javascriptLiteral(call.arguments[2]);
        if (priority?.value.trim().toLowerCase() === "important") {
          return { index: priority.start, kind: "CSSStyleDeclaration.setProperty" };
        }
      }
      if (["insertRule", "addRule", "replaceSync"].includes(token.value)) {
        const finding = cssFindingFromJavascriptLiteral(
          javascriptLiteral(call.arguments[0]),
          `API CSS ${token.value}`,
        );
        if (finding) return finding;
      }
      if (token.value === "replace" && javascriptStyleReceiver(receiver)) {
        const finding = cssFindingFromJavascriptLiteral(
          javascriptLiteral(call.arguments[0]),
          "API CSS replace",
        );
        if (finding) return finding;
      }
      if (token.value === "setAttribute") {
        const attribute = javascriptLiteral(call.arguments[0]);
        if (attribute?.value.trim().toLowerCase() === "style") {
          const finding = cssFindingFromJavascriptLiteral(
            javascriptLiteral(call.arguments[1]),
            "setAttribute('style')",
          );
          if (finding) return finding;
        }
      }
    }

    const assignmentOffset = tokens[index + 1]?.value === "="
      ? 2
      : tokens[index + 1]?.value === "+" && tokens[index + 2]?.value === "="
        ? 3
        : 0;
    const assigned = assignmentOffset ? tokens[index + assignmentOffset] : null;
    if (!receiver || !assigned || !["string", "template"].includes(assigned.type)) continue;
    if (token.value === "cssText") {
      const finding = cssFindingFromJavascriptLiteral(assigned, "style.cssText");
      if (finding) return finding;
    }
    if (token.value === "textContent" && javascriptStyleReceiver(receiver)) {
      const finding = cssFindingFromJavascriptLiteral(assigned, "conteúdo de <style>");
      if (finding) return finding;
    }
    if (token.value === "innerHTML") {
      for (const segment of htmlStyleAndScriptSegments(assigned.value)) {
        if (segment.language !== "css") continue;
        if (findCssImportant(segment.source) >= 0) {
          return { index: assigned.start, kind: "HTML/CSS gerado por JavaScript" };
        }
      }
    }
  }
  return null;
}

function findAuthoredImportant(file, source) {
  if (/\.css$/i.test(file)) {
    const index = findCssImportant(source);
    return index < 0 ? null : { index, kind: "CSS" };
  }
  if (/\.(?:html?|svg)$/i.test(file)) {
    for (const segment of htmlStyleAndScriptSegments(source)) {
      const cssIndex = segment.language === "css" ? findCssImportant(segment.source) : -1;
      const finding = segment.language === "css"
        ? cssIndex >= 0
          ? { index: cssIndex, kind: segment.kind }
          : null
        : findJavascriptImportant(segment.source);
      if (finding) {
        return {
          index: segment.index + Math.max(0, finding.index ?? 0),
          kind: finding.kind ?? segment.kind,
        };
      }
    }
    return null;
  }
  if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(file)) return findJavascriptImportant(source);
  return null;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizedProjectPath(value) {
  return typeof value === "string"
    ? value.replaceAll("\\", "/").replace(/^\/+/, "")
    : "";
}

function absoluteProjectFile(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  return absolute.startsWith(root + path.sep) ? absolute : "";
}

function stringList(value, context) {
  if (!Array.isArray(value)) {
    addError(`${context}: deve ser uma lista`);
    return [];
  }
  const strings = value.filter((item) => typeof item === "string" && item.trim());
  if (strings.length !== value.length) addError(`${context}: aceita somente strings não vazias`);
  return strings;
}

const componentIdPattern = /^[A-Za-z0-9_-]{1,160}$/;
const componentVariableTypes = new Set([
  "text", "rich_text", "number", "image", "link", "audio", "video", "icon", "variant",
]);
const componentDefinitions = new Map();

function decodeComponentOverrides(value, context) {
  if (!value) return {};
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    addError(`${context}: data-kodety-component-overrides não está em base64url sem padding`);
    return {};
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const overrides = record(parsed);
    if (!overrides) {
      addError(`${context}: overrides decodificado deve ser um objeto JSON`);
      return {};
    }
    return overrides;
  } catch (cause) {
    addError(`${context}: overrides inválido (${cause.message})`);
    return {};
  }
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  values.forEach((value) => (seen.has(value) ? repeated.add(value) : seen.add(value)));
  return [...repeated];
}

function selectorExists(selector, source) {
  const interaction = selector.match(
    /^\[data-kodety-interaction-id=(?:"([^"]+)"|'([^']+)')\]$/,
  );
  if (interaction) {
    return attributeValues(source, "data-kodety-interaction-id").includes(
      interaction[1] ?? interaction[2],
    );
  }
  const id = selector.match(/^#([A-Za-z_][\w-]*)$/);
  if (id) return attributeValues(source, "id").includes(id[1]);
  const className = selector.match(/^\.([A-Za-z_][\w-]*)$/);
  if (className) {
    return attributeValues(source, "class").some((value) =>
      value.split(/\s+/).includes(className[1]),
    );
  }
  return null;
}

function validateSelector(selector, source, context, optional = false) {
  if (typeof selector !== "string" || !selector.trim()) {
    if (!optional) addError(`${context}: seletor obrigatório ausente`);
    return;
  }
  const result = selectorExists(selector.trim(), source);
  if (result === false) addError(`${context}: seletor não encontrado: ${selector}`);
  if (result === null) addWarning(`${context}: teste seletor complexo no navegador: ${selector}`);
}

const triggers = new Set([
  "load", "click", "click-start", "appear", "mouse-enter", "mouse-leave",
  "hover", "mouse-move", "scroll", "custom",
]);
const modes = new Set(["element", "class", "selector"]);
const scopes = new Set([
  "trigger", "document", "children", "descendants", "parent", "closest",
  "siblings", "next", "previous",
]);
const kinds = new Set([
  "animate", "set", "class-add", "class-remove", "class-toggle", "variable",
  "component-variant", "event", "lottie", "rive", "spline",
]);
const breakpoints = new Set(["desktop", "tablet", "mobile"]);
const reducedMotion = new Set(["end", "skip", "allow"]);
const textSplits = new Set(["none", "chars", "words", "lines"]);
const staggerOrigins = new Set(["start", "center", "end", "edges", "random"]);

function validateAction(action, index, parent, source, actionIds) {
  const context = `${parent}, action ${index + 1}`;
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    addError(`${context}: deve ser um objeto`);
    return;
  }
  if (!action.id || typeof action.id !== "string") addError(`${context}: id ausente`);
  else actionIds.push(action.id);
  if (!kinds.has(action.kind)) addError(`${context}: kind inválido: ${String(action.kind)}`);
  if (!action.target || typeof action.target !== "object") {
    addError(`${context}: target ausente`);
  } else {
    if (!scopes.has(action.target.scope)) {
      addError(`${context}: target.scope inválido: ${String(action.target.scope)}`);
    }
    if (!modes.has(action.target.mode)) {
      addError(`${context}: target.mode inválido: ${String(action.target.mode)}`);
    }
    validateSelector(
      action.target.selector,
      source,
      `${context}, target`,
      action.target.scope === "trigger",
    );
  }
  for (const field of ["start", "duration", "repeat", "repeatDelay", "stagger"]) {
    if (action[field] !== undefined && typeof action[field] !== "number") {
      addError(`${context}: ${field} deve ser número`);
    }
  }
  if (typeof action.duration === "number" && action.duration < 0) {
    addError(`${context}: duration não pode ser negativa`);
  }
  if (action.staggerFrom !== undefined && !staggerOrigins.has(action.staggerFrom)) {
    addError(`${context}: staggerFrom inválido: ${String(action.staggerFrom)}`);
  }
  if (action.textSplit !== undefined && !textSplits.has(action.textSplit)) {
    addError(`${context}: textSplit inválido: ${String(action.textSplit)}`);
  }
  if (action.keyframes !== undefined && !Array.isArray(action.keyframes)) {
    addError(`${context}: keyframes deve ser array`);
  }
  if (["class-add", "class-remove", "class-toggle"].includes(action.kind) && !action.className) {
    addError(`${context}: className obrigatório para ${action.kind}`);
  }
  if (action.kind === "variable" && !action.variableName) {
    addError(`${context}: variableName obrigatório`);
  }
  if (action.kind === "component-variant") {
    const component = componentDefinitions.get(action.componentId);
    if (!component) {
      addError(`${context}: componentId inexistente: ${String(action.componentId || "")}`);
    } else if (!component.variants.has(action.componentVariantId)) {
      addError(`${context}: componentVariantId inexistente em ${component.id}: ${String(action.componentVariantId || "")}`);
    }
  }
  if (action.kind === "event" && !action.eventName) addError(`${context}: eventName obrigatório`);
  if (["lottie", "rive", "spline"].includes(action.kind) && !action.inputName) {
    addError(`${context}: inputName obrigatório para ${action.kind}`);
  }
}

function validateDocument(jsonPath, source, root) {
  const relative = slash(path.relative(root, jsonPath));
  let document;
  try {
    document = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (cause) {
    addError(`${relative}: JSON inválido (${cause.message})`);
    return;
  }
  if (document.version !== 2) addError(`${relative}: version deve ser 2`);
  if (!Array.isArray(document.interactions)) {
    addError(`${relative}: interactions deve ser array`);
    return;
  }
  const interactionIds = [];
  const actionIds = [];
  document.interactions.forEach((interaction, index) => {
    const context = `${relative}, interaction ${index + 1}`;
    if (!interaction || typeof interaction !== "object" || Array.isArray(interaction)) {
      addError(`${context}: deve ser um objeto`);
      return;
    }
    if (!interaction.id || typeof interaction.id !== "string") addError(`${context}: id ausente`);
    else interactionIds.push(interaction.id);
    if (!triggers.has(interaction.trigger)) {
      addError(`${context}: trigger inválido: ${String(interaction.trigger)}`);
    }
    if (!modes.has(interaction.triggerTargetMode)) {
      addError(`${context}: triggerTargetMode inválido: ${String(interaction.triggerTargetMode)}`);
    }
    validateSelector(interaction.triggerSelector, source, `${context}, trigger`);
    if (!Array.isArray(interaction.actions) || interaction.actions.length === 0) {
      addError(`${context}: actions deve ter ao menos uma action`);
    } else {
      interaction.actions.forEach((action, actionIndex) =>
        validateAction(action, actionIndex, context, source, actionIds),
      );
    }
    if (!reducedMotion.has(interaction.reducedMotion)) {
      addError(`${context}: reducedMotion inválido ou ausente`);
    }
    if (!Array.isArray(interaction.enabledBreakpoints) || !interaction.enabledBreakpoints.length) {
      addError(`${context}: enabledBreakpoints vazio ou ausente`);
    } else {
      interaction.enabledBreakpoints.forEach((breakpoint) => {
        if (!breakpoints.has(breakpoint)) addError(`${context}: breakpoint inválido: ${breakpoint}`);
      });
    }
    if (interaction.trigger === "custom" && !interaction.customEvent) {
      addError(`${context}: customEvent obrigatório para custom`);
    }
    if (interaction.trigger === "scroll") {
      ["scrollStart", "scrollEnd", "scrollToggleActions"].forEach((field) => {
        if (typeof interaction[field] !== "string" || !interaction[field]) {
          addError(`${context}: ${field} obrigatório para scroll`);
        }
      });
      if (typeof interaction.scrollScrub !== "boolean") {
        addError(`${context}: scrollScrub deve ser boolean`);
      }
    }
  });
  duplicates(interactionIds).forEach((id) => addError(`${relative}: interaction id duplicado: ${id}`));
  duplicates(actionIds).forEach((id) => addError(`${relative}: action id duplicado: ${id}`));
  addNote(`${relative}: ${document.interactions.length} interaction(s) analisada(s)`);
}

function isExternal(value) {
  return !value || value.startsWith("#") || value.startsWith("/") || value.startsWith("//") ||
    /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(value) || value.includes("{{");
}

function validateReferences(source, htmlFile, root) {
  const matcher = /\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of source.matchAll(matcher)) {
    const original = match[2].trim();
    if (isExternal(original)) continue;
    const clean = decodeURIComponent(original.split("#", 1)[0].split("?", 1)[0]);
    const resolved = path.resolve(path.dirname(htmlFile), clean);
    const relativeHtml = slash(path.relative(root, htmlFile));
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      addError(`${relativeHtml}: referência sai da raiz: ${original}`);
    } else if (!fs.existsSync(resolved)) {
      addError(`${relativeHtml}: arquivo local ausente: ${original}`);
    }
  }
}

function authoredHtmlSource(source) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

if (!input) {
  console.error("Uso: node validate-kodety-site.mjs /caminho/absoluto/do/site");
  process.exit(2);
}
const root = path.resolve(input);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Diretório inexistente: ${root}`);
  process.exit(2);
}

const files = walk(root);
const htmlFiles = files.filter((file) => file.toLowerCase().endsWith(".html"));
if (!htmlFiles.length) addError("Nenhum arquivo HTML encontrado");
const metadataPath = path.join(root, ".incode", "project.json");
let metadata = null;
if (fs.existsSync(metadataPath)) {
  try {
    metadata = record(JSON.parse(fs.readFileSync(metadataPath, "utf8")));
    if (!metadata) addError(".incode/project.json deve conter um objeto JSON");
  } catch (cause) {
    addError(`.incode/project.json inválido (${cause.message})`);
  }
}
if (!fs.existsSync(path.join(root, "index.html"))) {
  if (!metadata) {
    addError("index.html ausente e .incode/project.json não declara entrada alternativa");
  } else {
    const main = metadata.mainHtmlPath ?? metadata.main ?? metadata.entry ?? metadata.entrypoint;
    if (!main || !fs.existsSync(path.resolve(root, String(main)))) {
      addError(".incode/project.json não contém mainHtmlPath, main, entry ou entrypoint válido");
    }
  }
}

const referencedComponentFiles = new Set();
const rawComponentLibrary = record(metadata?.components);
if (metadata?.components !== undefined && !rawComponentLibrary) {
  addError(".incode/project.json: components deve ser um objeto");
}
if (rawComponentLibrary) {
  if (rawComponentLibrary.version !== 1) addError(".incode/project.json: components.version deve ser 1");
  if (!Array.isArray(rawComponentLibrary.components)) {
    addError(".incode/project.json: components.components deve ser uma lista");
  } else {
    rawComponentLibrary.components.forEach((rawComponent, componentIndex) => {
      const component = record(rawComponent);
      const context = `.incode/project.json, component ${componentIndex + 1}`;
      if (!component) {
        addError(`${context}: deve ser um objeto`);
        return;
      }
      const componentId = typeof component.id === "string" ? component.id : "";
      if (!componentIdPattern.test(componentId)) {
        addError(`${context}: id inválido`);
        return;
      }
      if (componentDefinitions.has(componentId)) {
        addError(`${context}: component id duplicado: ${componentId}`);
        return;
      }
      if (typeof component.name !== "string" || !component.name.trim()) {
        addError(`${context}: name obrigatório`);
      }
      for (const field of ["createdAt", "updatedAt"]) {
        if (typeof component[field] !== "string" || Number.isNaN(Date.parse(component[field]))) {
          addError(`${context}: ${field} deve ser uma data ISO válida`);
        }
      }
      const componentDirectory = `.incode/components/${componentId}/`;
      const rawBundle = record(component.bundle);
      let bundle = null;
      let bundleManifest = null;
      let bundleStyle = "";
      if (!rawBundle) {
        addWarning(`${context}: componente legado sem bundle HTML/CSS/manifest; o Builder fará a migração ao editar ou inserir`);
      } else {
        const manifestFilePath = normalizedProjectPath(rawBundle.manifestFilePath);
        const styleFilePath = normalizedProjectPath(rawBundle.styleFilePath);
        if (rawBundle.version !== 1) addError(`${context}: bundle.version deve ser 1`);
        if (!manifestFilePath.startsWith(componentDirectory) || !/\.json$/i.test(manifestFilePath)) {
          addError(`${context}: bundle.manifestFilePath deve ser um JSON dentro de ${componentDirectory}`);
        }
        if (!styleFilePath.startsWith(componentDirectory) || !/\.css$/i.test(styleFilePath)) {
          addError(`${context}: bundle.styleFilePath deve ser um CSS dentro de ${componentDirectory}`);
        }
        const manifestAbsolute = absoluteProjectFile(root, manifestFilePath);
        const styleAbsolute = absoluteProjectFile(root, styleFilePath);
        if (!manifestAbsolute || !fs.existsSync(manifestAbsolute)) {
          addError(`${context}: manifest do bundle ausente: ${manifestFilePath || "(vazio)"}`);
        } else {
          referencedComponentFiles.add(path.resolve(manifestAbsolute));
          try {
            bundleManifest = record(JSON.parse(fs.readFileSync(manifestAbsolute, "utf8")));
            if (!bundleManifest) addError(`${manifestFilePath}: deve conter um objeto JSON`);
          } catch (cause) {
            addError(`${manifestFilePath}: JSON inválido (${cause.message})`);
          }
        }
        if (!styleAbsolute || !fs.existsSync(styleAbsolute)) {
          addError(`${context}: CSS do bundle ausente: ${styleFilePath || "(vazio)"}`);
        } else {
          referencedComponentFiles.add(path.resolve(styleAbsolute));
          bundleStyle = fs.readFileSync(styleAbsolute, "utf8");
          const escapedId = componentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (!new RegExp(`\\[data-kodety-component-scope\\s*=\\s*[\"']${escapedId}[\"']\\]`).test(bundleStyle)) {
            addWarning(`${styleFilePath}: nenhuma regra escopada para data-kodety-component-scope=\"${componentId}\"`);
          }
        }
        bundle = { version: 1, manifestFilePath, styleFilePath };
      }
      const rawVariants = Array.isArray(component.variants) ? component.variants : [];
      if (!rawVariants.length) addError(`${context}: precisa manter ao menos uma variante`);
      const variants = new Map();
      const variantNodes = new Map();
      rawVariants.forEach((rawVariant, variantIndex) => {
        const variant = record(rawVariant);
        const variantContext = `${context}, variant ${variantIndex + 1}`;
        if (!variant) {
          addError(`${variantContext}: deve ser um objeto`);
          return;
        }
        const variantId = typeof variant.id === "string" ? variant.id : "";
        const filePath = typeof variant.filePath === "string"
          ? variant.filePath.replaceAll("\\", "/").replace(/^\/+/, "")
          : "";
        if (!componentIdPattern.test(variantId)) {
          addError(`${variantContext}: id inválido`);
          return;
        }
        if (variants.has(variantId)) {
          addError(`${variantContext}: variant id duplicado: ${variantId}`);
          return;
        }
        if (typeof variant.name !== "string" || !variant.name.trim()) {
          addError(`${variantContext}: name obrigatório`);
        }
        if (
          !filePath.startsWith(`.incode/components/${componentId}/`)
          || !/\.html?$/i.test(filePath)
        ) {
          addError(`${variantContext}: filePath deve ser um HTML dentro de .incode/components/${componentId}/`);
          return;
        }
        const absolute = path.resolve(root, filePath);
        if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) {
          addError(`${variantContext}: master ausente: ${filePath}`);
          return;
        }
        referencedComponentFiles.add(path.resolve(absolute));
        const source = fs.readFileSync(absolute, "utf8");
        const nodeIds = attributeValues(source, "data-kodety-component-node");
        if (!nodeIds.length) addError(`${filePath}: nenhum data-kodety-component-node`);
        duplicates(nodeIds).forEach((id) => addError(`${filePath}: component node id duplicado: ${id}`));
        nodeIds.filter((id) => !componentIdPattern.test(id)).forEach((id) => (
          addError(`${filePath}: component node id inválido: ${id}`)
        ));
        const bodyTag = source.match(/<body\b[^>]*>/i)?.[0] || "";
        if (attributeValueFromTag(bodyTag, "data-kodety-component-editor") !== componentId) {
          addError(`${filePath}: body não declara data-kodety-component-editor="${componentId}"`);
        }
        if (attributeValueFromTag(bodyTag, "data-kodety-component-variant-editor") !== variantId) {
          addError(`${filePath}: body não declara data-kodety-component-variant-editor="${variantId}"`);
        }
        if (bundle) {
          if (/<base\b/i.test(source)) {
            addWarning(`${filePath}: master com bundle não precisa de <base>; use caminhos relativos ao próprio master`);
          }
          const bodyMarkup = source.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] || "";
          const rootTag = bodyMarkup.match(/<[a-z][^>]*>/i)?.[0] || "";
          if (attributeValueFromTag(rootTag, "data-kodety-component-scope") !== componentId) {
            addError(`${filePath}: raiz deve declarar data-kodety-component-scope="${componentId}"`);
          }
          const styleHref = attributeValueFromTag(
            source.match(/<link\b[^>]*\bdata-kodety-component-style\b[^>]*>/i)?.[0] || "",
            "href",
          );
          if (!styleHref) {
            addError(`${filePath}: head deve referenciar component.css com data-kodety-component-style`);
          } else {
            const resolvedStyle = slash(path.relative(root, path.resolve(path.dirname(absolute), styleHref)));
            if (resolvedStyle !== bundle.styleFilePath) {
              addError(`${filePath}: stylesheet do bundle aponta para ${resolvedStyle}, esperado ${bundle.styleFilePath}`);
            }
          }
        }
        variants.set(variantId, { id: variantId, filePath, primary: variantIndex === 0 });
        variantNodes.set(variantId, new Set(nodeIds));
      });

      const variables = new Map();
      const rawVariables = Array.isArray(component.variables) ? component.variables : [];
      rawVariables.forEach((rawVariable, variableIndex) => {
        const variable = record(rawVariable);
        const variableContext = `${context}, variable ${variableIndex + 1}`;
        if (!variable) {
          addError(`${variableContext}: deve ser um objeto`);
          return;
        }
        const variableId = typeof variable.id === "string" ? variable.id : "";
        const type = typeof variable.type === "string" ? variable.type : "";
        if (!componentIdPattern.test(variableId)) {
          addError(`${variableContext}: id inválido`);
          return;
        }
        if (variables.has(variableId)) {
          addError(`${variableContext}: variable id duplicado: ${variableId}`);
          return;
        }
        if (!componentVariableTypes.has(type)) addError(`${variableContext}: type inválido: ${type}`);
        const rawBindings = Array.isArray(variable.bindings)
          ? variable.bindings
          : variable.targetNodeId
            ? [{ targetNodeId: variable.targetNodeId, attribute: variable.attribute || "" }]
            : [];
        if (!Array.isArray(variable.bindings) && rawBindings.length) {
          addWarning(`${variableContext}: usa binding singular legado; adicione bindings`);
        }
        const bindings = rawBindings.flatMap((rawBinding, bindingIndex) => {
          const binding = record(rawBinding);
          const targetNodeId = typeof binding?.targetNodeId === "string" ? binding.targetNodeId : "";
          if (!componentIdPattern.test(targetNodeId)) {
            addError(`${variableContext}, binding ${bindingIndex + 1}: targetNodeId inválido`);
            return [];
          }
          return [{ targetNodeId, attribute: typeof binding.attribute === "string" ? binding.attribute : "" }];
        });
        if (type === "variant") {
          if (bindings.length) addError(`${variableContext}: variável variant não aceita bindings`);
          if (variable.defaultValue && !variants.has(variable.defaultValue)) {
            addError(`${variableContext}: defaultValue aponta para variante inexistente`);
          }
        }
        bindings.forEach((binding) => {
          [...variantNodes.entries()].forEach(([variantId, nodes], variantIndex) => {
            if (nodes.has(binding.targetNodeId)) return;
            const message = `${variableContext}: target ${binding.targetNodeId} ausente na variante ${variantId}`;
            if (variantIndex === 0) addError(message);
            else addWarning(message);
          });
        });
        variables.set(variableId, { id: variableId, type });
      });
      if (bundleManifest) {
        if (bundleManifest.version !== 1) addError(`${bundle.manifestFilePath}: version deve ser 1`);
        if (bundleManifest.componentId !== componentId) {
          addError(`${bundle.manifestFilePath}: componentId deve ser ${componentId}`);
        }
        if (normalizedProjectPath(bundleManifest.styleFilePath) !== bundle.styleFilePath) {
          addError(`${bundle.manifestFilePath}: styleFilePath diverge de .incode/project.json`);
        }
        const manifestVariants = Array.isArray(bundleManifest.variants) ? bundleManifest.variants : null;
        if (!manifestVariants) {
          addError(`${bundle.manifestFilePath}: variants deve ser uma lista`);
        } else {
          const expected = [...variants.values()].map((variant) => `${variant.id}:${variant.filePath}`);
          const actual = manifestVariants.map((item) => {
            const manifestVariant = record(item);
            return `${manifestVariant?.id || ""}:${normalizedProjectPath(manifestVariant?.filePath)}`;
          });
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            addError(`${bundle.manifestFilePath}: variants deve espelhar a ordem e os caminhos de .incode/project.json`);
          }
        }
        const dependencies = record(bundleManifest.dependencies);
        if (!dependencies) {
          addError(`${bundle.manifestFilePath}: dependencies deve ser um objeto`);
        } else {
          const stylesheets = stringList(dependencies.stylesheets, `${bundle.manifestFilePath}: dependencies.stylesheets`);
          const projectFiles = stringList(dependencies.projectFiles, `${bundle.manifestFilePath}: dependencies.projectFiles`);
          stringList(dependencies.externalStylesheets, `${bundle.manifestFilePath}: dependencies.externalStylesheets`);
          stringList(dependencies.externalUrls, `${bundle.manifestFilePath}: dependencies.externalUrls`);
          [...stylesheets, ...projectFiles].forEach((dependency) => {
            const dependencyPath = normalizedProjectPath(dependency);
            const absolute = absoluteProjectFile(root, dependencyPath);
            if (!absolute || !fs.existsSync(absolute)) {
              addError(`${bundle.manifestFilePath}: dependência local ausente: ${dependency}`);
            }
            if (dependencyPath.startsWith(`${componentDirectory}assets/`)) {
              addError(`${bundle.manifestFilePath}: não copie assets para o bundle; mantenha ${dependency} no caminho compartilhado do projeto`);
            }
          });
        }
      }
      componentDefinitions.set(componentId, { id: componentId, variants, variables, variantNodes, bundle });
      addNote(`${context}: ${variants.size} variante(s), ${variables.size} variável(is)`);
    });
  }
}

files
  .filter((file) => slash(path.relative(root, file)).startsWith(".incode/components/") && /\.(?:html?|css|json)$/i.test(file))
  .forEach((file) => {
    if (!referencedComponentFiles.has(path.resolve(file))) {
      addWarning(`${slash(path.relative(root, file))}: master não referenciado pela biblioteca`);
    }
  });

const animationDirectory = path.join(root, ".incode", "animations");
const expectedDocuments = new Set();
const animationDocumentName = (relativeHtml) => `${encodeURIComponent(relativeHtml).replace(
  /[!'()*]/g,
  (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
)}.json`;
const legacyAnimationDocumentName = (relativeHtml) => `${relativeHtml
  .replace(/[^a-zA-Z0-9._/-]+/g, "-")
  .replaceAll("/", "__")
  .replace(/^[-.]+|[-.]+$/g, "") || "index.html"}.json`;
for (const htmlFile of htmlFiles) {
  const relativeHtml = slash(path.relative(root, htmlFile));
  const source = fs.readFileSync(htmlFile, "utf8");
  const authoredSource = authoredHtmlSource(source);
  validateReferences(authoredSource, htmlFile, root);
  duplicates(attributeValues(authoredSource, "id")).forEach((id) =>
    addError(`${relativeHtml}: id HTML duplicado: ${id}`),
  );
  duplicates(attributeValues(authoredSource, "data-kodety-interaction-id")).forEach((id) =>
    addError(`${relativeHtml}: data-kodety-interaction-id duplicado: ${id}`),
  );
  const componentTags = openingTagsWithAttribute(authoredSource, "data-kodety-component-id");
  const instanceIds = [];
  componentTags.forEach((tag, instanceIndex) => {
    const context = `${relativeHtml}, component instance ${instanceIndex + 1}`;
    const componentId = attributeValueFromTag(tag, "data-kodety-component-id");
    const variantId = attributeValueFromTag(tag, "data-kodety-component-variant");
    const stateVariantId = attributeValueFromTag(tag, "data-kodety-component-state-variant");
    const instanceId = attributeValueFromTag(tag, "data-kodety-component-instance");
    const nodeId = attributeValueFromTag(tag, "data-kodety-component-node");
    const component = componentDefinitions.get(componentId);
    if (!componentIdPattern.test(componentId) || !component) {
      addError(`${context}: componentId inexistente ou inválido: ${componentId || "(vazio)"}`);
      return;
    }
    if (!component.variants.has(variantId)) {
      addError(`${context}: variante-base inexistente em ${componentId}: ${variantId || "(vazia)"}`);
    }
    if (!component.variants.has(stateVariantId)) {
      addError(`${context}: variante de estado inexistente em ${componentId}: ${stateVariantId || "(vazia)"}`);
    }
    if (
      component.bundle
      && attributeValueFromTag(tag, "data-kodety-component-scope") !== componentId
    ) {
      addError(`${context}: raiz deve preservar data-kodety-component-scope="${componentId}"`);
    }
    if (!componentIdPattern.test(instanceId)) {
      addError(`${context}: data-kodety-component-instance ausente ou inválido`);
    } else {
      instanceIds.push(instanceId);
    }
    if (!componentIdPattern.test(nodeId)) {
      addError(`${context}: a raiz precisa de data-kodety-component-node válido`);
    } else {
      const stateNodes = component.variantNodes.get(stateVariantId);
      if (stateNodes && !stateNodes.has(nodeId)) {
        addError(`${context}: node raiz ${nodeId} não existe no master da variante ${stateVariantId}`);
      }
    }
    const encodedOverrides = attributeValueFromTag(tag, "data-kodety-component-overrides");
    const overrides = decodeComponentOverrides(encodedOverrides, context);
    Object.entries(overrides).forEach(([variableId, rawValue]) => {
      const variable = component.variables.get(variableId);
      if (!variable) {
        addError(`${context}: override aponta para variável inexistente: ${variableId}`);
        return;
      }
      if (typeof rawValue !== "string") {
        addError(`${context}: override ${variableId} deve ser texto`);
      } else if (variable.type === "variant" && !component.variants.has(rawValue)) {
        addError(`${context}: override ${variableId} aponta para variante inexistente: ${rawValue}`);
      }
    });
  });
  duplicates(instanceIds).forEach((id) => (
    addError(`${relativeHtml}: data-kodety-component-instance duplicado: ${id}`)
  ));
  if (!/\bdata-label\s*=/i.test(authoredSource)) {
    addWarning(`${relativeHtml}: nenhum data-label; Layers pode ficar pouco legível`);
  }
  const documentName = animationDocumentName(relativeHtml);
  const legacyDocumentName = legacyAnimationDocumentName(relativeHtml);
  const jsonPath = path.join(animationDirectory, documentName);
  const legacyJsonPath = path.join(animationDirectory, legacyDocumentName);
  expectedDocuments.add(path.resolve(jsonPath));
  expectedDocuments.add(path.resolve(legacyJsonPath));
  if (fs.existsSync(jsonPath)) {
    validateDocument(jsonPath, authoredSource, root);
    if (legacyJsonPath !== jsonPath && fs.existsSync(legacyJsonPath)) {
      addWarning(`${relativeHtml}: possui também o documento legado .incode/animations/${legacyDocumentName}`);
    }
  } else if (fs.existsSync(legacyJsonPath)) {
    validateDocument(legacyJsonPath, authoredSource, root);
    addWarning(`${relativeHtml}: usa nome legado; prefira .incode/animations/${documentName}`);
  }
  else if (/\bdata-kodety-interaction-id\s*=/i.test(authoredSource)) {
    addWarning(`${relativeHtml}: possui marcadores, mas falta .incode/animations/${documentName}`);
  }
}

if (fs.existsSync(animationDirectory)) {
  walk(animationDirectory).filter((file) => file.endsWith(".json")).forEach((file) => {
    if (!expectedDocuments.has(path.resolve(file))) {
      addWarning(`${slash(path.relative(root, file))}: não corresponde a uma página HTML`);
    }
  });
}

files.filter((file) => /\.(?:css|js|mjs)$/i.test(file)).forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  const relative = slash(path.relative(root, file));
  if (/data-kodety-interactions-runtime/i.test(source)) {
    addError(`${relative}: runtime nativo não deve ser editado manualmente`);
  }
  if (/\.css$/i.test(file) && /@keyframes\b|\banimation\s*:/i.test(source)) {
    addWarning(`${relative}: animação CSS não aparecerá automaticamente em Interactions`);
  }
  if (/\.(?:js|mjs)$/i.test(file) && /\b(?:gsap\.|ScrollTrigger|\.animate\s*\()/i.test(source)) {
    addWarning(`${relative}: animação JavaScript não aparecerá automaticamente em Interactions`);
  }
});

files.filter((file) => /\.(?:html?|svg|css|js|mjs|cjs|jsx|ts|tsx)$/i.test(file)).forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  const relative = slash(path.relative(root, file));
  const finding = findAuthoredImportant(file, source);
  if (finding) {
    addError(
      `${relative}:${sourceLine(source, finding.index)}: !important é proibido em ${finding.kind}; reorganize a cascata sem prioridade CSS`,
    );
  }
});

errors.forEach((message) => console.error(`ERROR ${message}`));
warnings.forEach((message) => console.warn(`WARN  ${message}`));
notes.forEach((message) => console.log(`OK    ${message}`));
console.log(`\nKodety preflight: ${errors.length} erro(s), ${warnings.length} aviso(s), ${htmlFiles.length} HTML(s), ${componentDefinitions.size} componente(s).`);
process.exit(errors.length ? 1 : 0);
