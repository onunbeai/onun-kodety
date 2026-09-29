---
name: kodety-languages
description: Configure, translate, review, complete, and maintain multilingual Onun Kodety sites through the native Languages workspace. Use when the user asks to add, remove, enable, or configure a locale, fallback, default language, or localized URL behavior; translate a whole site, one or more pages, missing strings, SEO metadata, localized paths, or an existing locale; translate without an external API; or check localization progress and quality in bulk.
---

# Onun Kodety Languages

Translate the live Onun Kodety localization catalog semantically and in bounded
batches. Do not drive hundreds of visible inputs or edit source HTML to create
a locale.

## Required workflow

1. Call `kodety_editor_context`. Use the semantic tools advertised in
   `localization.tools` from the current workspace. Translation reads and
   writes do not require Languages to be open, so never navigate there or ask
   the user to open it just to translate.
   When `editor.workspace` is `localization`, the current workspace is always
   the host-independent `/kodety/localization/` route reported by
   `editor.canonicalUrl`; never reinterpret it as Canvas or redirect it to
   `/kodety/editor/`.
2. Call `kodety_localization_snapshot` without `localeCode` when the requested
   source or destination is ambiguous. Use the configured canonical code, not
   a guessed locale.
3. Read [references/bulk-translation-contract.md](references/bulk-translation-contract.md)
   before translating content.
4. Call `kodety_localization_snapshot` with the destination `localeCode`,
   `onlyMissing: true`, and any exact page scope requested by the user.
5. Translate the returned `batch.items` yourself. Echo each opaque `target`
   unchanged and send only its translated `value` to
   `kodety_apply_localization_translations`.
6. Use the exact `revision` returned by the snapshot. Apply one complete batch
   atomically, then read the next snapshot with its `nextCursor` or restart at
   cursor `0` after the revision changes. Never reuse a stale revision.
7. Continue until the requested page/site scope has no remaining items, an
   oversized item requires user direction, or the user asks to stop.
8. Read the final snapshot and report applied, preserved, pending, and blocked
   content. Keep all work in draft; publishing still requires an explicit user
   request.

## Native bulk behavior

- Use `kodety_localization_snapshot` and
  `kodety_apply_localization_translations` for translation content, SEO, site
  metadata, and localized paths from any Builder workspace. The apply tool
  commits through the same revisioned Localization API used by the native UI.
- Use `kodety_apply_localization_settings` for adding, updating, enabling, or
  removing a locale; changing its URL prefix, fallback, or direction; choosing
  the default locale; and changing global language preferences. Read a fresh
  localization snapshot first and pass its exact revision. Set
  `confirmRemoval: true` only after the user explicitly requests removal.
- Use `kodety_panel_snapshot` and `kodety_panel_action` only for visible
  navigation, dialogs, and controls that have no semantic localization tool.
- Never click translation rows one by one. Never paste translations into the
  DOM, modify `.incode/project.json`, or call generic project/source mutation
  tools for localized content. In particular, do not edit the source locale
  with `kodety_apply_changes` as a substitute for a translation.
- The Agent's own language model performs translation. Do not require or call
  the optional external AI translation endpoint.

## Overwrite policy

The default is fill-missing. Leave `overwrite` false so reviewed human text is
preserved. Set it true only when the user explicitly asks to retranslate,
replace, standardize, or review existing translations. If the request is
ambiguous, preserve existing values.

## Quality bar

- Preserve placeholders, interpolation tokens, product names, URLs, numbers,
  punctuation intent, and accessibility meaning.
- Keep `alt`, `title`, `placeholder`, and `aria-label` concise and functional.
- For `pagePath`, return a short locale-appropriate slug without a leading or
  trailing slash. Do not translate file extensions or invent nested routes.
- Match the destination locale's script, regional spelling, tone, and text
  direction. Prefer natural copy over literal word substitution.
- Do not translate opaque target IDs, CSS/HTML identity, code, analytics
  markers, or component metadata.
- If source copy is ambiguous, preserve its meaning and flag the specific
  target for review rather than silently inventing facts.

## Large jobs

For three or more batches, call `kodety_progress_update` with compact stages
for catalog, translation, persistence, and verification. Update it after real
batch acknowledgements, not while merely composing text. A batch failure is
atomic: reread the catalog/revision, diagnose the rejected target, and retry a
corrected bounded batch.
