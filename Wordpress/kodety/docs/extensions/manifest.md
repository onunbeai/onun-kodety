# Manifesto `kodety-extension.json`

O manifesto identifica, valida e negocia a compatibilidade do pacote antes do
entrypoint ser carregado.

```json
{
  "schemaVersion": 1,
  "type": "extension",
  "slug": "vendor-feature",
  "name": "Vendor Feature",
  "description": "Recurso independente para o site.",
  "version": "1.2.0",
  "entry": "extension.php",
  "icon": "plugins",
  "requires": {
    "php": ">=8.0",
    "kodety": ">=1.0.17",
    "extensionApi": ">=1.0.0"
  },
  "dependencies": ["vendor-base"],
  "permissions": ["storage.read", "storage.write", "routes.register"],
  "capabilities": ["manage_options"],
  "author": {"name": "Vendor", "url": "https://example.com"},
  "homepage": "https://example.com/vendor-feature"
}
```

## Campos

| Campo | Regra |
| --- | --- |
| `schemaVersion` | Obrigatório; inteiro `1`. |
| `type` | Obrigatório; `extension`. |
| `slug` | 3–64 caracteres, regex `[a-z0-9][a-z0-9-]+`; é a identidade permanente. |
| `name` | Obrigatório, até 120 caracteres. |
| `description` | Obrigatório, até 500 caracteres. |
| `version` | Obrigatório; começa por número, até 64 caracteres. SemVer recomendado. |
| `entry` | PHP relativo existente dentro do pacote. |
| `requires.php` | Versão mínima; padrão `8.0`. |
| `requires.kodety` | Versão mínima do produto; padrão `0.0.0`. |
| `requires.extensionApi` | Versão mínima do contrato público; padrão legado `0.0.0`. |
| `dependencies` | Slugs que precisam estar instalados e ativos. |
| `permissions` | Lista fechada de operações da API pública. |
| `capabilities` | Capabilities WordPress que o código pretende consultar/exigir. |
| `author`, `homepage`, `icon` | Metadados de catálogo opcionais. |

Versões aceitam `1.2.3` ou `>=1.2.3`. Intervalos, `^`, `~`, curingas e versões
máximas não fazem parte do schema v1.

## Permissões conhecidas na API v1

```text
hooks.listen       hooks.emit
events.listen      events.emit
storage.read       storage.write
routes.register    admin.register
media.read         media.write
auth.read          ui.render
frontend.read      frontend.register
blocks.register
```

Uma string desconhecida é erro de instalação. Não existe wildcard. Declarar
uma permissão não concede uma capability WordPress e declarar uma capability
não concede uma permissão de API: ambas as verificações são independentes.

Exemplo: registrar uma página para administradores exige `admin.register` em
`permissions`, `manage_options` em `capabilities` e um usuário atual que passe
em `current_user_can('manage_options')`.

## Compatibilidade legada

Pacotes anteriores à API v1 podem omitir `permissions` e
`requires.extensionApi`; eles continuam instaláveis. A lista vazia resultante
não autoriza chamadas aos serviços públicos. Para migrar, declare a versão e
cada permissão efetivamente usada.

Filtros do WordPress podem enriquecer metadados de apresentação, mas não podem
alterar slug, entrypoint, requisitos, permissões ou capabilities depois da
validação.
