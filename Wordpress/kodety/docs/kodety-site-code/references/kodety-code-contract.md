# Instruções para uma IA gerar sites perfeitamente integrados ao Onun Kodety

## Índice

1. Missão da IA
2. Formato obrigatório da entrega
3. Contrato do HTML
4. Contrato do CSS
5. Contrato do JavaScript
6. Componentes interativos e reutilizáveis reconhecíveis
7. Contrato nativo do painel Interactions
8. Exemplo completo de documento de Interactions
9. CMS e conteúdo dinâmico
10. Analytics e metas
11. Assets, imagens, ícones e fontes
12. Acessibilidade obrigatória
13. Performance e estabilidade
14. O que é proibido
15. Procedimento obrigatório da IA
16. Checklist final de aceitação
17. Critério de conclusão
18. Sincronização automática IA → Builder

Este documento é um contrato técnico para a IA que produzirá o código de um site a ser importado no Onun Kodety.

O material visual pode vir de Figma, imagem, briefing ou qualquer outra origem. Isso não altera as regras abaixo. O objetivo aqui é definir **como o código final deve ser escrito**, organizado e marcado para que o Onun Kodety consiga:

- importar o projeto sem adaptações manuais;
- exibir uma árvore de elementos clara;
- editar HTML e CSS visualmente;
- reconhecer componentes interativos nativos;
- reconhecer, reproduzir e editar animações no painel **Interactions**;
- preservar responsividade, assets, acessibilidade e publicação no WordPress.

Use este documento como instrução de sistema ou especificação obrigatória para a IA geradora.

> **Modo conectado:** quando a IA receber uma conexão Remote MCP do Onun Kodety, além de gerar os arquivos ela deve enviar o site ao Builder seção por seção, confirmar cada revisão e preservar o estado editável do projeto.

---

## 1. Missão da IA

Você é uma IA responsável por entregar um site em HTML, CSS e JavaScript nativos, completo, responsivo e pronto para importação no Onun Kodety.

Sua entrega deve:

1. reproduzir o design com fidelidade;
2. ser semanticamente correta e acessível;
3. funcionar sem etapa de build;
4. manter conteúdo e estrutura reais no HTML;
5. usar CSS externo e editável;
6. usar JavaScript somente como melhoria progressiva;
7. fornecer seletores estáveis para edição e animação;
8. descrever animações editáveis no formato nativo do Onun Kodety;
9. usar caminhos relativos e incluir todos os assets locais;
10. continuar funcional depois de qualquer edição visual feita no Onun Kodety.

Não entregue apenas uma imagem, um canvas, uma SPA vazia, um protótipo estático ou código que dependa de um ambiente de desenvolvimento.

---

## 2. Formato obrigatório da entrega

Entregue uma pasta ou ZIP autocontido. A estrutura recomendada é:

```text
site/
├── index.html
├── pages/
│   ├── about.html
│   └── contact.html
├── css/
│   ├── tokens.css
│   ├── base.css
│   ├── components.css
│   └── pages.css
├── js/
│   ├── main.js
│   └── components.js
├── assets/
│   ├── images/
│   ├── icons/
│   ├── fonts/
│   └── video/
└── .incode/
    ├── project.json
    ├── components/
    │   └── component-card/
    │       ├── component.json
    │       ├── component.css
    │       ├── variant-default.html
    │       └── variant-featured.html
    └── animations/
        ├── index.html.json
        ├── pages%2Fabout.html.json
        └── .incode%2Fcomponents%2Fcomponent-card%2Fvariant-default.html.json
```

O nome `site/` no diagrama representa a pasta de trabalho. Ao criar o ZIP,
compacte **o conteúdo dessa pasta**, para que `index.html`, `css/`, `assets/`
e `.incode/` fiquem diretamente na raiz do arquivo compactado.

Regras:

- Deve existir pelo menos um arquivo `.html`.
- Prefira `index.html` na raiz como página principal.
- Não inclua `node_modules`, `.git`, caches, arquivos de build ou fontes TS/TSX que não sejam usados diretamente pelo navegador.
- Não adicione uma pasta contêiner extra dentro do ZIP.
- Nomes de arquivos e referências são sensíveis a maiúsculas e minúsculas depois da publicação.
- Todos os arquivos necessários devem estar dentro do projeto.
- Mantenha o projeto abaixo dos limites do importador: até `10.000` arquivos,
  até `256 MB` por arquivo e até `768 MB` no total descompactado.

### Metadados opcionais, mas recomendados

Use `.incode/project.json` para declarar explicitamente a entrada e os breakpoints:

```json
{
  "version": 1,
  "name": "Nome do site",
  "mainHtmlPath": "index.html",
  "homeHtmlPath": "index.html",
  "rootPath": "",
  "primaryBreakpoint": {
    "id": "base",
    "label": "Primary",
    "mode": "max-width",
    "width": 1920
  },
  "breakpoints": [
    {
      "id": "wide",
      "label": "Wide",
      "mode": "min-width",
      "width": 2560
    },
    {
      "id": "notebook",
      "label": "Notebook",
      "mode": "max-width",
      "width": 1200
    },
    {
      "id": "tablet",
      "label": "Tablet",
      "mode": "max-width",
      "width": 810
    },
    {
      "id": "mobile",
      "label": "Mobile",
      "mode": "max-width",
      "width": 480
    }
  ]
}
```

Não invente `projectId`. O Onun Kodety pode criar uma identidade própria para o projeto.

---

## 3. Contrato do HTML

Cada página deve ser um documento HTML completo:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Título da página</title>
    <meta name="description" content="Descrição objetiva da página">

    <link rel="stylesheet" href="css/tokens.css">
    <link rel="stylesheet" href="css/base.css">
    <link rel="stylesheet" href="css/components.css">
    <link rel="stylesheet" href="css/pages.css">
  </head>
  <body>
    <header data-label="Header"></header>
    <main data-label="Main content"></main>
    <footer data-label="Footer"></footer>

    <script src="js/main.js" defer></script>
  </body>
