# Primeira extensão

## 1. Estrutura

```text
hello-kodety/
├── kodety-extension.json
├── extension.php
└── assets/
    ├── admin.css
    └── frontend.js
```

O ZIP pode conter esses arquivos diretamente ou uma única pasta externa. O
manifesto e o entrypoint precisam estar juntos na raiz lógica do pacote.

## 2. Manifesto mínimo para a API v1

```json
{
  "schemaVersion": 1,
  "type": "extension",
  "slug": "vendor-feature",
  "name": "Vendor Feature",
  "description": "Exemplo de integração pública.",
  "version": "1.0.0",
  "entry": "extension.php",
  "requires": {
    "php": ">=8.0",
    "kodety": ">=1.0.17",
    "extensionApi": ">=1.0.0"
  },
  "permissions": [
    "storage.read",
    "storage.write",
    "frontend.register"
  ],
  "capabilities": []
}
```

Peça somente permissões usadas. Permissões desconhecidas e versões futuras da
API fazem a instalação falhar antes de qualquer PHP do pacote ser executado.

## 3. Entrypoint

```php
<?php

defined('ABSPATH') || exit;

$extension = kodety_extension();
if (!$extension || $extension->slug() !== 'vendor-feature') return;

$storage = $extension->storage();
if (!$storage->has('message')) $storage->set('message', 'Olá, Onun Kodety!');

$extension->frontend()->shortcode(
    'message',
    static fn(): string => '<p>' . esc_html((string) $storage->get('message')) . '</p>'
);
```

O nome retornado será `[kodety_vendor_feature_message]`. O contexto existe de
novo automaticamente dentro de callbacks registrados pela API. Mesmo assim,
capture `$extension` e os serviços necessários; chamar `kodety_extension()` em
um callback WordPress arbitrário pode retornar `null`.

## 4. Instalar e ativar

Crie um ZIP cujo conteúdo inicial seja `kodety-extension.json` e
`extension.php`. No Onun Kodety, abra **Extensions → Install Extension**, envie o ZIP
e revise nome, versão, permissões e capabilities. A instalação deixa pacotes
novos inativos. Ative explicitamente para executar o entrypoint.

## 5. Checklist rápido

- o slug possui 3–64 caracteres minúsculos, números ou hífens;
- `entry` é relativo, termina em `.php` e existe;
- `requires.extensionApi` corresponde ao contrato utilizado;
- todas as permissões chamadas estão declaradas;
- capabilities usadas em admin, auth, routes ou media estão declaradas;
- saída HTML, SQL, arquivos e inputs são escapados/validados;
- ativação é idempotente e desativação preserva dados;
- o ZIP não inclui dependências de desenvolvimento, segredos ou links
  simbólicos.
