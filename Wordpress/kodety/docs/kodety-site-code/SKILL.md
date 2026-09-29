---
name: kodety-site-code
description: Create, convert, audit, repair, or live-sync websites for Onun Kodety, including editable HTML/CSS, stable Layers selectors, responsive breakpoints, reusable native components, variants, variables, component events and instances, CMS and analytics markers, Interactions v2, and Remote MCP delivery into the Builder. Use when Codex is asked to build a Onun Kodety site, create or edit a component or variant, turn a design into compatible code, connect an AI to Onun Kodety, push sections with MCP, make an HTML/ZIP project editable, or diagnose components, assets, responsiveness, animations, revisions, publication, or Builder synchronization. Do not use for unrelated Onun Kodety platform-source work.
---

# Onun Kodety Site Code

Produce or review browser-native site code that remains editable after import
and exposes authored motion to Onun Kodety's Interactions panel.

## Required workflow

1. Identify whether the input is a new design, an existing site directory, an
   HTML file, or a ZIP.
2. Read [references/kodety-code-contract.md](references/kodety-code-contract.md)
   completely before creating or materially restructuring a site. For a narrow
   repair, read the relevant numbered sections and the final checklist.
3. Read [references/component-system.md](references/component-system.md)
   completely before creating, importing, converting, or editing reusable
   components, variants, variables, component events, or instances.
4. Inventory pages, assets, responsive states, reusable components, dynamic
   content, tracking targets, and animations before writing code.
5. Implement real, semantic HTML with external, editable CSS and progressive
   JavaScript. Never hide the site behind a framework-only root or a required
   hydration step.
6. Never author `!important`, including responsive overrides, component CSS,
   inline styles, generated CSS strings, repairs, or specificity workarounds.
   If existing source contains it, remove/refactor it instead of copying it or
   adding a second prioritized declaration.
7. Give meaningful layers `data-label`. Give every animation trigger or target
   a unique, stable `data-kodety-interaction-id`.
8. Encode panel-editable motion in the per-page version-2 document under
   `.incode/animations/`. Do not duplicate that motion in authored CSS or JS.
9. Use the native reusable-component bundle for repeated authored UI. Give
   each component its own `component.json`, scoped `component.css`, and
   variant masters; keep the primary variant first, preserve component node
   identities, responsive rules, and Interactions v2 events.
10. Use native Onun Kodety markup contracts for tabs and sliders when those
   components are present.
11. Keep assets local with exact, relative paths. Components reference the
    existing shared project asset; never copy it into a component-local
    `assets/` directory. Keep authored HTML visible without JavaScript.
12. When a Onun Kodety Remote MCP connection is available, send each completed
   semantic section to the Builder using the live-sync workflow below. Read
   [references/mcp-operations.md](references/mcp-operations.md) completely
   before the first connected operation in a task.
13. When running inside the Onun Kodety Agent, call `kodety_editor_context` first.
    If it returns `editor.nativePanel.required: true`, read
    [references/native-panels.md](references/native-panels.md) completely and
    operate only with `kodety_panel_snapshot` and `kodety_panel_action`. This
    applies to every feature exposed by Settings, CMS, Analytics, Localization,
    Members, Templates, their sub-routes, menus, and dialogs. Never replace a
    visual-panel operation with an edit to the page or project source.
14. When native component tools are available on the Canvas, read with
    `kodety_component_snapshot` and mutate only with
    `kodety_apply_component_changes`; never hand-edit component metadata there.
15. Run the bundled validator, fix every error, and assess every warning before
   handing off the directory or ZIP.
16. Report the main HTML entry, component definitions and variants created,
    animation documents created, validation result, and any intentional custom
    runtime behavior that is not panel-editable.

## Build and review rules

- Prefer `index.html` at the archive root and optionally declare it in
  `.incode/project.json`.
- Keep the ZIP root flat: `index.html`, `css/`, `js/`, `assets/`, and
  `.incode/` must not sit inside an extra wrapper directory.
- Prefer stable classes for styling and unique
  `[data-kodety-interaction-id="..."]` selectors for interactions.
- Use simple single-condition width media queries for editable breakpoints.
- `!important` is forbidden in every authored deliverable. Resolve cascade
  conflicts with source order, stable classes, lower specificity, variables,
  or a small structural refactor; never with CSS priority.
- Treat CSS/JS animations as custom runtime behavior. Only the v2 animation
  JSON is guaranteed to appear in Interactions.
- Treat `.incode/project.json` plus each component's `component.json`,
  `component.css`, and variant masters under `.incode/components/` as one
  contract. Never deliver only part of that bundle.
- Scope component CSS under `data-kodety-component-scope`, preserve its media
  queries, and keep that scope marker on masters, instances, and detached HTML.
- Keep media and fonts in their normal shared project paths. The component
  manifest records `projectFiles`; it does not own or duplicate those files.
