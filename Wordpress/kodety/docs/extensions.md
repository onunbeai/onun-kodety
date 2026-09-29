# Extensões Onun Kodety

> A referência versionada da Public Extension API v1 está em
> [`extensions/README.md`](extensions/README.md). Este arquivo permanece como
> referência do instalador/registry legado e do formato de bundles.

Este documento descreve a API pública de extensões do Onun Kodety.
Extensões são pacotes PHP independentes do projeto visual: publicar, substituir
ou restaurar o ZIP de um site não altera extensões instaladas nem suas
configurações.

> Extensões executam PHP dentro do WordPress. Instale apenas pacotes de origem
> confiável e revise o código antes de distribuí-lo.

## Modelo

Uma extensão contém:

1. `kodety-extension.json`, com identidade, versão e requisitos;
2. um entrypoint PHP relativo à raiz do pacote;
3. opcionalmente, arquivos próprios de PHP, JavaScript, CSS e assets.

O Onun Kodety armazena extensões externas fora do workspace do site, em uma pasta
gerenciada por `Kodety_Extensions`. O entrypoint só é carregado quando a
extensão está ativa.

Em produção, prefira colocar o código fora do document root. Defina o caminho
absoluto no `wp-config.php`, antes de carregar o WordPress:

```php
define('KODETY_EXTENSIONS_DIR', '/srv/kodety-private/extensions');
```

Também é possível usar o filtro `kodety_extensions_storage_dir`. O caminho não
pode ser a raiz do servidor, `ABSPATH`, `WP_CONTENT_DIR` nem o workspace
substituível `uploads/kodety`. Sem configuração explícita, o fallback é
`uploads/kodety-extensions`, protegido por arquivos de bloqueio para
Apache/IIS. Em Nginx ou infraestrutura customizada, configure o caminho fora
do diretório público.

Somente três superfícies inseparáveis aparecem instaladas em uma instalação
nova:

- `kodety-cms`
- `kodety-settings`
- `kodety-emails`

Elas são `required` e não podem ser removidas separadamente. Analytics,
Marketing, Membership, Commerce e Multi-language são distribuídas em ZIPs
independentes na pasta `Wordpress/dist/extensions/` e não vêm instaladas no
plugin principal.

Extensões também podem fornecer um template próprio ao Builder pelo filtro
`kodety_editor_shell_config`. Esses templates aparecem em um menu separado em
**Pages → Template**, usam endpoints da própria extensão e não alteram o
contrato **Página de template** do CMS.

## ZIP individual

O manifesto pode estar na raiz do ZIP ou dentro de uma única pasta externa:

```text
vendor-recurso.zip
├── kodety-extension.json
├── extension.php
├── includes/
│   └── class-feature.php
└── assets/
    └── feature.css
```

Manifesto mínimo:

```json
{
  "schemaVersion": 1,
  "type": "extension",
  "slug": "vendor-recurso",
  "name": "Vendor Recurso",
  "description": "Descrição curta do recurso.",
  "version": "1.0.0",
  "entry": "extension.php"
}
```

Manifesto completo:

```json
{
  "schemaVersion": 1,
  "type": "extension",
  "slug": "vendor-recurso",
  "name": "Vendor Recurso",
  "description": "Descrição curta do recurso.",
  "version": "1.0.0",
  "entry": "extension.php",
  "icon": "plugins",
  "requires": {
    "php": ">=8.0",
    "kodety": ">=1.0.17",
    "extensionApi": ">=1.0.0"
  },
  "dependencies": ["kodety-cms"],
  "author": {
    "name": "Vendor",
    "url": "https://example.com"
  },
  "homepage": "https://example.com/vendor-recurso",
  "permissions": ["storage.read"],
  "capabilities": ["edit_posts"]
}
```

