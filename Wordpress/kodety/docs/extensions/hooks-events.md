# Hooks e events namespaced

Hooks e events locais são sempre transformados em nomes que contêm o slug. A
extensão registra nomes curtos e não concatena prefixes manualmente.

## Hooks

Hooks mantêm a semântica de actions/filters do WordPress.

```php
$hooks = $extension->hooks();

$hooks->on('project/saved', static function (array $project): void {
    // Reage somente ao hook desta extensão.
});

$hooks->emit('project/saved', ['id' => 42]);

$hooks->filter('card/title', static fn(string $title): string => strtoupper($title));
$title = $hooks->apply('card/title', 'Hello');
```

O nome canônico de `project/saved` será:

```text
kodety/extension/{slug}/hook/project/saved
```

`on()` e `filter()` exigem `hooks.listen`; `emit()` e `apply()` exigem
`hooks.emit`. `on()` aceita priority e accepted args como WordPress.

## Events

Events são mensagens locais com um payload e contexto uniformes.

```php
$events = $extension->events();

$events->listen('project.published', static function (mixed $payload, Kodety_Extension_Context $ctx): void {
    // $ctx sempre pertence ao emissor/owner do namespace.
});

$events->dispatch('project.published', ['id' => 42]);
```

O nome canônico é
`kodety/extension/{slug}/event/project.published`. Escutar exige
`events.listen`; disparar exige `events.emit`.

## Regras

- nomes começam com letra minúscula e podem conter letras, números, `.`, `_`,
  `-` e `/`;
- uma extensão não pode usar esses serviços para registrar no namespace de
  outra;
- não use `do_action()` com o nome canônico: isso contorna o contrato e não é
  API pública;
- use hooks para transformação síncrona e events para notificação;
- payloads devem ser pequenos e documentados; passe IDs em vez de objetos
  internos do Onun Kodety;
- um `Throwable` em callback registrado por `on()`, `filter()` ou `listen()` é
  logado com slug/surface e contido; actions/events posteriores continuam;
- filter quebrado preserva o valor que recebeu. Se o dispatcher WordPress
  lançar fora de um wrapper registrado, `apply()` devolve o valor original e
  `emit()`/`dispatch()` encerram o disparo sem derrubar a request;
- falhas esperadas ainda devem ser modeladas em valores de domínio. A contenção
  existe para defeitos inesperados, não como fluxo de controle.

Comunicação entre extensões deve ser feita por uma extensão-base declarada em
`dependencies`, com funções PHP próprias e versionadas. A API v1 não oferece
um barramento global entre slugs para evitar acoplamento acidental.
