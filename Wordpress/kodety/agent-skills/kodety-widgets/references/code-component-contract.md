# Contrato de Code Components do Onun Kodety

## Anatomia obrigatória

Um arquivo válido exporta uma interface de props, um componente funcional
default e uma definição literal:

```tsx
import React from 'react'
import {
  ControlType,
  defineComponent,
  type CodayComponentProps,
} from '@coday/components'

export interface ProductCardProps extends CodayComponentProps {
  title: string
  featured: boolean
}

export default function ProductCard({
  title,
  featured,
  style,
  className,
}: ProductCardProps) {
  return <article className={className} style={style}>{title}</article>
}

export const componentDefinition = defineComponent({
  id: 'kodety.product-card',
  name: 'ProductCard',
  displayName: 'Product Card',
  description: 'Card de produto configurável.',
  version: '1.0.0',
  component: ProductCard,
  sizing: { width: 'fixed', height: 'hug', defaultWidth: 360, minWidth: 220 },
  controls: {
    title: {
      type: ControlType.String,
      title: 'Título',
      defaultValue: 'Produto',
      bindable: true,
      category: 'Content',
    },
    featured: {
      type: ControlType.Boolean,
      title: 'Destaque',
      defaultValue: false,
      category: 'Content',
    },
  },
})
```

O compiler extrai o manifest do AST sem executar o módulo. `id`, `name`,
`displayName`, `version`, `sizing`, `events` e `controls` devem ser literais
serializáveis. Não produza o schema por função, spread dinâmico ou dado externo.

## Imports e limites

Imports padrão permitidos:

- `react` e `react/jsx-runtime`;
- `react-dom` e subpaths como `react-dom/client`;
- `@coday/components`;
- módulos locais relativos incluídos no projeto.

O bundle final tem limite de 1,5 MB e o hot compiler tem timeout de oito
segundos. Imports dinâmicos precisam usar string literal. Não use Node.js,
`eval`, `new Function`, globals privados do editor, DOM pai, cookies do editor,
CDNs arbitrárias ou APIs internas do Builder.

## Props e manifest

Cada prop configurável precisa existir na interface pública e em `controls`.
Props reservadas não recebem controles: `style`, `className`, `instanceId` e
`breakpoint`. Os defaults devem passar pela validação do tipo e ser JSON.

Categorias disponíveis: `Content`, `Layout`, `Style`, `Typography`, `Effects`,
`Animation`, `Data`, `Events` e `Advanced`. Use `order` apenas quando a ordem
natural do objeto não expressar a hierarquia desejada.

Controles podem declarar:

- `responsive: true` para base e overrides por breakpoint;
- `bindable: true` para dados CMS compatíveis;
- `hidden`, `disabled` e `required` com condições declarativas;
- `title`, `description`, `category` e `order` para uma UI compreensível.

Operadores condicionais: `equals`, `not-equals`, `includes`, `not-includes`,
`greater-than`, `less-than` e `exists`, além de grupos `and`, `or` e `not`.

## Sizing

`width` e `height` aceitam `fixed`, `fill`, `hug` e `intrinsic`.

- `fixed`: o canvas fornece dimensão explícita;
- `fill`: ocupa o eixo disponível;
- `hug` e `intrinsic`: seguem a dimensão medida do conteúdo;
- `aspectRatio` só calcula o eixo em `hug`, nunca dois eixos fixos.

Forneça defaults coerentes, `minWidth`/`minHeight` quando o layout puder
colapsar e estilos internos com `boxSizing: 'border-box'`.

## Estado, efeitos e SSR

Hooks e estado local são permitidos. O primeiro render precisa ser
determinístico e não pode depender de `window`, `document`, `matchMedia`,
storage ou medidas do browser. Faça esse trabalho em `useEffect`, eventos ou
observers e ofereça um estado inicial útil. Limpe timers, listeners, observers,
frames e animações no cleanup.

Use `breakpoint` quando a lógica realmente precisa saber o breakpoint; para
props responsivas, o runtime já entrega o valor resolvido.

## Assets, CMS e slots

Imagens usam `CodayImage`; arquivos usam `CodayFile`; links usam `CodayLink`.
Não persista `File`, Blob URL temporária ou objeto DOM. Imagens precisam de alt
text e devem aceitar dimensões desconhecidas sem quebrar o layout.

Bindings CMS são resolvidos antes do render. O componente recebe o valor final
e não acessa WordPress ou endpoints privados diretamente. Preserve um fallback
estático válido.

Conteúdo composto usa `Slot` ou `Slots`. No runtime a prop pode ser `ReactNode`,
mas a instância persiste somente referências de slot. Preserve IDs e keys
estáveis em arrays e listas.

## Eventos

Declare eventos no manifest e emita payload JSON:

```tsx
emitComponentEvent('checkout', { planId, seats }, instanceId)
```

```ts
events: {
  checkout: {
    title: 'Iniciar checkout',
    payload: { planId: 'string', seats: 'number' },
  },
}
```

O componente emite intenção; o Builder conecta a ação final. Não acople
navegação, mutação CMS ou comportamento do editor dentro do widget.

## Qualidade mínima

- HTML semântico e acessível, foco visível e teclado funcional;
- props e controles com nomes claros e defaults visualmente úteis;
- listas com keys estáveis;
- nenhum efeito apenas para derivar valores renderizáveis;
- motion com alternativa para `prefers-reduced-motion`;
- estados vazio, loading, erro e sucesso quando a natureza do widget exigir;
- layout funcional no menor e no maior breakpoint suportado;
- cleanup e ausência de loops de resize.