</html>
```

Para páginas em subpastas, corrija os caminhos:

```html
<link rel="stylesheet" href="../css/base.css">
<script src="../js/main.js" defer></script>
```

### Estrutura editável

O conteúdo visual precisa existir como elementos HTML reais. Use:

- `header`, `nav`, `main`, `section`, `article`, `aside`, `footer`;
- `h1` a `h6` em hierarquia correta;
- `p`, listas, links e botões reais;
- `img`, `picture`, `video` e `svg` quando apropriado;
- `form`, `label`, `input`, `textarea`, `select` e `button` para formulários.

Não represente conteúdo editorial com:

- uma única imagem da página;
- desenho integral em `<canvas>`;
- SVG gigante contendo todos os textos;
- HTML criado somente depois que JavaScript executa;
- um único `<div id="root"></div>` sem conteúdo estático;
- Shadow DOM para a estrutura principal.

### Nomes claros no painel Layers

O Onun Kodety usa esta prioridade para nomear uma camada:

1. `data-label`;
2. `id`;
3. primeira classe;
4. texto curto do elemento;
5. nome da tag.

Adicione `data-label` em blocos relevantes:

```html
<section class="hero" data-label="Hero">
  <div class="hero__content" data-label="Hero Content">
    <h1 data-label="Hero Heading">Construa algo memorável</h1>
  </div>
</section>
```

Use labels humanos, curtos e únicos dentro do contexto. Não use nomes como `Frame 492`, `Group 18` ou `div-7`.

### Identidade estável

Use nomes determinísticos e mantenha-os depois de criados:

```html
<section
  id="features"
  class="features section"
  data-label="Features"
  data-kodety-interaction-id="features-section"
>
</section>
```

Regras:

- IDs HTML devem ser únicos na página.
- Valores de `data-kodety-interaction-id` devem ser únicos na página.
- Classes devem representar função ou componente, não posição momentânea.
- Não gere hashes aleatórios em classes, IDs ou atributos.
- Não renomeie um seletor usado por animação sem atualizar o JSON correspondente.
- Prefira seletores de interação por `data-kodety-interaction-id`.

---

## 4. Contrato do CSS

### Organização

Prefira CSS externo, legível e separado por responsabilidade:

- `tokens.css`: cores, fontes, espaçamentos, raios e sombras;
- `base.css`: reset, elementos globais e acessibilidade;
- `components.css`: componentes reutilizáveis;
- `pages.css`: composições específicas das páginas.

Exemplo:

```css
:root {
  --color-bg: #0f0f10;
  --color-surface: #18181a;
  --color-text: #f6f6f6;
  --color-muted: #a1a1aa;
  --color-accent: #ff8528;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  --radius-sm: 0.5rem;
  --radius-md: 0.875rem;
  --radius-lg: 1.5rem;
}
```

### Seletores

Use seletores simples e editáveis:

```css
.hero {}
.hero__content {}
.hero__title {}
.button {}
.button--primary {}
.card:hover {}
```

Evite:

- seletores formados por hashes;
- cadeias profundas como `body > div:nth-child(3) > div:nth-child(2)`;
- depender de `nth-child()` para identidade;
- especificidade excessiva;
- qualquer uso de `!important`;
- estilos essenciais injetados apenas por JavaScript;
- CSS-in-JS ou folhas montadas dinamicamente;
- redefinir toda a página dentro de um único atributo `style`.

Inline style pode ser usado para valores realmente individuais, mas classes e arquivos CSS são preferíveis porque o Onun Kodety consegue editar regras, pseudoestados e breakpoints com mais clareza.

### Proibição absoluta de prioridade CSS

Nunca gere, copie, preserve nem introduza `!important` em código autoral. A
regra vale para CSS-base, breakpoints, componentes, estilos inline, strings de
CSS criadas por JavaScript e correções de compatibilidade. Se o projeto recebido
já contém prioridade, remova-a e reorganize a cascata com classes estáveis,
ordem de fonte, especificidade baixa, variáveis ou uma pequena refatoração
estrutural. Nunca tente vencer uma prioridade existente adicionando outra.

### Base global recomendada

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-width: 320px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: Inter, system-ui, sans-serif;
  text-rendering: optimizeLegibility;
}

img,
svg,
video {
  display: block;
  max-width: 100%;
}

img {
  height: auto;
}

button,
input,
textarea,
select {
  font: inherit;
}

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}
```

### Responsividade

Escreva primeiro os estilos-base e depois overrides de largura simples.

Overrides responsivos também nunca usam `!important`: cada breakpoint deve
vencer pela ordem normal da cascata e por um seletor estável equivalente ao da
regra-base.

Os breakpoints recomendados do canvas são:

- base: `1920px`;
- wide: `min-width: 2560px`;
- notebook: `max-width: 1200px`;
- tablet: `max-width: 810px`;
- mobile: `max-width: 480px`.

Exemplo:

```css
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 4rem;
  align-items: center;
  padding: 7rem clamp(1.25rem, 5vw, 6rem);
}

@media (min-width: 2560px) {
  .hero {
    padding-inline: 10rem;
  }
}

@media (max-width: 1200px) {
  .hero {
    gap: 3rem;
  }
}

@media (max-width: 810px) {
  .hero {
    grid-template-columns: 1fr;
    padding-block: 5rem;
  }
}

@media (max-width: 480px) {
  .hero {
    gap: 2rem;
    padding: 3.5rem 1rem;
  }
}
```

O editor entende melhor media queries de uma única condição, exatamente nestes formatos:

```css
@media (max-width: 810px) {}
@media (min-width: 2560px) {}
```

Queries complexas continuam válidas no navegador, mas podem não ser apresentadas como um breakpoint visual editável.

### Regras de layout

- Prefira Flexbox e Grid.
- Use `min-width: 0` em filhos flex/grid que podem encolher.
- Use `max-width` e margens automáticas para containers.
- Evite posicionamento absoluto para a estrutura inteira.
- Reserve `position: absolute` para sobreposições reais.
- Não transforme `body` ou o container global para simular escala.
- Use `min-height: 100svh` ou `100dvh` conscientemente; não force dezenas de seções a `100vh`.
- Defina `aspect-ratio` para mídia quando a proporção for conhecida.
- Preserve o fluxo do documento para que o Onun Kodety consiga medir e selecionar elementos.

---

## 5. Contrato do JavaScript

JavaScript deve aprimorar o HTML, não ser responsável por criá-lo.

Use scripts externos com `defer` ou módulos:

```html
<script src="js/main.js" defer></script>
```

ou:

```html
<script type="module" src="js/main.js"></script>
```

Padrão recomendado:

