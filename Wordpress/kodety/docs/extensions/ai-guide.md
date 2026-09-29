# Guia de geração de extensão por IA

Este arquivo é a rota curta para um agente de código produzir um ZIP sem ler o
core do Onun Kodety.

## Procedimento obrigatório

1. Transforme o pedido em modelo de dados, roles/capabilities, superfícies e
   lifecycle.
2. Escolha slug permanente e namespace PHP exclusivo.
3. Leia `manifest.md` e declare somente permissões usadas.
4. Use `kodety_extension()` no entrypoint e capture o contexto.
5. Implemente storage, routes, admin, media, auth, UI, frontend e blocks apenas
   pelos serviços documentados.
   Para o site publicado, use os métodos `register_runtime_context_resolver()`
   e `register_runtime_html_transformer()`, nunca os filtros crus.
6. Use APIs WordPress públicas somente para necessidades não cobertas; nunca
   acesse CMS/Builder internos.
7. Implemente activation idempotente, migration versionada e deactivation
   reversível.
8. Faça threat model de inputs, autorização, CSRF, XSS, upload, SSRF, SQL,
   ownership e dados pessoais.
9. Gere fixtures/testes com dois slugs para provar isolamento.
10. Monte uma árvore limpa, valide JSON/PHP, gere ZIP e checksum.

Para erros REST esperados, retorne `WP_Error` com código/status públicos e
seguros. Não lance exceptions como resposta HTTP: `Throwable` é tratado como
defeito inesperado, vai para o log e vira 500 genérico. Em renderers, assuma que
uma exception produzirá o fallback vazio/notice; registre observabilidade própria
para falhas operacionais que precisem de tratamento pelo usuário.

## Skeleton seguro

```php
<?php

namespace Vendor\Feature;

defined('ABSPATH') || exit;

$extension = \kodety_extension();
if (!$extension || $extension->slug() !== 'vendor-feature') return;

$storage = $extension->storage();

add_action('kodety_extension_activate_vendor-feature', static function () use ($storage): void {
    if (!$storage->has('schema')) $storage->set('schema', 1);
});
```

Não use `Kodety_Extensions::instance()`, reflection, includes do plugin, options
`kodety_*`, endpoints privados ou imports do app principal.

## Saída esperada do agente

- pasta source completa;
- `kodety-extension.json` válido;
- entrypoint e arquivos necessários;
- README com instalação, permissões, dados e remoção;
- testes/lint executados;
- ZIP instalável e SHA-256;
- lista de assumptions e limitações;
- nenhum secret e nenhuma mudança no Onun Kodety core/CMS.

## Revisão antes de entregar

Confirme que cada chamada a serviço possui permissão correspondente e que cada
capability usada consta no manifesto. Procure manualmente por `Kodety_`,
`kodety_` options, `$wpdb` em tabelas alheias, `do_action('kodety/extension/`,
HTML não escapado, `permission => public` e operações destrutivas amplas.
Inclua testes que façam callbacks lançarem `Throwable` e comprovem o fallback,
o log com slug/surface e a ausência da mensagem da exception na resposta.

O exemplo [Hello Onun Kodety](examples/hello-kodety/README.md) demonstra o fluxo
completo mínimo.
