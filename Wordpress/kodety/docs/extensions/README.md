# Onun Kodety Public Extension API v1

A Public Extension API é a fronteira suportada entre o Onun Kodety e código
instalado por ZIP. Ela é independente do CMS nativo: uma extensão não precisa
conhecer classes, options, tabelas ou componentes internos do Builder.

```text
Onun Kodety Core + CMS (privados)
            |
       Extension API v1
            |
   extensão instalada por ZIP
```

O entrypoint recebe temporariamente um `Kodety_Extension_Context` por meio de
`kodety_extension()`. Capture esse objeto nos callbacks. Não construa contextos
manualmente e não solicite o contexto de outro slug.

```php
$extension = kodety_extension();
if (!$extension || $extension->slug() !== 'vendor-feature') return;

$extension->frontend()->shortcode(
    'message',
    static fn(): string => '<p>Olá.</p>'
);
```

## Contrato público

| Superfície | Serviço | Permissões de manifesto |
| --- | --- | --- |
| Hooks locais | `$extension->hooks()` | `hooks.listen`, `hooks.emit` |
| Eventos locais | `$extension->events()` | `events.listen`, `events.emit` |
| Persistência | `$extension->storage()` | `storage.read`, `storage.write` |
| REST | `$extension->routes()` | `routes.register` |
| WP Admin | `$extension->admin()` | `admin.register` |
| Media Library | `$extension->media()` | `media.read`, `media.write` |
| Usuário, capability e nonce | `$extension->auth()` | `auth.read` |
| HTML administrativo básico | `$extension->ui()` | `ui.render` |
| Shortcodes e assets | `$extension->frontend()` | `frontend.read`, `frontend.register` |
| Block types Onun Kodety | `$extension->blocks()` | `blocks.register` |

O serviço frontend também é a entrada pública e segura para os filtros do site
publicado: `register_runtime_context_resolver()` e
`register_runtime_html_transformer()`. Veja [frontend.md](frontend.md).

Também são públicas as funções:

- `kodety_extension()`: contexto durante o entrypoint e durante callbacks
  registrados pelos serviços públicos;
- `kodety_extension_api_version()`: versão instalada da API;
- `kodety_extension_block_types()`: snapshot do registry de block types.

Os hooks de lifecycle descritos em [lifecycle.md](lifecycle.md) são a única
integração direta por actions WordPress recomendada. Nomes como
`kodety/extension-api/...` são sinais internos do runtime e não fazem parte do
contrato de terceiros.

## Falhas do contrato

Uma chamada sem permission lança `Kodety_Extension_Permission_Exception`; uma
capability não declarada lança `Kodety_Extension_Capability_Exception`. Nomes,
caminhos e definitions inválidos lançam `InvalidArgumentException`. São erros
de programação/configuração: corrija o manifesto ou a chamada em vez de
silenciá-los. Falhas operacionais de WordPress retornam `false` ou `WP_Error`
conforme a assinatura documentada (por exemplo, media upload).

Depois de um registro válido, callbacks executados pelos wrappers públicos são
uma fronteira fail-safe. Um `Throwable` inesperado é registrado como
`[Onun Kodety][Extension API][{slug}][{surface}] ...` e recebe o fallback seguro da
superfície: valor anterior para filtros, string vazia para renderização, notice
administrativa ou `WP_Error` 500 genérico em REST. A resposta pública nunca
inclui mensagem, classe ou trace da exception. Erros de REST intencionais devem
ser retornados como `WP_Error`; eles não são reescritos.

Essa contenção de execução não esconde erros de registro nem torna um entrypoint
inválido aceitável. Exceptions lançadas ao declarar uma integração continuam
visíveis ao loader, que reporta a falha de carregamento da extensão.

## Garantias e limites

- storage, hooks, events, rotas, shortcodes, handles, páginas e block types são
  namespaced pelo slug;
- cada operação verifica a permissão declarada no manifesto;
- operações que usam uma capability WordPress também exigem que ela conste em
  `capabilities` e que o usuário atual realmente a possua;
- extensões antigas continuam carregando, mas não recebem permissões públicas
  implicitamente;
- PHP de extensões executa no processo do WordPress. A API reduz acoplamento e
  acidentes, mas não transforma PHP não confiável em sandbox. Revise todo ZIP.

Comece por [getting-started.md](getting-started.md). O exemplo completo está em
[`examples/hello-kodety`](examples/hello-kodety/README.md).

## Documentação

- [Manifesto e permissões](manifest.md)
- [Lifecycle](lifecycle.md)
- [Hooks e events](hooks-events.md)
- [Páginas administrativas](admin.md)
- [Rotas REST](routes.md)
- [Frontend](frontend.md)
- [Storage](storage.md)
- [Media Library](media.md)
- [Autenticação e UI](auth-ui.md)
- [Packaging](packaging.md)
- [Versionamento](versioning.md)
- [Compatibilidade](compatibility.md)
- [Guia para agentes de IA](ai-guide.md)