```js
function setupDisclosure(root) {
  if (root.dataset.ready === 'true') return;
  root.dataset.ready = 'true';

  const trigger = root.querySelector('[data-disclosure-trigger]');
  const panel = root.querySelector('[data-disclosure-panel]');
  if (!trigger || !panel) return;

  const toggle = () => {
    const open = trigger.getAttribute('aria-expanded') !== 'true';
    trigger.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  };

  trigger.addEventListener('click', toggle);
}

document.querySelectorAll('[data-disclosure]').forEach(setupDisclosure);
```

Regras:

- Inicialização deve ser idempotente.
- Não substitua `body.innerHTML`.
- Não recrie blocos inteiros apenas para mudar um estado.
- Use classes, atributos e propriedades nativas para estado.
- Mantenha o DOM original estável.
- Use `addEventListener`, não handlers inline como `onclick`.
- Use `AbortController` ou funções de cleanup quando houver desmontagem.
- Remova timers, observers e listeners que não sejam permanentes.
- Não capture roda, teclado ou ponteiro globalmente sem necessidade.
- Não bloqueie seleção e edição do canvas.
- Não dependa de Node.js, filesystem, bundler ou variáveis secretas.
- Não faça a renderização inicial depender de uma API remota.

### Reduced motion no JavaScript autoral

```js
const reduceMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;
```

Se uma animação também estiver descrita no documento nativo de Interactions, não duplique a mesma animação em JavaScript.

---

## 6. Componentes interativos e reutilizáveis reconhecíveis

Para componentes autorais reutilizáveis com variantes, propriedades, eventos
e instâncias, leia integralmente
[component-system.md](component-system.md). Esse sistema é diferente dos
widgets de comportamento abaixo: ele persiste definições em
`.incode/project.json`; cada componente mantém `component.json`, CSS próprio
escopado e masters em `.incode/components/<id>/`; eventos ficam no documento
Interactions v2 de cada variante. O CSS do bundle preserva media queries e é
consumido pela prévia, pelo canvas e pela publicação.

No Agent embutido no Builder, use `kodety_component_snapshot` e
`kodety_apply_component_changes`. Não simule uma definição reutilizável com
atributos internos escritos manualmente e não edite arquivos do bundle por
uma operação genérica.

Use HTML nativo sempre que possível:

- dropdown simples: `<details><summary>…`;
- modal: `<dialog>`;
- disclosure: botão com `aria-expanded`;
- formulário: elementos nativos;
- navegação: links reais;
- mídia: `<picture>`, `<video>` e `<audio>`.

### Tabs nativas do Onun Kodety

Para o runtime reconhecer tabs, use:

```html
<div
  class="tabs"
  data-label="Product Tabs"
  data-incode-component="tabs"
  data-tabs-active="0"
  data-tabs-orientation="horizontal"
  data-tabs-activation="auto"
>
  <div role="tablist" aria-orientation="horizontal">
    <button
      id="tab-overview"
      type="button"
      role="tab"
      aria-selected="true"
      aria-controls="panel-overview"
      tabindex="0"
    >
      Overview
    </button>
    <button
      id="tab-details"
      type="button"
      role="tab"
      aria-selected="false"
      aria-controls="panel-details"
      tabindex="-1"
    >
      Details
    </button>
  </div>

  <section
    id="panel-overview"
    role="tabpanel"
    aria-labelledby="tab-overview"
  >
    Conteúdo inicial
  </section>

  <section
    id="panel-details"
    role="tabpanel"
    aria-labelledby="tab-details"
    hidden
  >
    Conteúdo secundário
  </section>
</div>
```

Valores aceitos:

- `data-tabs-orientation`: `horizontal` ou `vertical`;
- `data-tabs-activation`: `auto` ou `manual`;
- `data-tabs-active`: índice inicial, começando em `0`.

Não escreva outro script para alternar essas tabs.

### Slider nativo do Onun Kodety

```html
<section
  class="slider"
  data-label="Testimonials Slider"
  data-incode-component="slider"
  data-slider-active="0"
>
  <article data-slide>Primeiro slide</article>
  <article data-slide hidden>Segundo slide</article>

  <div data-slider-controls>
    <button type="button" data-slider-prev>Anterior</button>
    <span data-slider-status aria-live="polite">1 / 2</span>
    <button type="button" data-slider-next>Próximo</button>
  </div>
</section>
```

Os elementos `data-slide` devem ser filhos diretos do root do slider.

---

## 7. Contrato nativo do painel Interactions

Esta seção é obrigatória quando o site possuir animações que devam aparecer e permanecer editáveis no painel **Interactions**.

### Regra principal

Uma animação escrita apenas em CSS, Web Animations API, GSAP autoral, AOS ou outro runtime pode funcionar no site publicado, mas **não será automaticamente uma interação editável no painel**.

Para integração completa, faça duas coisas:

1. marque os elementos no HTML com seletores estáveis;
2. crie o documento JSON nativo da página em `.incode/animations/`.

O Onun Kodety injeta o motor Motion quando necessário. Não inclua cópias dessas bibliotecas e não gere manualmente scripts `data-kodety-interactions-runtime`.

### Nome do arquivo de animação

Cada página possui seu próprio documento.

| Página HTML | Documento de Interactions |
|---|---|
| `index.html` | `.incode/animations/index.html.json` |
| `about.html` | `.incode/animations/about.html.json` |
| `pages/about.html` | `.incode/animations/pages%2Fabout.html.json` |
| `pages/products/item.html` | `.incode/animations/pages%2Fproducts%2Fitem.html.json` |

Regra: aplique percent-encoding RFC 3986 ao caminho HTML completo
(`encodeURIComponent` no JavaScript, incluindo escape de `!'()*`) e acrescente
`.json`. Assim, `/`, `__`, espaços e hífens nunca fazem duas páginas
compartilharem o mesmo documento. O formato legado que trocava `/` por `__`
continua sendo lido, mas novos documentos devem usar o nome codificado.

### Marcadores no HTML

```html
<section
  class="hero"
  data-label="Hero"
  data-kodety-interaction-id="hero"
>
  <div
    class="hero__content"
    data-label="Hero Content"
    data-kodety-interaction-id="hero-content"
  >
    <h1 data-label="Hero Heading">Título</h1>
    <p>Descrição</p>
    <a
      class="button button--primary"
      href="/contact/"
      data-label="Primary CTA"
      data-kodety-interaction-id="primary-cta"
      data-kodety-tracking-id="primary-cta"
    >
      Começar
    </a>
  </div>
</section>
```

