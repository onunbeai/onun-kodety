# Compatibilidade e fronteira pública

## Pode usar

- `kodety_extension()` e o `Kodety_Extension_Context` retornado;
- serviços documentados neste diretório;
- `kodety_extension_api_version()` e
  `kodety_extension_block_types()`;
- wrappers `register_runtime_context_resolver()` e
  `register_runtime_html_transformer()` para o runtime publicado;
- hooks de lifecycle listados em [lifecycle.md](lifecycle.md);
- APIs públicas do WordPress, respeitando security e ownership.

## Não pode depender

- `Kodety_Plugin`, `Kodety_Extensions` ou outros managers internos;
- classes, functions, options, tabelas e endpoints do CMS nativo;
- React components, Zustand stores, bundles, CSS selectors ou assets internos;
- estrutura de pastas do workspace publicado;
- actions/filters não documentados;
- options físicas usadas pela Public Storage ou registry;
- ordem de inicialização além do lifecycle documentado.

“Public” em uma declaração PHP não transforma automaticamente um símbolo em API
pública. Somente itens documentados aqui recebem compromisso de compatibilidade.
Em particular, não use `add_filter('kodety_runtime_context', ...)` nem
`add_filter('kodety_runtime_html', ...)` diretamente; os wrappers públicos
garantem contexto, validação e fallback.

## Trust boundary e contenção de falhas

A contenção fail-safe cobre callbacks que a extensão entrega aos serviços
públicos: hooks/events, admin, routes e permissions callables, runtime frontend,
shortcodes e render de block types. O core registra a falha com slug/surface e
aplica o fallback documentado sem expor exception na resposta ou no HTML.

Ela não cobre callbacks que a extensão registra diretamente em APIs WordPress,
includes executados fora do entrypoint gerenciado, processos externos nem código
arbitrário chamado pela própria extensão. PHP continua no mesmo processo: a API
não é isolamento de memória, filesystem, rede ou banco. Também não silencia
erros de manifesto/registro; esses precisam impedir um carregamento incorreto.

REST mantém sua semântica normal: arrays, `WP_REST_Response`, `WP_Error` e
negações esperadas são retornados intactos. Somente `Throwable` inesperado é
convertido em `WP_Error` 500 genérico.

## Matriz v1

| Requisito | Mínimo do contrato |
| --- | --- |
| PHP | 8.0 |
| Manifest schema | 1 |
| Extension API | 1.0.0 |
| WordPress | o mínimo declarado pelo release do Onun Kodety instalado |

O instalador compara os mínimos de PHP, Onun Kodety e Extension API antes de mover o
pacote. Requisitos inválidos e API futura produzem `WP_Error` e não executam o
entrypoint.

## Progressive enhancement

Para recurso adicionado em uma minor da API:

1. aumente `requires.extensionApi` se o recurso for obrigatório; ou
2. verifique `version_compare(kodety_extension_api_version(), '1.x.0', '>=')`
   e ofereça fallback.

Não use `method_exists` em classes internas como negociação de versão.

## Testes recomendados

Teste ao menos instalação limpa, upgrade, ativação repetida, desativação,
permissão negada, dois slugs com a mesma chave/evento, usuário sem capability,
REST público versus privado, WordPress multisite quando suportado e storage
privado para assets. Garanta que nenhum teste precise alterar o CMS nativo.
