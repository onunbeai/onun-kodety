# Onun Kodety template library

Add distributable templates under `template-library/<slug>/`:

```text
template-library/example/
├── template.json
└── project/
    ├── index.html
    ├── css/
    ├── js/
    ├── assets/
    └── .incode/
```

`project.zip` can replace the `project/` directory. Its content must be flat,
with the HTML entry at the archive root (or declared by `.incode/project.json`).

Example `template.json`:

```json
{
  "schemaVersion": 1,
  "slug": "example",
  "name": "Example",
  "description": "A complete editable Onun Kodety site.",
  "category": "business",
  "badge": "NEW",
  "featured": false,
  "pages": 1
}
```

Accepted categories: `ecommerce`, `landing-page`, `business`, `portfolio`,
`blog`, and `other`.