Seletor recomendado:

```text
[data-kodety-interaction-id="hero-content"]
```

Não use o caminho estrutural do DOM como seletor permanente.

### Gatilhos aceitos

| `trigger` | Uso |
|---|---|
| `load` | Executa ao carregar a página |
| `click` | Executa ao clicar no elemento |
| `click-start` | Executa ao pressionar o ponteiro |
| `appear` | Executa na primeira entrada no viewport |
| `mouse-enter` | Executa quando o ponteiro entra |
| `mouse-leave` | Executa quando o ponteiro sai |
| `hover` | Entrada e saída do ponteiro |
| `mouse-move` | Progresso dirigido pela posição do ponteiro |
| `scroll` | Timeline ligada ao progresso de scroll pelo motor Motion |
| `custom` | Evento customizado disparado no `document` |

### Breakpoints de execução das interações

O runtime de Interactions classifica a largura assim:

- `mobile`: menor que `768px`;
- `tablet`: de `768px` até `991px`;
- `desktop`: `992px` ou mais.

Use `enabledBreakpoints` com qualquer combinação destes três valores.

### Modos de target

`triggerTargetMode` e `target.mode` aceitam:

- `element`: identidade única, preferencialmente por `data-kodety-interaction-id`;
- `class`: conjunto representado por uma classe;
- `selector`: seletor CSS explícito.

### Escopos de uma action

| `target.scope` | Resultado |
|---|---|
| `trigger` | O próprio elemento que disparou a interação |
| `document` | Busca `target.selector` no documento inteiro |
| `children` | Filhos diretos do trigger que correspondem ao seletor |
| `descendants` | Descendentes do trigger que correspondem ao seletor |
| `parent` | Pai direto, se corresponder ao seletor |
| `closest` | Ancestral mais próximo que corresponda ao seletor |
| `siblings` | Irmãos que correspondem ao seletor |
| `next` | Próximo irmão, se corresponder ao seletor |
| `previous` | Irmão anterior, se corresponder ao seletor |

Para `scope: "trigger"`, o seletor da action pode ficar vazio.

### Tipos de action

| `kind` | Comportamento |
|---|---|
| `animate` | Anima `from` → `to`, ou uma lista de keyframes |
| `set` | Aplica imediatamente os valores de `to` |
| `class-add` | Adiciona `className` |
| `class-remove` | Remove `className` |
| `class-toggle` | Alterna `className` |
| `variable` | Anima uma custom property indicada em `variableName` |
| `component-variant` | Troca uma instância para `componentVariantId` |
| `event` | Dispara `CustomEvent` com nome `eventName` |
| `lottie` | Executa o comando `inputName` no player |
| `rive` | Atualiza ou dispara o input `inputName` |
| `spline` | Atualiza a variável `inputName` |

Uma action `component-variant` deve definir `componentId` e
`componentVariantId` válidos. Use-a nos documentos de Interactions dos masters
e não duplique a troca de estado em JavaScript autoral.

### Propriedades de animação

Use nomes camelCase compatíveis com GSAP/CSS:

- Transform: `x`, `y`, `z`, `xPercent`, `yPercent`, `scale`, `scaleX`, `scaleY`, `rotation`, `rotationX`, `rotationY`, `skewX`, `skewY`, `transformOrigin`.
- Layout: `display`, `visibility`, `overflow`, `pointerEvents`.
- Tamanho: `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`.
- Espaçamento: `margin`, `marginTop`, `padding`, `paddingTop`, `gap`, `rowGap`, `columnGap`.
- Tipografia: `color`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`.
- Fundo e borda: `backgroundColor`, `backgroundImage`, `borderColor`, `borderWidth`, `borderRadius`.
- Efeitos: `opacity`, `filter`, `backdropFilter`, `boxShadow`, `clipPath`.
- SVG: `fill`, `stroke`, `strokeWidth`, `strokeDasharray`, `strokeDashoffset`.

Valores numéricos GSAP:

- `x`, `y`, `z`: pixels;
- `rotation`, `skewX`, `skewY`: graus;
- `opacity`: de `0` a `1`;
- `scale`: `1` representa 100%.

Valores CSS devem incluir unidade quando necessário:

```json
{
  "width": "24rem",
  "borderRadius": "1.25rem",
  "filter": "blur(10px)",
  "clipPath": "inset(0% 0% 0% 0%)",
  "backgroundColor": "#ff8528"
}
```

### Easing

Use easings GSAP reconhecíveis, como:

- `none`;
- `power1.in`, `power1.out`, `power1.inOut`;
- `power2.in`, `power2.out`, `power2.inOut`;
- `power3.out`;
- `back.out(1.5)`;
- `bounce.out`;
- `sine.inOut`;
- `expo.out`.

### Repetição

- `repeat: 0`: executa uma vez;
- `repeat: 1`: executa novamente uma vez;
- `repeat: -1`: infinito no site publicado;
- `repeatDelay`: intervalo em segundos;
- `yoyo: true`: alterna a direção.

No canvas de Design, uma repetição infinita é representada por um ciclo finito para permitir preview e scrubbing.

### Stagger e divisão de texto

`stagger` é o intervalo em segundos entre targets.

`staggerFrom` aceita:

- `start`;
- `center`;
- `end`;
- `edges`;
- `random`.

`textSplit` aceita:

- `none`;
- `chars`;
- `words`;
- `lines`.

Use `textSplit` somente em elementos de texto simples. Não aplique em headings que contenham links, ícones ou spans semânticos importantes, pois o runtime precisa dividir o conteúdo em spans.

### Reduced motion

Cada interação deve definir:

- `end`: mostra o estado final; recomendado para entradas visuais;
- `skip`: mantém o início e não executa;
- `allow`: mantém a animação mesmo com reduced motion.

Prefira `end`. Use `allow` somente para movimentos essenciais e não desconfortáveis.

---

## 8. Exemplo completo de documento de Interactions

Arquivo: `.incode/animations/index.html.json`

O exemplo abaixo contém:

- entrada do conteúdo do hero no carregamento;
- hover reversível no CTA;
- revelação controlada por scroll;
- seletores estáveis e suporte a reduced motion.

HTML mínimo correspondente:

```html
<section
  class="hero"
  data-label="Hero"
  data-kodety-interaction-id="hero"
