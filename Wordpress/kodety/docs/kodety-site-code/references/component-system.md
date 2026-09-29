# Sistema nativo de componentes reutilizáveis do Onun Kodety

Use este contrato para componentes reutilizáveis com variantes, propriedades,
eventos e instâncias. O formato atual é um bundle autoral privado por
componente: HTML das variantes, uma folha CSS escopada e um manifesto leve.

O bundle evita que a prévia dependa do `<head>` da página onde o componente
nasceu. Ele preserva media queries e referências a assets existentes, sem
duplicar mídia dentro da pasta do componente.

## Escolha do fluxo

### Agent dentro do Builder

Use exclusivamente as ferramentas semânticas do editor:

1. Leia `kodety_editor_context`.
2. Leia `kodety_component_snapshot` com `includeSources` quando HTML ou CSS
   puder mudar; inclua Interactions e instâncias quando relevantes.
3. Aplique uma transação com `kodety_apply_component_changes` e a revisão
   exata que acabou de ler.
4. Leia novamente e confirme definição, bundle, instâncias e nova revisão.

Não edite `.incode/project.json`, `component.json`, `component.css`, masters,
atributos internos nem overrides codificados manualmente neste fluxo. O
Builder cria, escopa, rebasa e sincroniza esses artefatos.

### Pasta ou ZIP portátil

Ao gerar um projeto fora do Builder, escreva o contrato completo abaixo,
execute o validador da skill e importe o ZIP. Use IDs estáveis e
determinísticos dentro do projeto.

## Estrutura de arquivos

```text
assets/
└── rubrika.svg                         # asset compartilhado normal do projeto
.incode/
├── project.json
├── components/
│   └── component-footer/
│       ├── component.json              # manifesto do bundle
│       ├── component.css               # CSS escopado e responsivo
│       ├── variant-home.html
│       └── variant-compact.html
└── animations/
    ├── .incode%2Fcomponents%2Fcomponent-footer%2Fvariant-home.html.json
    └── .incode%2Fcomponents%2Fcomponent-footer%2Fvariant-compact.html.json
```

Não crie `.incode/components/<id>/assets/`. Uma imagem como `rubrika.svg`
continua existindo uma única vez em `assets/rubrika.svg`; HTML e CSS do bundle
usam uma URL relativa normal e o manifesto apenas registra a dependência.

O documento de Interactions usa percent-encoding RFC 3986 do caminho HTML
completo e recebe `.json`:

```js
const interactionPath = `.incode/animations/${encodeURIComponent(htmlPath)
  .replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )}.json`;
```

## Biblioteca em `.incode/project.json`

Adicione `components` sem remover os demais metadados:

```json
{
  "version": 1,
  "mainHtmlPath": "index.html",
  "components": {
    "version": 1,
    "components": [
      {
        "id": "component-footer",
        "name": "Footer",
        "bundle": {
          "version": 1,
          "manifestFilePath": ".incode/components/component-footer/component.json",
          "styleFilePath": ".incode/components/component-footer/component.css"
        },
        "variants": [
          {
            "id": "variant-home",
            "name": "Home",
            "filePath": ".incode/components/component-footer/variant-home.html"
          },
          {
            "id": "variant-compact",
            "name": "Compact",
            "filePath": ".incode/components/component-footer/variant-compact.html"
          }
        ],
        "variables": [],
        "createdAt": "2026-08-17T00:00:00.000Z",
        "updatedAt": "2026-08-17T00:00:00.000Z"
      }
    ]
  }
}
```

Regras:

- `components.version` e `bundle.version` são `1`.
- IDs de componente, variante, variável, node e instância aceitam somente
  letras, números, `_` e `-`, com 1 a 160 caracteres.
- Cada componente mantém ao menos uma variante; a primeira é a primária.
- `manifestFilePath`, `styleFilePath` e todo `variant.filePath` ficam dentro de
  `.incode/components/<component-id>/`.
- Em projeto portátil novo, omita `overrides` e `inheritanceVersion`. O Builder
  calcula herança por layer no primeiro ciclo nativo de edição.
- A ausência de `bundle` indica formato legado. O Builder pode lê-lo e o
  migra, sem alterar o visual, ao editar ou inserir esse componente.

## Manifesto `component.json`

```json
{
  "version": 1,
  "componentId": "component-footer",
  "styleFilePath": ".incode/components/component-footer/component.css",
  "variants": [
    {
      "id": "variant-home",
      "filePath": ".incode/components/component-footer/variant-home.html"
    },
    {
      "id": "variant-compact",
      "filePath": ".incode/components/component-footer/variant-compact.html"
    }
  ],
  "dependencies": {
    "stylesheets": ["css/components.css"],
    "externalStylesheets": [],
    "projectFiles": ["assets/rubrika.svg"],
    "externalUrls": []
  }
}
```

