# Começando

Crie um arquivo `.tsx`, exporte uma função React e uma definição:

```tsx
import { ControlType, defineComponent, type CodayComponentProps } from "@coday/components"

interface BadgeProps extends CodayComponentProps {
  label: string
  active: boolean
}

export default function Badge({ label, active, style }: BadgeProps) {
  return <span style={{ ...style, opacity: active ? 1 : 0.45 }}>{label}</span>
}

export const componentDefinition = defineComponent({
  id: "acme.badge",
  name: "Badge",
  version: "1.0.0",
  component: Badge,
  sizing: { width: "hug", height: "hug" },
  controls: {
    label: { type: ControlType.String, defaultValue: "Badge", bindable: true },
    active: { type: ControlType.Boolean, defaultValue: true },
  },
})
```

Cada prop configurável precisa de controle e default válido. O componente recebe o valor responsivo já resolvido. Use o breakpoint avançado presente em `CodayComponentProps` apenas quando o render realmente precisar conhecê-lo.