>
  <div
    class="hero__content"
    data-label="Hero Content"
    data-kodety-interaction-id="hero-content"
  >
    <h1 class="hero__animate-item">Título principal</h1>
    <p class="hero__animate-item">Descrição do produto.</p>
    <a
      class="hero__animate-item button button--primary"
      href="/contact/"
      data-label="Primary CTA"
      data-kodety-interaction-id="primary-cta"
      data-kodety-tracking-id="primary-cta"
    >
      Começar
    </a>
  </div>
</section>

<section
  class="features"
  data-label="Features"
  data-kodety-interaction-id="features-section"
>
  <article class="feature-card">Primeiro recurso</article>
  <article class="feature-card">Segundo recurso</article>
  <article class="feature-card">Terceiro recurso</article>
</section>
```

```json
{
  "version": 2,
  "interactions": [
    {
      "id": "hero-load",
      "name": "Hero entrance",
      "trigger": "load",
      "triggerSelector": "[data-kodety-interaction-id=\"hero\"]",
      "triggerLabel": "Hero",
      "triggerTargetMode": "element",
      "actions": [
        {
          "id": "hero-content-enter",
          "name": "Hero content enter",
          "kind": "animate",
          "target": {
            "selector": "[data-kodety-interaction-id=\"hero-content\"]",
            "label": "Hero Content",
            "scope": "document",
            "mode": "element"
          },
          "start": 0.1,
          "duration": 0.7,
          "ease": "power2.out",
          "from": {
            "opacity": 0,
            "y": 32
          },
          "to": {
            "opacity": 1,
            "y": 0
          },
          "keyframes": [],
          "repeat": 0,
          "repeatDelay": 0,
          "yoyo": false,
          "stagger": 0,
          "staggerFrom": "start",
          "textSplit": "none",
          "className": "",
          "variableName": "--motion-value",
          "variableValue": 1,
          "eventName": "kodety-action",
          "inputName": "",
          "inputValue": true
        },
        {
          "id": "hero-items-enter",
          "name": "Hero children stagger",
          "kind": "animate",
          "target": {
            "selector": ".hero__animate-item",
            "label": "Hero Items",
            "scope": "descendants",
            "mode": "class"
          },
          "start": 0.18,
          "duration": 0.55,
          "ease": "power2.out",
          "from": {
            "opacity": 0,
            "y": 20
          },
          "to": {
            "opacity": 1,
            "y": 0
          },
          "keyframes": [],
          "repeat": 0,
          "repeatDelay": 0,
          "yoyo": false,
          "stagger": 0.08,
          "staggerFrom": "start",
          "textSplit": "none",
          "className": "",
          "variableName": "--motion-value",
          "variableValue": 1,
          "eventName": "kodety-action",
          "inputName": "",
          "inputValue": true
        }
      ],
      "enabled": true,
      "repeat": 0,
      "yoyo": false,
      "hoverInAction": "restart",
      "hoverOutAction": "reverse",
      "clickAction": "toggle",
      "mouseMoveAxis": "both",
      "mouseMoveReverse": true,
      "mouseMoveSmoothing": 0.18,
      "scrollStart": "top 80%",
      "scrollEnd": "bottom 20%",
      "scrollScrub": false,
      "scrollSmoothing": 0,
      "scrollToggleActions": "play none none reverse",
      "scrollTriggerSelector": "",
      "scrollTriggerLabel": "Animated element",
      "customEvent": "kodety-interaction",
      "reducedMotion": "end",
      "enabledBreakpoints": [
        "desktop",
        "tablet",
        "mobile"
      ]
    },
    {
      "id": "primary-cta-hover",
      "name": "Primary CTA hover",
      "trigger": "hover",
      "triggerSelector": "[data-kodety-interaction-id=\"primary-cta\"]",
      "triggerLabel": "Primary CTA",
      "triggerTargetMode": "element",
      "actions": [
        {
          "id": "primary-cta-scale",
          "name": "CTA scale and lift",
          "kind": "animate",
          "target": {
            "selector": "",
            "label": "Trigger element",
            "scope": "trigger",
            "mode": "element"
          },
          "start": 0,
          "duration": 0.22,
          "ease": "power2.out",
          "from": {
            "scale": 1,
            "y": 0
          },
          "to": {
            "scale": 1.03,
            "y": -2
          },
          "keyframes": [],
          "repeat": 0,
          "repeatDelay": 0,
          "yoyo": false,
          "stagger": 0,
          "staggerFrom": "start",
          "textSplit": "none",
          "className": "",
          "variableName": "--motion-value",
          "variableValue": 1,
          "eventName": "kodety-action",
          "inputName": "",
          "inputValue": true
        }
      ],
      "enabled": true,
      "repeat": 0,
      "yoyo": false,
      "hoverInAction": "restart",
      "hoverOutAction": "reverse",
      "clickAction": "toggle",
      "mouseMoveAxis": "both",
      "mouseMoveReverse": true,
      "mouseMoveSmoothing": 0.18,
      "scrollStart": "top 80%",
      "scrollEnd": "bottom 20%",
      "scrollScrub": false,
      "scrollSmoothing": 0,
      "scrollToggleActions": "play none none reverse",
      "scrollTriggerSelector": "",
      "scrollTriggerLabel": "Animated element",
      "customEvent": "kodety-interaction",
      "reducedMotion": "end",
      "enabledBreakpoints": [
        "desktop",
        "tablet"
      ]
    },
    {
      "id": "features-scroll",
      "name": "Features scroll reveal",
      "trigger": "scroll",
      "triggerSelector": "[data-kodety-interaction-id=\"features-section\"]",
      "triggerLabel": "Features",
      "triggerTargetMode": "element",
      "actions": [
        {
          "id": "feature-cards-reveal",
          "name": "Feature cards reveal",
          "kind": "animate",
          "target": {
            "selector": ".feature-card",
            "label": "Feature Cards",
            "scope": "descendants",
            "mode": "class"
          },
          "start": 0,
          "duration": 0.65,
          "ease": "power2.out",
          "from": {
            "opacity": 0,
            "y": 28
          },
          "to": {
            "opacity": 1,
            "y": 0
          },
          "keyframes": [],
          "repeat": 0,
          "repeatDelay": 0,
          "yoyo": false,
          "stagger": 0.1,
          "staggerFrom": "start",
          "textSplit": "none",
          "className": "",
          "variableName": "--motion-value",
          "variableValue": 1,
          "eventName": "kodety-action",
          "inputName": "",
          "inputValue": true
        }
      ],
      "enabled": true,
      "repeat": 0,
      "yoyo": false,
      "hoverInAction": "restart",
      "hoverOutAction": "reverse",
      "clickAction": "toggle",
      "mouseMoveAxis": "both",
      "mouseMoveReverse": true,
      "mouseMoveSmoothing": 0.18,
      "scrollStart": "top 82%",
      "scrollEnd": "bottom 20%",
      "scrollScrub": false,
      "scrollSmoothing": 0,
      "scrollToggleActions": "play none none reverse",
      "scrollTriggerSelector": "",
      "scrollTriggerLabel": "Animated element",
      "customEvent": "kodety-interaction",
      "reducedMotion": "end",
      "enabledBreakpoints": [
        "desktop",
        "tablet",
        "mobile"
      ]
    }
  ]
}
```

### Regra visual importante

O CSS estático deve descrever o estado final e utilizável do site:

```css
.hero__content,
.feature-card {
  opacity: 1;
  transform: none;
}
```

Não esconda permanentemente elementos com `opacity: 0` no CSS esperando que JavaScript os revele. O runtime nativo aplica o estado `from` no momento correto. Isso também evita conteúdo invisível se scripts forem bloqueados.

### Keyframes

Para uma action com três ou mais estados, use `keyframes` com tempos crescentes, relativos ao início da action:

```json
{
  "id": "logo-float",
  "time": 0,
  "values": {
    "y": 0,
    "rotation": 0
  }
}
```

Um exemplo de lista:

```json
[
  {
    "id": "float-start",
    "time": 0,
    "values": {
      "y": 0,
      "rotation": 0
    }
  },
  {
    "id": "float-middle",
    "time": 1.2,
    "values": {
      "y": -12,
      "rotation": 2
    }
  },
  {
    "id": "float-end",
    "time": 2.4,
    "values": {
      "y": 0,
      "rotation": 0
    }
  }
]
```

Quando houver mais de um keyframe, os valores `from` e `to` deixam de ser a fonte principal da timeline. Mantenha tempos não negativos e em ordem crescente.

---

## 9. CMS e conteúdo dinâmico

Só adicione marcações de CMS se o site realmente for usar coleções no Onun Kodety.

### Collection

```html
<section
  class="posts-grid"
  data-label="Posts Collection"
  data-kodety-collection="post"
  data-kodety-limit="6"
