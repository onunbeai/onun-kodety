import type { HtmlProject } from "./types";

export interface CmsFormField {
  name: string;
  label: string;
  type: string;
}

export interface CmsPageForm {
  id: string;
  label: string;
  fields: CmsFormField[];
}

export interface CmsFormPage {
  path: string;
  label: string;
  forms: CmsPageForm[];
}

const formFileCache = new WeakMap<object, CmsPageForm[]>();

function fieldsFromRoot(
  root: Document | HTMLFormElement,
  document: Document,
): CmsFormField[] {
  const seen = new Set<string>();
  return Array.from(
    root.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input[name], textarea[name], select[name]"),
  ).flatMap((control) => {
    const name = control.getAttribute("name")?.trim() || "";
    const type =
      control.tagName.toLocaleLowerCase() === "input"
        ? (control.getAttribute("type") || "text").toLocaleLowerCase()
        : control.tagName.toLocaleLowerCase();
    if (
      !name ||
      seen.has(name) ||
      ["submit", "button", "reset", "password", "hidden", "file"].includes(type)
    ) {
      return [];
    }
    seen.add(name);
    const matchingLabel = control.id
      ? Array.from(
          document.querySelectorAll<HTMLLabelElement>("label[for]"),
        ).find((label) => label.htmlFor === control.id)
      : null;
    const explicitLabel =
      control.getAttribute("data-label")?.trim() ||
      control.getAttribute("aria-label")?.trim() ||
      matchingLabel?.textContent?.trim() ||
      control.closest("label")?.textContent?.trim() ||
      control.getAttribute("placeholder")?.trim() ||
      name;
    return [
      {
        name,
        label: explicitLabel.replace(/\s+/g, " ").slice(0, 80),
        type,
      },
    ];
  });
}

export function formFieldsFromMarkup(markup: string): CmsFormField[] {
  if (!markup || typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(markup, "text/html");
  return fieldsFromRoot(document, document);
}

export function formsFromMarkup(markup: string): CmsPageForm[] {
  if (!markup || typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(markup, "text/html");
  const usedIds = new Set<string>();
  return Array.from(document.querySelectorAll<HTMLFormElement>("form")).flatMap(
    (form, index) => {
      const fields = fieldsFromRoot(form, document);
      if (!fields.length) return [];
      const rawId =
        form.getAttribute("data-kodety-form-id")?.trim() ||
        form.getAttribute("id")?.trim() ||
        form.getAttribute("name")?.trim() ||
        `form-${index + 1}`;
      let id = rawId.replace(/[^A-Za-z0-9._:-]/g, "-") || `form-${index + 1}`;
      let suffix = 2;
      const idBase = id;
      while (usedIds.has(id)) id = `${idBase}-${suffix++}`;
      usedIds.add(id);
      const heading = form.querySelector<HTMLElement>(
        "legend, [data-form-title], h1, h2, h3, h4",
      );
      const explicitLabel =
        form.getAttribute("data-kodety-form-name")?.trim() ||
        form.getAttribute("data-name")?.trim() ||
        form.getAttribute("aria-label")?.trim() ||
        form.getAttribute("name")?.trim() ||
        heading?.textContent?.trim() ||
        form.getAttribute("id")?.trim() ||
        `Formulário ${index + 1}`;
      return [
        {
          id,
          label: explicitLabel.replace(/\s+/g, " ").slice(0, 80),
          fields,
        },
      ];
    },
  );
}

function formPageLabel(path: string) {
  const parts = path.split("/").filter(Boolean);
  const filename = parts.pop()?.replace(/\.html?$/i, "") || path;
  const source =
    filename.toLocaleLowerCase() === "index"
      ? parts.pop() || "Página inicial"
      : filename;
  return source
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1))
    .join(" ");
}

export function formPagesFromProject(project: HtmlProject): CmsFormPage[] {
  return Object.values(project.files)
    .filter(
      (file) =>
        /\.html?$/i.test(file.path) &&
        !/(?:^|\/)(?:\.incode|\.kodety-experiments|kodety-build)(?:\/|$)/i.test(
          file.path,
        ),
    )
    .map((file) => {
      let forms = formFileCache.get(file);
      if (!forms) {
        forms = formsFromMarkup(file.text || "");
        formFileCache.set(file, forms);
      }
      return {
        path: file.path,
        label: formPageLabel(file.path),
        forms,
      };
    })
    .sort(
      (left, right) =>
        Number(right.path === project.mainHtmlPath) -
          Number(left.path === project.mainHtmlPath) ||
        Number(Boolean(right.forms.length)) -
          Number(Boolean(left.forms.length)) ||
        left.label.localeCompare(right.label, "pt-BR"),
    );
}
