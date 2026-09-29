# Data storage isolado

Public Storage é um key/value JSON por slug. As options físicas são internas ao
contrato; use somente o serviço.

```php
$storage = $extension->storage();

$storage->set('settings', ['enabled' => true, 'color' => '#111111']);
$settings = $storage->get('settings', ['enabled' => false]);
$exists = $storage->has('settings');
$all = $storage->all();
$storage->delete('settings');
```

`get`, `has` e `all` exigem `storage.read`. `set`, `delete` e `clear` exigem
`storage.write`. Uma extensão não recebe método para escolher slug ou nome da
option, então a mesma chave em duas extensões permanece separada.

Chaves aceitam letras, números, `_`, `.`, `:`, `-` e até 120 caracteres.
Valores precisam ser compatíveis com JSON: null, boolean, número finito,
string, listas e objetos representados por arrays. Não armazene resources,
closures, objetos WordPress ou instâncias internas.

## Quando usar outra persistência

Public Storage serve para settings, pequenos índices e estado de migration. Para
milhares de registros ou queries relacionais, a extensão pode criar tabelas
WordPress próprias, mas isso fica fora da API v1 e precisa seguir estes limites:

- prefixe todas as tabelas e índices com um identificador derivado do slug;
- use `$wpdb->prepare()` e schema versionado;
- não leia nem escreva tabelas privadas do CMS Onun Kodety;
- não aceite identificadores SQL vindos de request;
- documente backup, upgrade e remoção;
- ofereça exportação quando armazenar conteúdo do usuário.

Media binária pertence à Media Library, não ao key/value storage. Armazene o ID
do attachment.

## Concorrência e tamanho

Cada `set()` atualiza o mapa do slug. Evite read-modify-write concorrente para
contadores de alta frequência e evite blobs grandes. Para esses casos use uma
tabela própria com operação atômica. `set()` retorna `true` inclusive quando o
valor já era idêntico; `false` significa falha de persistência.