>
  <article class="post-card" data-kodety-collection-item="true">
    <img
      class="post-card__image"
      src="assets/images/post-placeholder.webp"
      alt=""
      data-kodety-bind-src="featured_image"
      data-kodety-bind-alt="featured_image"
    >
    <h2 data-kodety-bind-content="title">Título de exemplo</h2>
    <p data-kodety-bind-content="excerpt">Resumo de exemplo.</p>
    <a href="#" data-kodety-bind-href="slug">Ler artigo</a>
  </article>

  <p data-kodety-empty-state hidden>Nenhum item encontrado.</p>
</section>
```

Bindings aceitos:

- `data-kodety-bind-content`;
- `data-kodety-bind-title`;
- `data-kodety-bind-href`;
- `data-kodety-bind-src`;
- `data-kodety-bind-alt`.

Sempre mantenha um fallback estático válido no HTML.

---

## 10. Analytics e metas

Marque interações relevantes para Analytics com IDs estáveis:

```html
<a
  href="/checkout/"
  data-label="Checkout CTA"
  data-kodety-tracking-id="checkout-cta"
>
  Comprar
</a>
```

Use `data-kodety-tracking-id` em:

- CTAs principais;
- submissões;
- downloads;
- etapas de funil;
- ações que podem se tornar metas ou testes A/B.

Não reutilize o mesmo tracking ID para ações semanticamente diferentes.

---

## 11. Assets, imagens, ícones e fontes

### Caminhos

Use caminhos relativos ao arquivo que faz a referência:

```html
<img src="assets/images/hero.webp" alt="Descrição">
```

```css
.hero {
  background-image: url("../assets/images/hero.webp");
}
```

```css
@font-face {
  font-family: "Brand Sans";
  src: url("../assets/fonts/brand-sans.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

Regras:

- Não use caminhos do computador local.
- Não use `file://`.
- Evite URLs temporárias, blobs e links com autenticação.
- Prefira `woff2` para fontes.
- Prefira WebP/AVIF para fotografia e SVG para ícones vetoriais.
- Não faça base64 de assets grandes.
- Não copie assets para `.incode/components/<id>/assets/`. HTML e CSS de
  componentes usam caminhos relativos até o asset compartilhado normal do
  projeto; `component.json` apenas registra esse arquivo em `projectFiles`.
- Inclua `alt` significativo em imagens informativas.
- Use `alt=""` em imagens puramente decorativas.
- Informe `width` e `height` quando conhecidos para reduzir layout shift.
- Não dependa de um pacote de ícones que não esteja no ZIP.

---

## 12. Acessibilidade obrigatória

- Um único `h1` principal por página.
- Hierarquia de headings sem saltos arbitrários.
- Todo campo deve possuir `label`.
- Todo botão deve usar `<button>`.
- Todo link deve usar `<a href>`.
- Ícones sem texto precisam de `aria-label`.
- Elementos decorativos devem usar `aria-hidden="true"`.
- Contraste suficiente.
- Estados de foco visíveis.
- Navegação por teclado.
- `aria-expanded`, `aria-controls`, `aria-selected` e `aria-current` quando aplicáveis.
- Não remova outline sem substituição equivalente.
- Não prenda o foco fora de modais.
- Respeite `prefers-reduced-motion`.

---

## 13. Performance e estabilidade

- Use `loading="lazy"` em imagens abaixo da primeira dobra.
- Não aplique lazy loading à principal imagem LCP.
- Use `decoding="async"` em imagens quando apropriado.
- Evite vídeos pesados em autoplay.
- Não carregue bibliotecas duplicadas.
- Não importe GSAP ou ScrollTrigger para interações nativas do Onun Kodety.
- Evite observers por elemento quando um observer compartilhado resolve.
- Evite loops infinitos de `requestAnimationFrame`.
- Anime preferencialmente `transform` e `opacity`.
- Não anime propriedades de layout em dezenas de elementos sem necessidade.
- Evite filtros e blurs gigantes em áreas extensas.
- Não cause overflow horizontal.

---

## 14. O que é proibido

Não entregue:

- apenas React/Next/Vue/Svelte sem HTML compilado;
- uma página que só aparece após hidratação;
- classes ou IDs instáveis;
- assets externos essenciais sem cópia local;
- URLs absolutas para arquivos internos;
- estilos críticos montados somente via JS;
- animação duplicada no JSON e em CSS/JS;
- elementos inicialmente invisíveis sem fallback;
- um runtime GSAP próprio para animações que precisam ser editáveis;
- scripts `data-kodety-interactions-runtime` escritos à mão;
- edição manual de arquivos gerados pelo Onun Kodety;
- múltiplos elementos com o mesmo `data-kodety-interaction-id`;
- seletores baseados em caminhos frágeis ou `nth-child`;
- conteúdo principal em canvas, SVG monolítico ou imagem;
- listeners globais sem cleanup;
- dependência de API secreta no navegador;
- `javascript:` em links;
- HTML inválido ou tags interativas aninhadas;
- `button` dentro de `a`, ou `a` dentro de `button`;
- media queries contraditórias sem necessidade.
- `!important` em CSS, HTML inline, componentes ou CSS gerado por JavaScript.

---

## 15. Procedimento obrigatório da IA

Ao receber um design ou briefing:

1. Inventarie páginas, seções, componentes, estados e animações.
2. Defina nomes semânticos e estáveis.
3. Crie o HTML real de todas as páginas.
4. Adicione `data-label` aos blocos importantes.
5. Adicione `data-kodety-interaction-id` aos triggers e targets animados.
6. Adicione `data-kodety-tracking-id` às ações relevantes.
7. Escreva CSS-base e depois os breakpoints.
8. Remova qualquer `!important` encontrado e resolva a cascata sem prioridade.
9. Implemente widgets e componentes reutilizáveis com os contratos do Onun Kodety;
   para variantes e propriedades, siga também `component-system.md`.
10. Use JS apenas para comportamentos não cobertos pelos componentes e Interactions.
11. Crie um JSON de Interactions para cada página animada.
12. Confira se todos os seletores do JSON existem no HTML.
13. Confira se IDs de interação, action e keyframe são únicos.
14. Confira se o estado final permanece visível sem JavaScript.
15. Teste teclado, reduced motion e breakpoints.
16. Valide todos os caminhos e a presença dos assets.
17. Entregue a pasta ou ZIP completo.

---

## 16. Checklist final de aceitação

### Projeto

- [ ] Existe `index.html` ou entrada declarada em `.incode/project.json`.
- [ ] O site abre diretamente no navegador.
- [ ] Nenhum passo de build é necessário.
- [ ] Todos os caminhos são relativos e válidos.
- [ ] Não existem arquivos desnecessários de desenvolvimento.

### HTML

- [ ] Conteúdo e estrutura existem no HTML.
- [ ] Elementos semânticos são usados corretamente.
- [ ] Seções importantes possuem `data-label`.
- [ ] IDs são únicos.
- [ ] Elementos animados possuem identidade estável.
- [ ] Não há conteúdo principal desenhado como uma única imagem/canvas.

### CSS

- [ ] CSS é externo, legível e organizado.
- [ ] Seletores são estáveis.
- [ ] Base vem antes dos breakpoints.
- [ ] Breakpoints simples usam `min-width` ou `max-width`.
- [ ] Nenhum arquivo autoral contém `!important`.
- [ ] Não há overflow horizontal.
- [ ] O estado final do conteúdo é visível sem scripts.

### JavaScript

- [ ] O site funciona sem depender de hidratação.
- [ ] Inicialização é idempotente.
- [ ] DOM autoral não é substituído.
- [ ] Listeners e observers são controlados.
- [ ] Não existe duplicação das animações nativas.

### Componentes reutilizáveis

- [ ] `components.version` é `1` em `.incode/project.json`.
- [ ] Cada definição nova declara bundle `version: 1` e possui
  `component.json` e `component.css`.
- [ ] Cada componente mantém ao menos uma variante e a primária vem primeiro.
- [ ] Todo master referenciado existe em `.incode/components/` e possui uma raiz.
- [ ] Manifesto, CSS e lista de variantes estão sincronizados.
- [ ] CSS está sob `data-kodety-component-scope` e mantém os breakpoints.
- [ ] Assets continuam compartilhados no projeto, sem cópia dentro do bundle.
- [ ] Nodes de componente possuem IDs estáveis e sem duplicatas.
- [ ] Variáveis e bindings apontam para IDs reais.
- [ ] Instâncias materializadas apontam para componente e variante existentes.
- [ ] Instance IDs são únicos na página e overrides são válidos.
- [ ] Eventos de variantes usam Interactions v2 e action `component-variant`.

### Interactions

- [ ] Cada página animada possui o JSON correto em `.incode/animations/`.
- [ ] `version` é `2`.
- [ ] Todos os `triggerSelector` existem.
- [ ] Todos os `target.selector` necessários existem.
- [ ] `data-kodety-interaction-id` não se repete.
- [ ] Trigger, action, scope e mode usam valores aceitos.
- [ ] Tempos estão em segundos e não são negativos.
- [ ] Propriedades usam camelCase.
- [ ] Reduced motion foi definido.
- [ ] `enabledBreakpoints` usa apenas `desktop`, `tablet` e `mobile`.
- [ ] O motor Motion não foi duplicado.

### Acessibilidade e qualidade

- [ ] Headings têm hierarquia correta.
- [ ] Imagens possuem alt adequado.
- [ ] Formulários possuem labels.
- [ ] Foco é visível.
- [ ] Componentes funcionam por teclado.
- [ ] Layout foi conferido em desktop, tablet e mobile.
- [ ] Não há erros no console.

---

## 17. Critério de conclusão

O trabalho só está concluído quando o projeto:

1. abre como HTML estático;
2. importa no Onun Kodety sem arquivos ausentes;
3. apresenta uma árvore Layers compreensível;
4. permanece editável visualmente;
5. mantém o layout em todos os breakpoints;
6. exibe suas animações no painel Interactions;
7. permite editar, reproduzir, reverter e fazer scrub das animações;
8. publica sem depender do ambiente usado para gerar o código.
9. permite criar, inserir e editar componentes e variantes nativamente quando
   o projeto declarar uma biblioteca reutilizável;
10. mostra o mesmo componente corretamente no painel Insert, no master e nas
    páginas publicadas, em desktop, tablet e mobile.

Se houver conflito entre uma técnica sofisticada e a editabilidade no Onun Kodety, escolha a solução mais simples, semântica, estável e nativa.

---

## 18. Sincronização automática IA → Builder

Esta seção define o modo conectado. Nesse modo, a IA não espera terminar o projeto inteiro para entregar um ZIP: ela constrói uma seção completa, envia essa seção ao Builder atual e continua o trabalho usando a nova revisão retornada pelo Onun Kodety.

### 18.1 Conexão

A configuração deve apontar para o endpoint canônico:

```json
{
  "mcpServers": {
    "kodety": {
      "type": "streamable-http",
      "url": "https://SEU-DOMINIO/wp-json/kodety/v1/mcp",
      "headers": {
        "Authorization": "Bearer SEU_TOKEN_PRIVADO"
      }
    }
  }
}
```

O token é secreto. Nunca o grave no HTML, CSS, JavaScript, manifesto, documentação do projeto, histórico Git, logs ou resposta final.

No Builder, o ícone MCP da topbar abre diretamente
`Settings → Integrações e IA → MCP`. A ação **Copiar conexão deste projeto**
nessa tela cria uma credencial nova e independente, vinculada ao projeto único,
sem rotacionar ou invalidar conexões existentes. A configuração com o token em
texto puro é entregue somente nessa cópia. A mesma tela oferece o prompt e o
pacote das skills oficiais para clientes externos; o Agent nativo já usa as
skills embarcadas e não requer instalação.

### 18.2 Ciclo obrigatório

1. Chame `kodety_get_site`, confirme `connectionScope` e `target`, e guarde a
   revisão atual como `baseRevision`. Valide `target.workspaceProjectId` e
   `target.name`.
2. Liste e leia os arquivos relevantes do workspace atual.
3. Construa uma seção semântica completa localmente.
4. Inclua HTML, CSS, responsividade, assets e Interactions necessários para a seção funcionar.
5. Marque a raiz com um identificador estável:

```html
<section
  id="features"
  data-kodety-section-id="features"
  data-label="Features"
>
  <!-- conteúdo totalmente editável -->
</section>
```

6. Envie a seção com `kodety_upsert_section`, informando o `baseRevision` mais recente.
7. Confirme na resposta:
   - que uma nova revisão foi criada;
   - quais caminhos foram alterados;
   - que o HTML autoral contém a seção;
   - que não foi criada uma duplicata.
8. Use a nova revisão como base da próxima seção.

O payload exato deve seguir o schema exposto pelo servidor MCP. Conceitualmente, ele contém o identificador estável da seção, a página de destino, o HTML completo, os estilos e a revisão-base.

### 18.3 Granularidade

Envie por seção semântica, por exemplo:

1. Header
2. Hero
3. Logos
4. Features
5. Testimonials
6. Pricing
7. FAQ
8. Footer

Não envie elemento por elemento. Uma seção só deve ser sincronizada quando estiver coerente e utilizável. Correções posteriores usam o mesmo `data-kodety-section-id`, fazendo update em vez de insert duplicado.

### 18.4 Concorrência e conflitos

Cada mutação é otimista e depende de revisão. Em caso de HTTP 409 ou conflito equivalente:

1. identifique se o erro é revisão antiga ou
   `kodety_mcp_project_target_changed`;
2. não repita o mesmo payload às cegas;
3. para revisão antiga, leia novamente o estado, preserve alterações feitas no
   Builder, reconcilie e reenvie com a nova revisão;
4. para alvo trocado, interrompa a operação até o usuário reabrir o projeto
   vinculado ou fornecer uma conexão copiada do projeto pretendido.

Se houver polling do Builder, considere uma janela aproximada de 1,4 segundo para o estado visual aparecer. A resposta do MCP, porém, continua sendo a fonte primária de confirmação.

### 18.5 Projetos compilados

Em projetos com `.incode/coded-build.json`, arquivos dentro de `kodety-build/` são gerados e não devem ser tratados como fonte autoral. A sincronização precisa atualizar:

- a página visível no Builder;
- os arquivos-fonte originais referenciados por `.incode/coded-build.json`;
- o documento de Interactions, quando houver animação.

Caso contrário, a seção pode aparecer temporariamente e desaparecer no próximo rebuild.

### 18.6 Publicação e segurança

- A sincronização automática atualiza o rascunho do Builder.
- Publicação é uma ação separada e só acontece mediante pedido explícito do usuário.
- Nunca exiba o token MCP em relatórios.
- A configuração copiada no Builder contém uma credencial exibida uma única
  vez e deve ir diretamente para o cliente MCP.
- Se um token real tiver sido compartilhado fora do armazenamento seguro, recomende sua rotação.

### 18.7 Diagnóstico

| Sintoma | Verificação |
|---|---|
| Notificação aparece, mas a seção não | Confirme revisão, caminhos alterados e HTML autoral retornados pelo MCP |
| Seção duplicada | Reutilize o mesmo `data-kodety-section-id` |
| Mudança some após rebuild | Atualize as fontes registradas em `.incode/coded-build.json`, não apenas `kodety-build/` |
| HTTP 409 | Releia o site e reenvie com a revisão mais recente |
| `kodety_mcp_project_target_changed` | Abra no Builder o projeto ao qual a conexão foi vinculada ou copie uma conexão do destino correto |
| Animação não aparece em Interactions | Envie também o documento `.incode/animations/*.json` válido |
| Seção está visível, mas não editável | Remova abstrações opacas e preserve HTML/CSS autoral reconhecível |

### 18.8 Critério de conclusão conectado

O trabalho só está concluído quando:

- todas as seções planejadas foram confirmadas no Builder;
- cada seção possui identificador estável;
- a revisão final foi registrada;
- `connectionScope` e `target` ainda correspondem ao projeto solicitado;
- o site permanece editável;
- Interactions reconhece as animações;
- alterações sobrevivem a rebuilds;
- nenhum segredo foi incluído no projeto;
- publicação não ocorreu sem autorização explícita.
