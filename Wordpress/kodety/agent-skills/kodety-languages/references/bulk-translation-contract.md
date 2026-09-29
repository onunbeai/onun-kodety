# Bulk translation contract

The localization service exposes a semantic catalog rather than raw project
files. The Agent may use it from any Builder workspace; opening Languages is
not a prerequisite. Its target IDs are opaque capabilities tied to the current
revision, and apply commits through the same native Localization API as the UI.

## Snapshot

Call `kodety_localization_snapshot` with:

- `localeCode`: exact configured destination;
- `pagePaths`: optional exact authored paths for page-scoped work;
- `onlyMissing`: true unless existing translations must be reviewed;
- `cursor`: the previous `nextCursor` within the same unchanged revision;
- `limit`: up to 120, normally 40–80.

Each item contains:

- `target`: echo exactly; never parse, edit, translate, or fabricate it;
- `kind`: content, site metadata, SEO metadata, or a localized path;
- `source`: complete source text for this bounded item;
- `current`: direct translation, possibly empty;
- `context`: page and semantic role.

The host bounds total characters and reports oversized targets separately.
Do not translate a truncated or absent source.

## Apply

Call `kodety_apply_localization_translations` with the exact snapshot revision,
destination locale, a concise summary, and an array of `{target, value}`.
The host validates every target against the live public page, rejects unknown
or duplicate targets, checks route collisions and persistence limits, and
commits the batch once. A rejected batch applies nothing.

After a successful apply the revision changes. Start the next read at cursor
`0` with `onlyMissing: true`; completed entries disappear, so using an old
cursor after a write could skip work.

## Text fidelity

Preserve exactly:

- `{{name}}`, `${name}`, `%name%`, `:name`, ICU/message-format tokens, and
  printf tokens such as `%s` or `%1$d`;
- URLs, email addresses, phone numbers, SKUs, prices, dates, legal references,
  and measurement units unless localization explicitly requires formatting;
- trademarked/product names and user-authored capitalization when meaningful;
- inline markup semantics represented by separate text targets.

Do not add HTML to plain translation values. Do not add claims, guarantees,
prices, or facts absent from the source.

## Scope patterns

### Whole site

Read a batch with no `pagePaths`, translate/apply it, then reread at cursor 0
until `totalItems` is zero. This includes site metadata and every authored
public page.

### One page

Pass one exact `pagePaths` value. This includes its content, SEO fields, and
localized route when enabled.

### Review existing text

Use `onlyMissing: false`. Compare `source` and `current`, return only targets
that actually need correction, and set `overwrite: true` only because the user
explicitly requested review/retranslation.

### Resume

Always reread live state. Progress is derived from persisted localization
metadata, so completed batches remain complete across turns without a local
checkpoint file.