### Campos

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `schemaVersion` | sim | Inteiro `1`. |
| `type` | sim | Exatamente `extension`. |
| `slug` | sim | Identificador único com 3–64 caracteres: letras minúsculas, números e hífens. |
| `name` | sim | Nome legível, com até 120 caracteres. |
| `description` | sim | Resumo exibido no catálogo, com até 500 caracteres. |
| `version` | sim | Começa com número e tem até 64 caracteres. SemVer é recomendado. |
| `entry` | sim | Caminho PHP relativo, dentro do pacote, para um arquivo existente. |
| `icon` | não | Nome semântico de ícone do catálogo; o padrão é `plugins`. |
| `requires.php` | não | Versão mínima exata ou com `>=`; o padrão é `8.0`. |
| `requires.kodety` | não | Versão mínima exata ou com `>=`; o padrão é `0.0.0`. |
| `requires.extensionApi` | não | Versão mínima da API pública; use `>=1.0.0` para extensões novas. |
| `dependencies` | não | Lista de slugs que precisam estar ativos antes da ativação. |
| `author.name` | não | Pessoa ou organização responsável. |
| `author.url` | não | URL do autor. |
| `homepage` | não | URL da documentação ou do produto. |
| `capabilities` | não | Capacidades WordPress que a extensão declara usar. |
| `permissions` | não | Operações conhecidas da Public Extension API; strings desconhecidas são rejeitadas. |

Os slugs das extensões incluídas no Onun Kodety são reservados. Uma extensão não
pode depender de si mesma.

`capabilities` não concede permissões. Serviços públicos que consultam uma
capability exigem que ela esteja declarada e ainda chamam
`current_user_can()` em cada operação privilegiada. Veja a lista fechada de
`permissions` em [`extensions/manifest.md`](extensions/manifest.md).

## Bundle

Um bundle contém de 1 a 50 ZIPs de extensão. Ele não contém as extensões
descompactadas:

```text
vendor-suite.zip
├── kodety-bundle.json
└── packages/
    ├── vendor-recurso.zip
    └── vendor-outro.zip
```

`kodety-bundle.json`:

```json
{
  "schemaVersion": 1,
  "type": "bundle",
  "packages": [
    "packages/vendor-recurso.zip",
    "packages/vendor-outro.zip"
  ]
}
```

Regras:

- `schemaVersion` deve ser `1`;
- `type` deve ser `bundle`;
- `packages` deve listar de 1 a 50 caminhos relativos para arquivos `.zip`;
- cada ZIP interno deve ser uma extensão individual válida;
- caminhos absolutos, `..`, links simbólicos e slugs duplicados são rejeitados;
- um bundle não pode conter outro bundle.

O manifesto do bundle pode estar na raiz ou dentro de uma única pasta externa.
A instalação só é confirmada depois que todos os pacotes forem validados.

## Entrypoint e lifecycle

O entrypoint é incluído com `require_once` apenas enquanto a extensão está
ativa. Ele deve interromper a execução fora do WordPress e registrar seus
hooks com o slug exato do manifesto:

```php
<?php

namespace Vendor\Recurso;

defined('ABSPATH') || exit;

const SLUG = 'vendor-recurso';

if (!function_exists('\kodety_extension')) return;
$extension = \kodety_extension();
if (!$extension || $extension->slug() !== SLUG) return;
$storage = $extension->storage();

function activate(\Kodety_Extension_Storage $storage): void {
    if (!$storage->has('enabled')) $storage->set('enabled', true);
}

function deactivate(): void {
    // Cancele apenas jobs temporários. Preserve dados e configurações.
}

add_action(
    'kodety_extension_activate_' . SLUG,
    static fn(): mixed => activate($storage)
);
add_action('kodety_extension_deactivate_' . SLUG, __NAMESPACE__ . '\\deactivate');
```

Ativação e migrações devem ser idempotentes. A desativação deve ser
reversível.

Ao atualizar uma extensão que já estava ativa, o Onun Kodety grava uma migração
pendente. No próximo request ele carrega o entrypoint novo, executa novamente
o hook dinâmico de ativação e só então libera extensões dependentes. Se a
migração falhar, a nova versão é marcada como inativa com o erro preservado no
registro.

O entrypoint de uma extensão inativa não é carregado durante sua remoção.
Portanto, não dependa de um callback do próprio pacote para apagar dados.
Prefira as configurações administradas pelo Onun Kodety ou ofereça uma ação explícita
de limpeza enquanto a extensão ainda estiver ativa.

### Actions