- `variants` espelha a ordem e os caminhos de `.incode/project.json`.
- `stylesheets` registra folhas locais consultadas durante a extração.
- `externalStylesheets` mantém URLs remotas necessárias, sem copiar seu
  conteúdo.
- `projectFiles` aponta para arquivos que já existem no projeto. É um índice
  de dependências, não uma lista de cópias.
- `externalUrls` registra outras URLs remotas preservadas no HTML ou CSS.
- O Builder sincroniza esse arquivo quando variante, HTML, CSS ou asset muda.

## Documento HTML de uma variante

Cada master é um HTML completo, pequeno, com exatamente uma raiz no `body`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Footer</title>
    <link
      rel="stylesheet"
      href="component.css"
      data-kodety-component-style
    >
  </head>
  <body
    data-kodety-component-editor="component-footer"
    data-kodety-component-variant-editor="variant-home"
    style="min-height:0;margin:0"
  >
    <footer
      class="site-footer"
      data-label="Footer"
      data-kodety-component-node="footer-root"
      data-kodety-component-scope="component-footer"
    >
      <img
        class="site-footer__brand"
        src="../../../assets/rubrika.svg"
        alt="Rubrika"
        data-kodety-component-node="footer-brand"
      >
      <p data-kodety-component-node="footer-email">hey@rubrika.com</p>
    </footer>
  </body>
</html>
```

- Não copie o `<head>` inteiro da página de origem e não use `<base>` em um
  master com bundle.
- O link marcado por `data-kodety-component-style` aponta para o CSS próprio.
- A raiz mantém `data-kodety-component-scope="<component-id>"` no master, nas
  instâncias e também após detach, para que o visual continue preservado.
- Marque a raiz e descendentes editáveis com
  `data-kodety-component-node` único e estável.
- Preserve o mesmo node ID para a mesma layer entre variantes.
- Caminhos locais são relativos ao arquivo onde aparecem. O exemplo sobe do
  master até o asset compartilhado; ele não cria outro `rubrika.svg`.
- Mantenha HTML semântico, acessível e visível sem JavaScript.

## CSS próprio, escopado e responsivo

`component.css` contém somente regras necessárias ao componente e suas
dependências CSS seguras. Todo seletor autoral deve ficar sob o escopo do
componente; media queries continuam intactas:

```css
/* Onun Kodety component: Footer */
[data-kodety-component-scope="component-footer"] {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2rem;
  background: #6b1014;
}

[data-kodety-component-scope="component-footer"] .site-footer__brand {
  width: min(42vw, 52rem);
}