- Materialize component instances as real HTML and keep component, variant,
  state, instance, node, variable, and interaction identities stable.
- Let Onun Kodety inject its MIT-licensed Motion runtime for native interactions.
- Keep static CSS at the final visible state; let the interaction runtime apply
  `from` values.
- Preserve accessibility, keyboard behavior, focus, reduced motion, and
  content fallbacks.
- Never generate or edit `data-kodety-interactions-runtime` scripts manually.

## Interaction routing

- Use `load` for page-entry motion.
- Use `hover` for reversible pointer states.
- Use `click` for toggle, play, restart, or reverse behaviors.
- Use `scroll` for reveal or scrubbed timelines; set `scrollStart`,
  `scrollEnd`, `scrollScrub`, and `scrollToggleActions` explicitly.
- Use `mouse-move` only when pointer-driven progress is part of the design.
- Use `custom` for a named `CustomEvent` dispatched on `document`.
- Use `click-start`, `appear`, `mouse-enter`, and `mouse-leave` for native
  component events when those exact event semantics are requested.
- Default `reducedMotion` to `end`.
- Use only `desktop`, `tablet`, and `mobile` in `enabledBreakpoints`.

Consult the reference for the complete action schema, target scopes, property
names, timing rules, filename mapping, and validated examples.

For component state changes, use action kind `component-variant` with a valid
`componentId` and `componentVariantId`. Do not reproduce the same transition in
authored JavaScript.

## Live Builder sync through Remote MCP

Read [references/mcp-operations.md](references/mcp-operations.md) completely,
then read section 18 of
[references/kodety-code-contract.md](references/kodety-code-contract.md)
completely whenever the user asks an AI to code while automatically updating
the current Onun Kodety Builder.

Follow this sequence:

1. Treat the MCP URL and bearer token as secrets. Use the canonical
   `/wp-json/kodety/v1/mcp` endpoint and never write credentials into project
   files, logs, examples, commits, or final responses. A connection copied
   from the Builder topbar is independent, shown once and bound to that
   project's persisted `workspaceProjectId`; creating another does not revoke
   the earlier connection. Connections created by an older runtime without a
   persisted project identity fail closed and must be replaced by an
   administrator instead of following whichever workspace is open.
2. Call `kodety_get_site` before the first mutation. Confirm `target`,
   `connectionScope`, capabilities and `workspaceRevision`, then preserve the
   revision as `baseRevision`. Verify `target.workspaceProjectId` and
   `target.name` against the current project.
3. Inspect the current workspace with `kodety_list_files` and targeted
   `kodety_read_file` calls before changing it. Never infer current content
   from a previous task or a local copy alone.
4. Finish one complete semantic section locally, including its HTML, CSS,
   responsive rules, assets, and Interactions document when applicable.
5. Give the section a stable `data-kodety-section-id`. Reuse that identifier on
   later updates instead of creating duplicates.
6. Call `kodety_upsert_section` with the complete section and the latest
   `baseRevision`.
7. Verify the returned revision and changed paths, then read back the authored
   page and every critical generated artifact. A success notification by
   itself is not proof that the section was inserted.
8. Continue section by section. Do not send each individual element unless a
   repair specifically requires it.
9. On a revision conflict such as HTTP 409, re-read the current workspace,
   reconcile newer work, and retry with the new revision. Never overwrite
   unseen changes blindly.
10. Keep automatic synchronization in draft state. Publish only when the user
    explicitly requests publication.

Prefer semantic/domain tools over generic file mutation:
`kodety_upsert_section` for complete page sections, CMS/content tools for
collections and entries, and media tools for assets. Use
`kodety_replace_in_file` only for a narrow exact repair and
`kodety_write_file` only after reading the entire target and intentionally
replacing it.

For compiled projects, never edit generated files under `kodety-build/` as the
source of truth. The upsert must update both the visible Builder page and the
corresponding authorial source recorded in `.incode/coded-build.json`, so a
rebuild preserves the section.

## Validation

Run against a project directory:

```bash
node "$KODETY_SKILL_DIR/scripts/validate-kodety-site.mjs" /absolute/path/to/site
```

Set `KODETY_SKILL_DIR` to the directory containing this `SKILL.md`. If the
input is a ZIP, extract it to a temporary directory first and validate the
extracted root.

Treat validator output as follows:

- `ERROR`: block delivery and fix.
- `WARN`: inspect and either fix or disclose the intentional exception.
- success: continue with proportionate visual/browser testing when available.

The validator is a structural preflight, not a substitute for rendering the
site at its declared breakpoints and exercising its interactions.

## Deliverables

Return:

- the complete site directory or ZIP;
- the component definitions, bundle files, variants, variables and native
  events created;
- when Remote MCP is used, the final workspace revision and the semantic
  sections confirmed in the Builder;
- the validation outcome;
- a concise integration summary;
- no extra setup guide unless requested.