As assinaturas abaixo são parte do contrato atual:

```php
// Instalação atômica de um ou mais manifests.
do_action('kodety_extension_before_install', $manifests, $manager);
do_action('kodety_extension_after_install', $slug, $record, $manager);

// Ativação.
do_action('kodety_extension_before_activate', $slug, $extension, $manager);
do_action("kodety_extension_activate_{$slug}", $extension, $manager);
do_action('kodety_extension_after_activate', $slug, $extension, $manager);

// Desativação.
do_action('kodety_extension_before_deactivate', $slug, $extension, $manager);
do_action("kodety_extension_deactivate_{$slug}", $extension, $manager);
do_action('kodety_extension_after_deactivate', $slug, $extension, $manager);

// Remoção.
do_action(
    'kodety_extension_before_uninstall',
    $slug,
    $extension,
    $deleteSettings,
    $manager
);
do_action(
    'kodety_extension_after_uninstall',
    $slug,
    $extension,
    $deleteSettings,
    $manager
);

// Carregamento.
do_action('kodety_extension_loaded', $slug, $manifest, $manager);
do_action('kodety_extensions_loaded', $manager);
```

`kodety_extension_activate_{slug}` e `kodety_extension_deactivate_{slug}` são os
hooks destinados ao lifecycle do próprio pacote. Os hooks genéricos são úteis
para integrações do host e observabilidade.

### Filters

```php
$catalog = apply_filters('kodety_extensions_catalog', $catalog, $manager);

$manifest = apply_filters(
    'kodety_extension_manifest',
    $normalizedManifest,
    $rawManifest,
    $extensionRoot,
    $manager
);
```

O filtro de manifesto roda depois da validação estrutural. Não o use para
afrouxar as regras de segurança nem para carregar PHP manualmente.

## API PHP do host (legada)

Os métodos abaixo existem para o próprio host/administrador de extensões. Um
pacote API v1 não deve obter o manager nem chamar esses métodos; use o contexto
documentado em [`extensions/README.md`](extensions/README.md).

Leitura:

```php
$manager = \Kodety_Extensions::instance();

$catalog = $manager->catalog();
$installed = $manager->installed();
$extension = $manager->get('vendor-recurso');
$active = $manager->is_active('vendor-recurso');
$activeSlugs = $manager->active_slugs();
```

Operações retornam `true`/array em sucesso ou `WP_Error` em falha:

```php
$install = $manager->install_zip($temporaryZipPath);
$activate = $manager->activate_extension('vendor-recurso');
$deactivate = $manager->deactivate_extension('vendor-recurso');

// Preserva settings por padrão.
$remove = $manager->uninstall('vendor-recurso');

// Apaga também as settings administradas pelo Onun Kodety.
$removeEverything = $manager->uninstall('vendor-recurso', true);
```

Não grave diretamente em `storage_dir()`. A pasta é administrada pelo Onun Kodety e
sua implementação pode mudar.

## Configurações persistentes legadas

O manager legado mantém `kodety_extension_settings`. Extensões API v1 devem usar
`$extension->storage()` conforme
[`extensions/storage.md`](extensions/storage.md). O trecho a seguir é exclusivo
do host:

```php
$manager = \Kodety_Extensions::instance();

$settings = $manager->get_settings('vendor-recurso', []);
$settings['enabledForGuests'] = true;
$manager->update_settings('vendor-recurso', $settings);

// Somente numa remoção que pediu explicitamente para apagar dados.
$manager->delete_settings('vendor-recurso');
```

As configurações:

- sobrevivem à desativação;
- sobrevivem à atualização ou reinstalação do mesmo slug;
- sobrevivem à troca do ZIP do projeto visual;
- sobrevivem à remoção padrão da extensão;
- só são apagadas por `delete_settings()` ou `uninstall($slug, true)`.

Versione o formato dentro do próprio array, por exemplo com uma chave
`schemaVersion`. Migrações devem ser incrementais, idempotentes e preservar
chaves desconhecidas sempre que possível.

## Atualização, dependências e versões

Enviar outro pacote com o mesmo slug atualiza os arquivos de forma atômica. O
Onun Kodety preserva:

- o estado ativo/inativo anterior;
- a data da instalação original;
- as configurações isoladas do slug.

Use SemVer para `version`. Atualize `requires.php` e `requires.kodety` sempre
que adotar APIs novas. As restrições aceitas são uma versão numérica, como
`8.1`, ou a mesma versão prefixada por `>=`.

Dependências são verificadas na ativação. Cada slug listado em `dependencies`
precisa estar instalado e ativo primeiro. A instalação do pacote não instala
dependências automaticamente. No boot, extensões externas são carregadas em
ordem topológica. Ciclos, dependências ausentes e falhas de carregamento
desativam o módulo afetado. Uma dependência também não pode ser desativada ou
removida enquanto houver um dependente ativo.

Instalação, atualização, ativação, desativação, remoção e escrita de settings
compartilham um lock do registro. Isso evita que uploads simultâneos percam
estado ou deixem diretórios sem registro.

## Permissões

Na interface do Onun Kodety:

- instalar, atualizar e remover exige `manage_options` e `install_plugins`;
- ativar e desativar exige `manage_options` e `activate_plugins`.

Dentro da extensão, use capacidades WordPress específicas para cada ação. Para
formulários, REST e AJAX:

1. verifique `current_user_can()`;
2. valide nonce;
3. normalize e sanitize toda entrada;
4. escape a saída no contexto correto;
5. retorne erro sem revelar caminhos, tokens ou detalhes internos.

## Segurança do instalador

Os limites atuais são:

- ZIP externo: 256 MB;
- conteúdo total descompactado: 256 MB;
- arquivo individual: 32 MB;
- total de entradas: 2.000;
- pacotes por bundle: 50;
- manifesto JSON: 256 KB.

O instalador bloqueia:

- path traversal e caminhos absolutos;
- links simbólicos;
- arquivos sem extensão ou de tipo não permitido;
- entrypoint fora da pasta instalada;
- ZIP inválido ou truncado;
- mais de um manifesto principal;
- mistura de manifesto individual e bundle;
- slugs duplicados ou reservados;
- atualização parcial: arquivos e registro são revertidos juntos em falha.

Extensões podem conter apenas:

```text
php js mjs cjs css json html htm svg
png jpg jpeg gif webp avif ico
woff woff2 ttf otf txt md csv xml yaml yml
```

ZIP interno só é aceito como pacote listado por um bundle.

O storage fallback cria proteções contra listagem e acesso HTTP a PHP em
Apache/IIS. Isso não substitui uma regra equivalente no Nginx; a configuração
mais segura continua sendo `KODETY_EXTENSIONS_DIR` fora do document root.
Código instalado continua sendo código privilegiado. Além disso:

- não use `eval`, `assert` com string ou `unserialize` de entrada externa;
- não baixe PHP para executar em runtime;
- não acesse o workspace nem os ZIPs do projeto visual;
- use namespace e prefixe hooks, opções, tabelas e assets;
- proteja endpoints REST com `permission_callback`;
- não armazene segredos no manifesto ou no JavaScript;
- não presuma que uma capability declarada foi concedida.

## Exemplo pronto

Veja [`example-extension/`](./example-extension/). Para gerar o ZIP:

```sh
cd Wordpress/kodety/docs/example-extension
zip -r acme-example.zip kodety-extension.json extension.php README.md
```

Envie o arquivo em **Onun Kodety → Extensões**, ative **ACME Example** e use o
shortcode `[kodety_acme_example_message]`.

## Checklist de publicação

- [ ] `kodety-extension.json` está na raiz ou numa única pasta externa.
- [ ] `type` é `extension` e `schemaVersion` é `1`.
- [ ] manifesto, hooks e código usam o mesmo slug.
- [ ] descrição, versão, entrypoint e requisitos são válidos.
- [ ] ativação e migrações são idempotentes.
- [ ] desativação preserva dados.
- [ ] remoção padrão preserva settings.
- [ ] dependências foram testadas.
- [ ] operações privilegiadas verificam capability e nonce.
- [ ] entrada é sanitizada e saída é escapada.
- [ ] o pacote foi testado como instalação, atualização, desativação,
  reativação e remoção.