@media (max-width: 991px) {
  [data-kodety-component-scope="component-footer"] {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}

@media (max-width: 767px) {
  [data-kodety-component-scope="component-footer"] .site-footer__brand {
    width: 100%;
  }
}
```

Ao converter uma seleção, o Builder extrai das folhas da página as regras
relevantes, preserva `@media`, `@supports`, fontes, variáveis e keyframes
necessários, escopa os seletores e rebasa `url(...)`. O modo Inline → CSS Rule
edita esse mesmo `component.css` quando o master está aberto.

## Prévia, canvas e publicação

- O card no painel Insert recebe um `srcdoc` leve com o HTML da variante,
  `component.css` e somente as dependências necessárias. Assets locais são
  transformados em data URLs apenas em memória para a prévia.
- O canvas de Design/Preview liga temporariamente a folha privada do bundle à
  página materializada.
- Na publicação/exportação, o CSS escopado necessário é inserido na página e
  suas URLs são rebaseadas para a página pública. Nenhuma página publicada
  depende de uma URL sob `.incode/`.
- A mesma folha é usada nas três rotas; por isso desktop, tablet e mobile não
  divergem entre master, prévia e página.

## Variáveis editáveis

Tipos aceitos:

`text`, `rich_text`, `number`, `image`, `link`, `audio`, `video`, `icon` e
`variant`.

```json
{
  "variables": [
    {
      "id": "footer-email-variable",
      "name": "Email",
      "type": "text",
      "bindings": [
        { "targetNodeId": "footer-email", "attribute": "" }
      ],
      "targetNodeId": "footer-email",
      "attribute": "",
      "defaultValue": "hey@rubrika.com"
    },
    {
      "id": "footer-brand-variable",
      "name": "Brand",
      "type": "image",
      "bindings": [
        { "targetNodeId": "footer-brand", "attribute": "src" }
      ],
      "targetNodeId": "footer-brand",
      "attribute": "src",
      "defaultValue": "../../../assets/rubrika.svg"
    },
    {
      "id": "footer-state-variable",
      "name": "State",
      "type": "variant",
      "bindings": [],
      "targetNodeId": "",
      "attribute": "",
      "defaultValue": "variant-home"
    }
  ]
}
```

Uma variável pode ter vários bindings. Os campos singulares repetem o primeiro
binding para compatibilidade. Uma variável `variant` não tem binding DOM e seu
default deve ser um variant ID válido. Valores de asset obtidos no snapshot
devem ser preservados; o runtime os rebasa para cada página.

## Instâncias em páginas

Uma instância materializa a variante completa e marca somente sua raiz:

```html
<footer
  class="site-footer"
  data-label="Footer"
  data-kodety-component-node="footer-root"
  data-kodety-component-scope="component-footer"
  data-kodety-component-id="component-footer"
  data-kodety-component-variant="variant-home"
  data-kodety-component-state-variant="variant-home"
  data-kodety-component-instance="footer-instance-home-1"
>
  <!-- conteúdo real da variante -->
</footer>
```

- `data-kodety-component-id` aponta para a definição.
- `data-kodety-component-variant` guarda a variante-base.
- `data-kodety-component-state-variant` guarda o estado renderizado.
- `data-kodety-component-instance` é único na página.
- `data-kodety-component-overrides` é opcional; omita quando usar defaults.
- Não coloque atributos de instância nos descendentes.

Overrides são um objeto `{ "variable-id": "valor" }` serializado como JSON
UTF-8 em base64url sem padding. No Agent, nunca codifique isso manualmente:
envie o mapa normal na operação semântica.

## Eventos e troca de variante

Salve eventos no documento Interactions v2 da variante. Triggers nativos:
`click`, `click-start`, `appear`, `mouse-enter` e `mouse-leave`.

Uma troca de estado usa uma action `component-variant` com `componentId` e
`componentVariantId` válidos. O runtime compila eventos de todas as variantes
por instância e limita listeners ao estado visível. Não duplique o evento em
JavaScript autoral.

## Operações do Agent

`kodety_apply_component_changes` aceita:

| Operação | Uso |
|---|---|
| `createComponent` | Converter `pagePath` + `selectionPath`, ou criar de um root `html` |
| `insertComponentInstance` | Inserir uma definição existente em uma página |
| `upsertComponentVariant` | Criar sem `variantId`; editar com `variantId` |
| `updateComponent` | Renomear, substituir variáveis e/ou o CSS completo |
| `updateComponentInstance` | Trocar variante-base ou overrides da instância |
| `reorderComponentVariants` | Reordenar todas as variantes e escolher a primária |
| `detachComponentInstance` | Converter uma instância em HTML comum preservando visual |
| `deleteComponentVariant` | Excluir variante secundária |
| `deleteComponent` | Excluir definição e preservar instâncias como HTML |

Regras específicas do bundle:

- Ao converter uma seleção, normalmente omita `css`; o Builder extrai o CSS e
  os breakpoints atuais automaticamente.
- Para criar um componente somente na biblioteca, envie um único root em
  `html` e, quando necessário, `css` com as regras autorais. O Builder escopa e
  grava a folha; não envie um documento HTML completo.
- `kodety_component_snapshot` com `includeSources` retorna os caminhos do
  bundle, o CSS e o manifesto. Leia esses valores antes de editar.
- Em `updateComponent`, `css` substitui a folha completa. Preserve regras e
  media queries não relacionadas à solicitação.
- Não crie `assets/` no bundle e não reescreva uma URL compartilhada para uma
  cópia privada.
- Preserve node IDs nas layers que continuam existindo.
- Envie o documento Interactions completo ao alterar eventos.
- Use a revisão retornada e leia novamente antes da próxima transação.

## Checklist

- [ ] Biblioteca e bundle estão na versão `1`.
- [ ] Cada componente tem `component.json`, `component.css` e ao menos um master.
- [ ] Manifesto espelha variantes e aponta apenas para dependências existentes.
- [ ] Nenhum asset foi copiado para dentro da pasta do componente.
- [ ] A raiz do master e das instâncias mantém `data-kodety-component-scope`.
- [ ] CSS está escopado e preserva regras desktop, tablet e mobile.
- [ ] Nodes possuem IDs estáveis e sem duplicatas.
- [ ] Bindings apontam para nodes reais.
- [ ] Instâncias e overrides apontam para IDs existentes.
- [ ] Eventos usam Interactions v2 e `component-variant` quando aplicável.
- [ ] A prévia, o canvas e a publicação foram verificados nos breakpoints.
- [ ] O projeto passou no validador da skill.
