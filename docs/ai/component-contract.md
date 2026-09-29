# Contrato de componente para IA

Um arquivo válido contém imports permitidos, interface de props, componente default funcional e `componentDefinition` literal. O compiler precisa extrair controles sem executar o módulo; portanto `name`, `id`, `version`, `sizing`, `events` e `controls` devem ser literais serializáveis.

```tsx
export const componentDefinition = defineComponent({
  id: "namespace.component",
  name: "ComponentName",
  version: "1.0.0",
  component: ComponentName,
  sizing: { width: "fixed", height: "hug", defaultWidth: 320 },
  controls: {},
})
```

Props reservadas: `style`, `className`, `instanceId` e `breakpoint`. O runtime fornece slots como ReactNode, props responsivas já resolvidas e dados CMS já normalizados. Assets devem usar `CodayImage`/`CodayFile`. Eventos recebem payload JSON.

Uma definição não pode depender da execução do componente para descobrir metadata. Valores persistidos são JSON; migrations convertem versões antigas antes do render.
