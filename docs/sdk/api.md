# API pública

## `defineComponent(definition)`

Registra e retorna `{ component, manifest }`. Valida defaults, serializa controles, infere capabilities e informa o runtime registry. É a API recomendada.

## `addPropertyControls(component, controls, options?)`

Camada compatível que delega a `defineComponent`. É adequada para componentes pequenos, mas metadata avançada fica mais clara na definição declarativa.

## `emitComponentEvent(name, payload, instanceId?)`

Emite um evento sem conhecer sua ação visual. O editor conecta o evento a navegação, modal, variáveis, funções, formulário, workflow ou variante.

## Adapters

Cada `ControlType` usa `parse`, `validate`, `normalize`, `serialize` e `deserialize`. Tipos novos devem registrar um adapter antes de aparecerem no inspector ou runtime.

## Compatibilidade

A API pública usa semver. Componentes permanecem presos à versão escolhida. Alterações de props exigem uma `ComponentMigration`; alterações de schema global usam `schemaVersion`.
