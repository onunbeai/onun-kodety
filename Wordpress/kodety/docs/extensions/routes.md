# Rotas REST

Todas as rotas usam o namespace
`kodety/extensions/v1/{extension-slug}`. A extensão fornece apenas o trecho
final.

```php
$extension->routes()->register('projects/(?P<id>\d+)', [
    'methods' => 'GET',
    'permission' => ['capability' => 'manage_options'],
    'args' => [
        'id' => [
            'type' => 'integer',
            'required' => true,
            'sanitize_callback' => 'absint',
        ],
    ],
    'callback' => static function (WP_REST_Request $request, Kodety_Extension_Context $extension): array {
        return ['id' => (int) $request['id']];
    },
]);
```

Manifesto:

```json
{
  "permissions": ["routes.register"],
  "capabilities": ["manage_options"]
}
```

## Permission obrigatória

Toda rota precisa declarar `permission`:

- `"public"`: leitura realmente pública; use apenas para dados publicados;
- `"authenticated"`: exige sessão WordPress, sem escolher role;
- `{"capability":"manage_options"}`: exige capability declarada e presente;
- callable: política customizada que recebe request e contexto.

Omitir `permission` é erro de registro. Para mutations, prefira capability
específica, nonce REST do WordPress e validação completa de argumentos. Nunca
use `public` apenas para facilitar desenvolvimento.

`register()` retorna o caminho namespaced, por exemplo
`kodety/extensions/v1/vendor-feature/projects`. Use `rest_url()` quando precisar
de uma URL absoluta.

## Respostas e erros

Callbacks podem retornar arrays, `WP_REST_Response` ou `WP_Error`. Use códigos
estáveis prefixados pelo slug, status HTTP corretos e mensagens que não exponham
filesystem, SQL ou stack traces.

Esses retornos são preservados pela API, inclusive `WP_Error` retornado por uma
permission callable. Portanto, represente negação e erros operacionais esperados
retornando `WP_Error` com status apropriado; não lance exception para eles.

Se o callback da rota ou uma permission callable lançar um `Throwable`
inesperado, a API registra os detalhes no log com slug e `route.callback` ou
`route.permission`, e responde somente com o código
`kodety_extension_callback_failed`, mensagem genérica e status 500. Classe,
mensagem e trace da exception não são enviados ao cliente.

Operações devem ser idempotentes quando apropriado. Valide tipos em `args`,
normalize IDs com `absint`, limite paginação e nunca aceite nomes arbitrários de
options, tabelas ou callbacks vindos do cliente.
