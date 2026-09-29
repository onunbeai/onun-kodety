# Native Onun Kodety Panel Contract

Use this contract whenever `kodety_editor_context` returns
`editor.nativePanel.required: true`.

## Universal loop

1. Inspect `editor.nativePanel.tools`. Call `kodety_panel_snapshot` without a query to understand the visible
   route, headings, tabs, fields, buttons, links, dialogs, and menus.
2. Locate the exact control by its `label`, `kind`, current value, and scope.
3. Call `kodety_panel_action` with that control's `id` and the exact panel
   `revision`.
4. Read the panel again. Navigation, menus, dialogs, tabs, toggles, and field
   changes can all replace controls and advance the revision.
5. Continue one coherent action at a time until the panel itself confirms the
   saved result.

Use `query` only to filter a large visible panel. If the target is not visible,
navigate with the controls that are visible; never invent a control ID.

## Actions

- `click`: buttons, tabs, links, menu items, options, save actions, add actions,
  and route navigation.
- `setValue`: inputs, textareas, selects, and content-editable fields. Send the
  complete intended value. Custom-code fields may receive a complete script.
- `toggle`: checkboxes, radios, and switches. Always send the intended final
  `checked` state.
- `focus`: reveal or focus a control when that is useful before continuing.

Deleting, removing, or disabling content requires an explicit user request.
Only then repeat the action with `confirmDestructive: true`.

## Coverage examples

- Settings: general data, collaboration, SEO and discovery, redirects, custom
  code/scripts, integrations and AI, Agents, storage, experimental features,
  and per-page settings.
- CMS: collections, fields, plugins, items, row editors, imports, filters, and
  visible publishing controls.
- Analytics: overview, page insights, funnels, A/B tests, date ranges, filters,
  tracking settings, and visible reports.
- Localization: use panel tools for locales, settings, dialogs and navigation;
  use `kodety_localization_snapshot` and
  `kodety_apply_localization_translations` for content/SEO/path translation in
  native batches, never individual field clicks.
- Members and Templates: every action exposed by their current visual routes.
- Dialogs and menus: inspect and operate their controls through the same loop.

This list does not limit the bridge. Any new accessible control rendered by a
native panel is discoverable through `kodety_panel_snapshot` and must be used
instead of bypassing the UI.

## Safety and verification

- Do not call project/source, component, or Motion mutation tools in a native
  panel.
- Do not edit HTML, CSS, JavaScript, JSON, or internal project files to mimic a
  panel change.
- Respect disabled controls and permission gates.
- On a revision conflict or missing control, read again and reconcile the
  newest visual state.
- Do not claim completion until the panel readback shows the intended state or
  its native success confirmation.
