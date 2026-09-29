# Operações nativas de Code Components

Use somente estas operações para Code Components React/TSX no Canvas. O
Builder valida a revisão e aplica cada lote de forma atômica.

## Leitura

Chame `kodety_code_component_snapshot` antes de qualquer mudança.

- `sourcePaths`: caminhos exatos cujas fontes completas devem ser retornadas.
- `componentIds`: IDs usados para filtrar versões publicadas.
- `includeInstances`: inclui props, responsividade, bindings, slots e sizing;
  o padrão é `true`.

A resposta contém `revision`, `sources`, `components` e `instances`. O catálogo
de componentes expõe o manifest, nunca exige leitura do bundle compilado.

## Escrita

`kodety_apply_code_component_changes` recebe `expectedRevision`, `summary` e
`changes`. Use lotes pequenos. A criação da fonte e a inserção normalmente são
duas transações, com uma nova leitura entre elas.

### `upsertSource`

Cria ou substitui uma fonte completa e a compila imediatamente.

```json
{
  "type": "upsertSource",
  "filePath": "code-components/PricingCalculator.tsx",
  "source": "arquivo TSX completo"
}
```

O caminho deve estar em `code-components/` ou `components/`. Aceita `.tsx`,
`.ts`, `.jsx` e `.js`. Falhas de parser, tipos, manifest, allowlist, tamanho ou
timeout abortam a transação e retornam diagnósticos.

### `insertInstance`

Insere uma versão já compilada em uma página.

```json
{
  "type": "insertInstance",
  "componentId": "kodety.pricing-calculator",
  "componentVersion": "1.0.0",
  "pagePath": "index.html",
  "selectionPath": "0/1",
  "placement": "after",
  "props": { "plan": "pro", "seats": 8 },
  "sizing": { "widthMode": "fill", "heightMode": "hug" }
}
```

`placement` aceita `before`, `after` ou `inside`. Ao omitir a versão, a versão
mais recente registrada é usada. As props começam nos defaults do manifest e
o patch informado é validado pelo adapter de cada controle. A resposta devolve
`instanceId`, `pagePath` e `selectionPath`.

### `updateInstance`

Configura uma instância existente. Os objetos informados substituem somente as
respectivas chaves de alto nível; omita áreas que não devem mudar.

```json
{
  "type": "updateInstance",
  "instanceId": "id retornado pelo Builder",
  "props": { "accent": "#6d5dfc", "seats": 12 },
  "responsiveProps": {
    "columns": { "base": 3, "overrides": { "tablet": 2, "mobile": 1 } }
  },
  "bindings": {
    "title": {
      "type": "current-collection",
      "sourceId": "products",
      "fieldId": "name",
      "fallback": "Plano Pro"
    }
  },
  "sizing": { "widthMode": "fill", "heightMode": "hug" }
}
```

Para atualizar a versão, forneça `componentVersion`. Confira compatibilidade de
props antes; não existe migração implícita no Agent.

Bindings aceitos pelo registry: `current-collection`, `specific-item`,
`collection-query`, `global-variable`, `url-parameter`, `authenticated-user` e
`server-function`. Use somente IDs descobertos no projeto e preserve fallback.

Slots usam referências serializáveis `{ instanceId, layerId, componentId? }`.
Crie ou altere slots somente quando esses IDs vierem de uma leitura confirmada.

### Remoção

`removeInstance` e `removeSource` são destrutivos. Use-os somente após pedido
explícito e envie `confirmDestructive: true` no nível da chamada. Remover uma
fonte não deve ser usado para tentar apagar versões ou instâncias do registry.

## Verificação

Depois de cada escrita:

1. leia novamente com a revisão devolvida;
2. confirme manifest, versão, controles e instância;
3. para inserção, use o `selectionPath` retornado com `kodety_focus_element`;
4. teste pelo menos um controle no Inspector e uma interação real no canvas ou
   Preview;
5. se houver erro de runtime, diferencie-o de erro do compiler e corrija a
   fonte completa em uma nova revisão.
