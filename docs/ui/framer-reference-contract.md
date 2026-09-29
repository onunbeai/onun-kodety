# Framer UI reference contract

Source of truth: Figma file `j6obJ6UlI15G4K19Sp3atH`, root node
`2009:668`. The implementation must adapt the reference to the existing React,
TypeScript and CSS stack. It must not copy generated Tailwind code or introduce
Tailwind as a dependency.

## Product character

- Dense, calm and tool-like. Prefer hierarchy, alignment and separators over
  decorative cards.
- Do not add an AI-dashboard appearance: avoid large cards, gradients, glows,
  oversized type, verbose helper copy and excessive rounded containers.
- Icons are normally unboxed. A background is reserved for an active state, a
  primary action, a compact segmented control or a control with a real hit area.
- Preserve all existing behavior, callbacks, persistence and accessibility.
  Visual work must not replace working controls with static replicas.

## Reference palette

- Application panels: `#111111`
- Workspace/canvas surround: `#222222`
- Inputs and compact controls: `#2b2b2b`
- Selected neutral surface: `#555555`
- Dividers and hairlines: `#252525`
- Primary accent: `#9393ff` (lighter states: `#afafff`)
- Primary text: `#ffffff`
- Secondary text: `#cccccc`
- Muted text: `#999999`
- Disabled/de-emphasized text: `#666666`

Use semantic variables already present in the product when available. Keep
danger, warning and success colors semantic rather than recoloring them blue.

## Geometry and density

The Figma frame is drawn at roughly 1.4× the intended browser density. Normalize
its measurements to the product scale:

- Top bar: approximately `50–52px`.
- Desktop sidebars: left approximately `220px`; right approximately
  `232–248px`, resizable/collapsible where the current product supports it.
- Common compact control/row: `26–30px`.
- Inspector section header: `42–44px`.
- Common radius: `7–8px`; nested selected segment: `5–6px`.
- Panel padding: generally `12–14px`; compact inline gap: `6–9px`.
- Icon size: usually `14–16px`.
- UI type: Inter, normally `11–12px`; labels may use `10–11px`; section titles
  use restrained `12–13px` semibold.

Use one-pixel dividers and subtle shadows only for floating surfaces or active
segmented controls. Never use borders on every possible container.

## Editor shell

- Keep the top bar visually continuous and compact.
- Left actions, centered project identity and right publishing actions must
  remain stable as the viewport changes.
- The canvas is the visual focus. Toolbars and breakpoint chrome must not cover
  content or create unexplained empty bands.
- On narrower viewports, panels may collapse or overlay, but controls must remain
  reachable by keyboard and pointer without horizontal page overflow.

## Navigator

- `Pages / Layers / Assets` is a single compact segmented control. Reference
  node `2009:752`: neutral `#2b2b2b` track, `#555555` active segment, white
  active text and `#999999` inactive text.
- Layer/breakpoint rows are dense and aligned. The selected primary breakpoint
  may use solid blue; its descendants use a subtle blue-tinted region.
- Use indentation, tiny disclosure affordances and small semantic icons. Do not
  place each icon in an independent capsule.
- Truncate long names and preserve selection, drag/drop and context-menu
  behavior.

## Inspector

- Organize properties into flat sections separated by hairlines.
- Section headers are one row with the title on the left and a plain disclosure
  or add action on the right.
- Labels use a stable column; related values share compact rows and align their
  baselines.
- Inputs, selects, steppers and segmented controls use `#2b2b2b`, compact
  radii and clear focus states.
- Avoid nested card stacks. Popovers may float, but the main panel remains flat.

## CMS

- Use a three-region professional data-tool layout: collection/field navigation,
  table/list workspace and contextual item/field editor.
- Tabs are compact and content-width unless the available width requires equal
  distribution.
- Toolbars use plain icon actions; the primary create action may use a filled
  hit area.
- Field pickers are searchable, grouped and keyboard navigable. Editing dialogs
  retain compact labels and predictable actions.
- Empty, loading, error and saved states must be explicit without large
  decorative cards.

## Settings

- Use a persistent left information architecture and a constrained, readable
  content column.
- Separate site-level and page-level settings. Group related fields and place
  destructive actions at the end in a clear danger zone.
- Keep previews useful and proportional. Do not let forms stretch indefinitely
  across wide screens.
- At compact widths, navigation becomes a drawer or top selector while the form
  becomes one column.

## Localization

- Use a locale list/navigation region and a translation workspace with clear
  source/target columns.
- Locale configuration is a focused modal or drawer with a list on the left and
  aligned fields on the right; it becomes one column on compact screens.
- Progress, missing translations, unsaved changes, filters and bulk actions
  must be legible and preserve the current persistence/integration contracts.

## Accessibility and responsive acceptance

- Visible `:focus-visible` rings on every interactive control.
- Minimum practical pointer target of about `28px` in this dense desktop tool;
  larger targets on touch-oriented compact layouts.
- Tooltips or accessible labels for icon-only actions.
- No clipped labels, detached dropdown arrows, uncovered panel strips, double
  scrollbars or content that fails to fill its assigned panel.
- Support reduced motion and forced-colors/high-contrast behavior where the
  existing stack exposes it.
