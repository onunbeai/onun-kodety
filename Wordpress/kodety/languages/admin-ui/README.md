# Onun Kodety admin UI catalogs

The plugin automatically discovers every `*.json` catalog in this directory.
`pt-BR.json` is selected when the WordPress locale starts with `pt`; `en.json`
is selected for English and every other WordPress locale. Administrators may
override that decision in **Onun Kodety → Configurações → Workspace do WordPress**.

To add a language, copy `en.json`, rename the file (for example `es.json`),
change `locale`, `name`, `nativeName`, `direction`, and translate the values in
`messages`. Message IDs and placeholders such as `{count}` must stay unchanged.
The generated `direct` map covers legacy component copy; translate its values
while keeping its source keys and placeholders unchanged.
Legacy `glossary` and `legacy` fields may remain in older catalogs for file
compatibility, but the runtime deliberately does not apply fragment-by-fragment
translation. Every visible phrase must have an exact entry in `direct` (or a
placeholder-aware entry such as `{count}`), preventing bilingual sentences and
protecting project names and user-authored content. The Builder, CMS, Insights,
email editor, login and Onun Kodety wp-admin surfaces read the same selected catalog.

`aliases.json` is the source compatibility map. It connects existing Portuguese
and English interface phrases to stable IDs, so future language files never
depend on the language used in a React or PHP source file.
