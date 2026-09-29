# Catálogo de Property Controls

Use o tipo que representa o valor real. Defaults, valores responsivos e
fallbacks CMS passam pelo mesmo adapter.

## Conteúdo e valores primitivos

- `ControlType.String`: `string`; suporta `placeholder`, `maxLength` e
  `pattern`. Use para uma linha.
- `ControlType.Text`: `string`; suporta `minRows`, `maxRows` e `maxLength`. Use
  para texto multilinha.
- `ControlType.Number`: `number`; suporta `min`, `max`, `step`, `unit` e
  `display: input | slider | stepper | slider-input`.
- `ControlType.Boolean`: `boolean`; pode definir `enabledTitle` e
  `disabledTitle`.
- `ControlType.Enum`: primitivo JSON; exige `options` e pode usar
  `optionTitles`, `optionIcons` e `display: select | segmented | radio |
  icon-grid`. Opções, títulos e ícones devem ter cardinalidade compatível.
- `ControlType.Date`: string ISO; `mode: date | datetime`, `timezone`, `min` e
  `max` são opcionais.

## Cor, assets e navegação

- `ControlType.Color`: string CSS ou `CodayColor { value, format, alpha?,
  tokenId? }`; suporta alpha e tokens.
- `ControlType.Image`: `CodayImage { id, src, srcSet?, width?, height?, alt?,
  focalPoint? }`; pode restringir MIME e bytes.
- `ControlType.File`: `CodayFile { id, url, name, mimeType, size }`; pode
  restringir extensões, MIME e bytes.
- `ControlType.Link`: `CodayLink { type, value, target?, rel? }`; tipos:
  `url`, `page`, `section`, `email`, `phone` e `file`.

## Layout e estilo

- `ControlType.Spacing`: `CodaySpacing { top, right, bottom, left, unit,
  linked }`. Unidades: `px`, `rem`, `em`, `%`, `vw`, `vh`.
- `ControlType.Radius`: `CodayRadius { topLeft, topRight, bottomRight,
  bottomLeft, unit, linked }`.
- `ControlType.Border`: `CodayBorder { enabled, linked, top, right, bottom,
  left, tokenId? }`; cada lado tem `{ width, style, color }` e style `none`,
  `solid`, `dashed`, `dotted` ou `double`.
- `ControlType.Shadow`: `CodayShadow[]`; item `{ id, x, y, blur, spread,
  color, inset }`; respeite `maxCount`.
- `ControlType.Typography`: `CodayTypography`; pode incluir `family`, `tokenId`,
  `weight`, `size`, `unit`, `lineHeight`, `letterSpacing`, `align`, `transform`,
  `decoration` e `clamp`.
- `ControlType.Transform`: parcial de `CodayTransform`; translate XYZ, rotate
  XYZ, scale XYZ, skew XY, `origin` e `perspective`.
- `ControlType.Effects`: parcial de `CodayEffects`; `opacity`, `blur`,
  `backdropBlur`, `brightness`, `contrast`, `saturation`, `hueRotate` e
  `blendMode`.
- `ControlType.Layout`: `CodayLayout` com `mode: stack | grid | free |
  diagonal`. Stack oferece direction/gap/wrap/align/justify; grid oferece
  columns/minColumnWidth/rowGap/columnGap; diagonal possui angle, itemOffset,
  direction, origin, alignment e rotateItems.

## Estruturas e composição

- `ControlType.Object`: objeto JSON com `controls` aninhados. Forneça defaults
  para os campos usados no render.
- `ControlType.Array`: array JSON com um `control` por item, `minCount`,
  `maxCount`, `itemTitleAdapter` e `collapsedItems`. Use IDs estáveis nos
  objetos quando os itens forem reordenáveis.
- `ControlType.Slot`: uma referência de layer; `accepts` restringe componentes.
- `ControlType.Slots`: lista reordenável de referências; suporta `accepts`,
  `minCount` e `maxCount`.

## Escolha da apresentação

- Use slider apenas para intervalo curto e previsível; ofereça entrada numérica
  junto quando precisão importar.
- Use segmented para duas a quatro opções curtas; select para listas maiores.
- Use categorias para separar conteúdo, layout, estilo e comportamento; não
  esconda tudo em um único objeto avançado.
- Marque somente valores realmente adaptáveis como `responsive` e somente
  dados semanticamente conectáveis como `bindable`.
- Condições devem melhorar a leitura do Inspector, não esconder dependências
  essenciais ou criar estados impossíveis.

## Validação

- `min <= max`, `step > 0`, counts não negativos;
- todo default tem o tipo do controle;
- conditions apontam para paths existentes;
- valores persistidos nunca contêm `undefined` ou funções;
- arrays respeitam limites e IDs/keys estáveis;
- slots não apontam para a própria instância nem para ancestrais;
- controles aninhados seguem as mesmas regras dos controles de topo.
