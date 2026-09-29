# Native Onun Kodety Panel Contract

Use this contract inside the Onun Kodety Agent whenever `kodety_editor_context`
returns `editor.nativePanel.required: true`.

## Required action loop

1. Call `kodety_panel_snapshot` to read the current visual route, headings,
   tabs, fields, links, buttons, menus, and dialogs.
2. Identify the exact live control by label, kind, scope, and current value.
3. Call `kodety_panel_action` with its `controlId` and the exact panel
   `revision`.
4. Read again after every route, tab, menu, dialog, toggle, or field change.
5. Continue one coherent action at a time and verify the result through the
   panel's own readback or success state.

`click` operates navigation, tabs, buttons, links, menu items, options, add and
save actions. `setValue` updates inputs, textareas, selects, and editable
regions; it may carry a complete custom-code script. `toggle` sets the explicit
final checked state of a checkbox, radio, or switch. `focus` reveals or focuses
a live control.

## Complete panel coverage

The contract is generic and includes every accessible control exposed now or
later by native visual workspaces, including:

- Settings: general, collaboration, SEO, redirects, custom code and scripts,
  integrations and AI, Agents, storage, experimental features, and per-page
  settings;
- CMS: collections, fields, plugins, items, editors, import, filters, and
  visible publishing controls;
- Analytics: overview, page insights, funnels, A/B tests, dates, filters,
  tracking settings, and visible reports;
- Localization: locales, translated values, locale settings, generation, and
  review controls;
- Members, Templates, all nested routes, menus, dialogs, and future controls
  rendered by those panels.

If a target is behind a route, tab, menu, or modal, navigate through visible
controls and snapshot again. Never invent a control ID or fall back to source
editing.

## Safety

- Do not call project/source, component, or Motion mutation tools while the
  context requires a native panel.
- Do not edit HTML, CSS, JavaScript, JSON, or internal files to imitate a panel
  action. The panel owns validation, permissions, persistence, and APIs.
- Respect disabled controls and license/permission gates.
- Deletion, removal, or disabling requires an explicit user request and then
  `confirmDestructive: true` on the matching action.
- On revision conflict or a missing control, snapshot again and reconcile the
  latest visual state.
- Never claim completion before the visual panel confirms the intended state.
