# Arquitetura de Code Components

## Responsabilidades

- `@coday/control-schema`: tipos serializáveis, condições, valores responsivos, validação e adapters.
- `@coday/components`: SDK pública `defineComponent`/`addPropertyControls`, manifests, sizing e eventos.
- `@coday/component-compiler`: AST, allowlist, type-check, TS/JSX→ESM, source maps, cache, hash e hot reload.
- `@coday/component-runtime`: resolução de props, CMS, slots, Error Boundary, sizing e render React.
- `@coday/property-inspector`: UI genérica orientada pelo schema, sem regras do componente.
- `@coday/canvas-bridge`: protocolo versionado, medição, rate limit e prevenção de resize loops.
- `@coday/asset-bridge`: contrato independente para selecionar, subir e publicar assets.
- `@coday/cms-bridge`: bindings, compatibilidade de tipos e resolução reativa de dados.
- `@coday/component-registry`: versões imutáveis, instâncias, migrations, rollback e histórico transacional.
- `@coday/component-sandbox`: iframe sandboxed, CSP, módulos Blob e comunicação autenticada.
- `@coday/component-testing`: assertions de contrato e fixtures de assets/CMS.
- `component-playground`: ambiente interativo para autorar e validar componentes.
- `component-docs`: catálogo renderizável da SDK.

## Fluxo

1. O autor exporta um componente React funcional e chama `defineComponent`.
2. O compiler analisa o AST e extrai o manifest sem executar o arquivo.
3. Imports são validados, TypeScript é verificado e ESM é gerado com source map e hash.
4. O registry publica `{bundle, manifest, version}` como uma versão imutável.
5. Uma instância persiste somente JSON, IDs de assets, bindings e referências de slots.
6. O inspector usa os adapters para parsear, validar, normalizar e serializar cada mudança.
7. O runtime resolve responsive values e CMS antes de renderizar dentro do sandbox.
8. Na publicação, bundles são materializados em `.coday/components/` e cada página recebe o bootstrap ESM somente quando contém instâncias.

No hot reload, `ComponentCompiler` transpila o módulo ESM rapidamente no navegador. Na publicação, `NodeComponentCompiler` usa esbuild em worker/serviço, empacota o grafo permitido em um ESM autocontido e aplica cancelamento, timeout e limite final de bytes.

## API principal

`defineComponent` é a API principal porque reúne componente, controles, sizing e eventos em uma declaração atômica que o compiler consegue extrair estaticamente. `addPropertyControls` continua como compatibilidade para código conciso, mas não deve ser preferido em componentes com eventos, capabilities ou versionamento explícito.

## Persistência

Manifests, instâncias e snapshots usam `schemaVersion`. Nenhum React element, closure, função ou referência circular é persistido. Comportamentos não serializáveis usam IDs (`itemTitleAdapter`, `transformId`) registrados em código confiável.

## Prioridade de sizing

1. `fixed` e `fill` obedecem a dimensão fornecida pelo canvas.
2. `hug` e `intrinsic` obedecem a dimensão medida pelo componente.
3. `aspectRatio` calcula somente o eixo em modo `hug`; nunca disputa com dois eixos fixos.
4. Medidas iguais dentro de 0,5 px são ignoradas e mais de 12 mudanças em 250 ms são bloqueadas.
