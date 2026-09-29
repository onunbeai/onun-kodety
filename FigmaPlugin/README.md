# Figma to Kodety

Plugin unidirecional para converter uma seção selecionada no Figma em conteúdo
editável no Kodety Builder.

O produto possui uma única função: **Figma → Kodety**. Ele não importa sites,
não depende de bridge local, não chama serviços externos e não exige token de
acesso do Figma.

## Fluxo do conversor v5

1. Selecione uma seção, frame, componente ou conjunto de layers no Figma.
2. Abra **Convert selection for Kodety**.
3. Opcionalmente, marque a semântica da seleção e escolha o modo responsivo.
4. Clique em **Converter seção**.
5. Confira a prévia desktop/tablet/mobile, compare com a referência do Figma,
   revise os diagnósticos por camada e, se necessário, anexe as fontes licenciadas.
6. Clique em **Copiar para Kodety**.
7. No Kodety Builder, selecione o destino e pressione `⌘ V` ou `Ctrl V`.

Converter e copiar são ações separadas. Receber o pacote convertido na interface
do plugin **nunca escreve automaticamente no clipboard**. A área de transferência
só é acessada pelo clique explícito do usuário no botão de cópia.

A interface prioriza a prévia: seleção e modos ocupam o topo compacto, enquanto
semântica e detalhes da conversão ficam recolhidos abaixo. Os controles usam
Solar Bold Duotone e tabs com estado ativo por fundo e cor, sem contorno; o
indicador de foco permanece disponível para navegação por teclado.

O Builder reconhece o pacote assinado antes de procurar um SVG avulso, inclusive
quando o foco está no canvas. SVGs incorporados no JSON continuam sendo assets
do pacote; não são extraídos como se fossem o conteúdo inteiro do clipboard.
Esse caminho tem limite combinado de 96 Mi caracteres para texto/HTML, separado
dos limites menores da colagem de SVG avulso. Atualize também o Builder para
receber o novo encaminhamento da área de transferência.

## Leitura REST V1 da seleção

A versão 5 usa:

```js
node.exportAsync({ format: 'JSON_REST_V1' })
```

Esse formato da Plugin API devolve a representação equivalente ao endpoint de
nodes da API REST do Figma, mas opera sobre a seleção viva. Assim, o plugin não
precisa enviar a chave do arquivo, armazenar credenciais, aguardar sincronização
do documento ou consumir limites da API HTTP.

O snapshot `JSON_REST_V1` é a fonte estrutural canônica do conversor v5. A Plugin
API ao vivo continua sendo usada localmente para recursos que exigem o contexto
do editor, como a seleção atual, CSS nativo, bytes de imagens, exportação SVG/PNG,
fontes usadas e variables locais. Quando o snapshot REST V1 não estiver
disponível para uma layer, o conversor usa o fallback ao vivo e registra um aviso
no diagnóstico.

## Modos responsivos

O plugin oferece três estratégias. A escolha é gravada em `options.responsiveMode`
no pacote.

- **Pixel perfeito (`pixel`)**: preserva o tamanho e a geometria atuais. Não
  aplica inferência de layout nem gera media queries.
- **Auto Layout (`safe`)**: adapta o Auto Layout explícito. Larguras e textos
  passam a caber no container, espaçamentos diminuem e linhas/grids de conteúdo
  se reorganizam nos breakpoints de notebook, tablet e mobile. Ícones, botões,
  trilhos horizontais e arte absoluta mantêm seu papel na composição.
- **Inteligente (`smart`)**: inclui o comportamento Auto Layout e o ajuste de
  títulos grandes nas telas menores. Só
  promove um frame absoluto para Flexbox quando a geometria dos filhos comprova
  uma única linha ou coluna, incluindo uma ordem espacial determinística.

Frames sem Auto Layout ou inferência confiável continuam absolutos para evitar
mudanças silenciosas. O diagnóstico sinaliza esses fallbacks. Para uma seção
selecionada, a primeira adaptação começa logo abaixo da largura de referência
do Figma, com breakpoint mínimo de `1200px` (por exemplo, `1919px` para uma
seção de `1920px`). Assim, telas de notebook já recebem larguras e espaçamentos
adaptados. Tablet e mobile usam `810px` e `410px`, respectivamente.

Quando existe uma única seleção nos modos responsivos, a seção usa `width: 100%`.
A largura do frame desktop é uma referência de composição, não um `max-width`
implícito. Limites fixos de `minWidth` e `maxWidth` definidos no Figma são
preservados. Nas telas menores, elementos de conteúdo sem esses limites usam
`min-width: 0` e `max-width: 100%` para caber no container; os valores ficam
separados de `width`, sem expressões `min()` no campo de largura.

## Auto Layout e geometria

O conversor preserva, quando representável:

- Auto Layout horizontal, vertical e grid;
- direção, wrap, gaps, padding e alinhamento;
- sizing `Fixed`, `Hug` e `Fill` em cada eixo;
- tamanhos mínimos e máximos;
- constraints `MIN`, `MAX`, `CENTER`, `STRETCH` e `SCALE`;
- children absolutos, clipping, ordem visual e rotação simples;
- frames livres como geometria absoluta no modo pixel perfeito.

Cada layer recebe identidade estável baseada na origem. O pacote também inclui
um `sourceId`, separado do identificador único daquela conversão, para que o
Kodety consiga reconhecer novas versões da mesma seleção.

Quando a API descreve um frame como `Hug` mas seus filhos dependem de `Fill` no
mesmo eixo, o conversor conserva a dimensão já resolvida pelo Figma. Isso evita
que o conteúdo intrínseco de um parágrafo alargue um card inteiro. Padding não é
somado outra vez à largura do frame. Filhos de grupos têm suas coordenadas
recalculadas em relação ao grupo real do HTML, e snapshots de ícones espelhados
usam o canto visual da caixa, não a origem invertida da transformação.

## Semântica

Em **Camada semântica**, escolha uma tag e clique em **Aplicar à seleção**. O
plugin registra a anotação como shared plugin data e mantém no nome da layer um
sufixo legível, por exemplo:

```text
Primary navigation #tag:nav
```

Tags reconhecidas:

`div`, `section`, `header`, `nav`, `main`, `article`, `aside`, `footer`, `h1`
até `h6`, `p`, `span`, `a`, `button`, `ul`, `ol`, `li`, `form` e `label`.

Também são aceitas marcações escritas manualmente, como `#tag:section` e
`[nav]`. Na ausência de anotação explícita, o plugin usa heurísticas
conservadoras baseadas no tipo e no nome da layer. Elementos estruturais recebem
identidade de seção e `nav`/`aside` recebem rótulo acessível quando aplicável.

A inferência de botão reconhece palavras completas: `Rectangle` não é tratado
como `CTA`. Cada camada inclui os resets necessários no próprio CSS exportado,
antes de sua pintura e layout; botões não dependem de um reset adicional na
prévia para evitar bordas e padding padrões do navegador.

Grupos e wrappers de imagens dentro de botões usam `span`, com o mesmo layout e
filhos editáveis. A ancestralidade é verificada em todos os níveis para impedir
botões e links interativos aninhados. O Builder também corrige grupos `div`
identificados pelo Figma em pacotes anteriores dentro de botões; outros erros
estruturais continuam sendo rejeitados, sem afrouxar a validação de HTML.

Quebras de linha `U+2028` e `U+2029` do Figma são normalizadas no conteúdo textual
para que permaneçam quebras visíveis no HTML, inclusive dentro de rich text.
Os nomes das camadas e os intervalos de estilos não são alterados.

## Conteúdo preservado

- textos editáveis e ranges de rich text;
- família, peso, estilo, tamanho, line-height, tracking, case, decoração,
  alinhamento, truncation e recursos OpenType compatíveis;
- cores, gradientes, bordas, raios, opacidade, sombras, blur e blend modes
  representáveis em CSS;
- imagens, crop, tile e assets incorporados;
- vetores e máscaras médios/grandes como imagens PNG únicas em alta resolução;
- SVG apenas para ícones pequenos e simples;
- links de protótipo seguros;
- variables efetivamente usadas, valores de aliases resolvidos e referências CSS;
- HTML semântico, CSS responsivo, assets, fontes e diagnóstico em um pacote
  transacional versionado. O snapshot REST V1 orienta a conversão local, mas não
  precisa ser colado no Builder.

Cada composição vetorial é materializada separadamente, sem transformar toda a
seção ou seus textos em uma imagem. A renderização normal entra apenas no
contador de imagens; a lista de avisos mostra problemas reais de conversão.

Cores vinculadas a variables são resolvidas por camada, incluindo modos
herdados e aliases entre coleções. Uma seleção que mistura modos claro/escuro
gera tokens separados para os valores usados, sem aplicar o modo padrão sobre
todos os elementos. Quando uma resolução não corresponde à pintura efetiva,
o valor literal é preservado.

## SVG, imagens e fundos complexos

Vetores médios e grandes, máscaras e grupos de arte são exportados diretamente
como um único PNG por composição. A resolução usa 4× quando cabe no orçamento
de 4096 px/16 MP, reduzindo para 2× ou 1× em imagens maiores. Ícones simples com
caixa visual e de layout de até 24 × 24 px podem manter SVG; efeitos, máscaras,
gradientes e pinturas complexas também rasterizam mesmo nessa faixa pequena.
SVGs pequenos continuam validados e sanitizados. Falhas reais permanecem nos
avisos, mas um PNG gerado normalmente não produz um alerta para cada vetor.

Os limites pintados ficam separados da caixa de layout quando há strokes,
pontas de linhas ou sombras externas. Imagens e snapshots têm padding zero,
sem reaplicar Auto Layout interno nem recortar duas vezes um asset já composto.
Linhas posicionadas e giradas dentro de um pai sem rotação usam a caixa já
transformada e os limites pintados do Figma. Isso mantém os braços de ícones
como `+` alinhados, inclusive quando um eixo da linha tem dimensão zero,
sem aplicar a rotação duas vezes nem cortar as pontas.
TILE usa os pixels naturais da imagem multiplicados pelo fator do Figma.
Assets idênticos são reaproveitados sem duplicar bytes no pacote.

Gradientes lineares horizontais e verticais preservam em CSS a transformação,
os pontos de parada e o alfa individual de cada cor, inclusive transparência
zero e fades que começam ou terminam no meio da camada. Uma borda com gradiente
usa uma camada CSS mascarada independente do fundo: o brilho pode desaparecer
no contorno inferior sem reduzir a opacidade do botão, cobrir seu preenchimento
ou transformar seu texto em imagem. Sombras internas e externas mantêm seus
deslocamentos, blur, spread e transparência; a borda uniforme retornada pelo CSS
nativo do Figma não substitui essa pintura.

Em containers, gradientes e pinturas complexas podem virar **somente um fundo
PNG**, mantendo filhos, textos e layout editáveis. O plugin cria um retângulo
auxiliar com as mesmas dimensões, fills e modos de variables, exporta sua pintura
e o remove ao terminar, cancelar ou fechar. Nenhuma camada original é clonada,
movida ou alterada para produzir esse fundo. Se o runtime impedir a amostragem,
o diagnóstico identifica a aproximação em CSS. Os fills desse fundo passam a ser um asset, não
controles individuais de gradiente no Builder.

A prévia é local e isolada, sem scripts ou rede. A referência PNG do Figma é
opcional, limitada em tamanho e tempo; não entra no clipboard nem substitui o
conteúdo editável. Os diagnósticos permitem localizar uma camada sem alterar a
seleção que originou o pacote.

## Fontes

O Figma informa a família e o estilo, mas não fornece automaticamente o binário
da fonte. O plugin mantém a família exata como primeira opção e adiciona um
fallback web seguro.

Google Fonts são reconhecidas pelo catálogo completo da plataforma ao colar,
sem lista restrita de famílias. O Builder registra família, variantes e eixos
em dependências do projeto, carrega a fonte no canvas e a mostra no seletor,
preservando a configuração ao salvar, reabrir e publicar. Fontes anexadas ou
locais já presentes têm prioridade sobre a versão do Google com o mesmo nome.
Falhas de rede ou famílias não reconhecidas são avisadas sem trocar o nome
original no CSS. Essa configuração usa o serviço hospedado do Google; não
depende de uma instalação prévia na biblioteca da conta.

As requisições seguem a [API CSS2 do Google Fonts](https://developers.google.com/fonts/docs/css2):
variantes estáticas usam apenas os pares peso/estilo existentes; intervalos
variáveis dependem dos eixos publicados no catálogo. Isso evita pedidos de
itálico ou de pesos inexistentes que fariam a fonte inteira falhar no navegador.

A prévia offline do plugin continua usando apenas os binários anexados. Para
fontes privadas ou quando desejar a tipografia exata também nessa prévia, anexe uma face licenciada
`.woff2`, `.woff`, `.ttf` ou `.otf` depois da conversão. Prefira WOFF2 e use um
arquivo por combinação de família, peso e estilo. O arquivo só entra no pacote
preparado; anexá-lo não copia o conteúdo automaticamente.

Use apenas fontes cuja licença permita incorporação em páginas web.

## Pacote de transferência compatível

O clipboard recebe JSON em texto simples com esta estrutura principal:

```text
signature, version, source, exportId,
exportedAt, documentName, pageName,
html, css,
assets, fonts, fontUsage, variables, stats, warnings
```

O motor trabalha internamente com o schema v5 e `JSON_REST_V1`, mas a interface
projeta no clipboard o contrato compilado v4, aceito tanto pelo Builder publicado
quanto pelo receptor novo. A cena REST, as opções internas e a proveniência não
são copiadas: responsividade, geometria e semântica já estão materializadas no
HTML e CSS.

Todos os assets são resolvidos antes da importação. O Kodety valida o pacote
inteiro e aplica HTML, CSS, imagens, fontes, variables e arquivos em uma
transação única. Essa separação evita que uma evolução interna do conversor
invalide a colagem em uma instalação do Builder ainda na versão anterior.

## Privacidade e segurança

- toda conversão acontece no runtime local do plugin;
- o manifesto declara `networkAccess.allowedDomains: ["none"]`;
- nenhum bridge ou servidor é iniciado;
- nenhuma credencial do Figma é solicitada ou armazenada;
- links, atributos, CSS, SVGs e caminhos de assets são novamente validados pelo
  Kodety antes do commit;
- o clipboard só é acessado por um gesto explícito;
- o download manual do JSON permanece disponível para inspeção e recuperação.

## Limites e diagnóstico

Para proteger o Figma e o Builder, o exportador limita:

- até 100.000 layers;
- até 10.000 assets;
- até 64 MB de assets exportados;
- até 92 MB no JSON enviado ao clipboard;
- até 16 MB de snapshot REST V1 processado internamente;
- quantidade total e por layer de ranges de rich text.

Layouts grandes são processados em lotes. Se o snapshot REST exceder o limite
permitido, ele ainda pode orientar a conversão, mas não é incorporado ao pacote.
Erros fatais interrompem a exportação; aproximações recuperáveis aparecem no
diagnóstico.

## Instalação para desenvolvimento

1. Abra o Figma Desktop.
2. Acesse **Plugins → Development → Import plugin from manifest…**.
3. Selecione `FigmaPlugin/manifest.json`.
4. Abra um arquivo de design e execute **Figma to Kodety**.

O `id` atual identifica este pacote. Antes de uma publicação nova na Figma
Community, confirme o identificador atribuído à organização responsável.

## Testes e pacote oficial

Na raiz do repositório, execute:

```bash
npm run figma-plugin:test
```

A suíte cobre o motor v5, o envelope de clipboard v4 compatível,
`JSON_REST_V1`, Auto Layout, constraints, semântica, os três modos responsivos,
segurança do receptor e a separação obrigatória entre converter e copiar.
Inclui regressões de mídia, fundos, geometria e transparência de gradientes,
bordas mascaradas preservadas pelo importador real, tipografia variável,
grid/mobile, prévia isolada e comparação de pixels de SVG complexo antes/depois
da importação.

Com o Chromium do Playwright já disponível, a regressão visual adicional gera
o botão pelo conversor real, mede seus pixels e salva capturas temporárias:

```bash
npm run figma-plugin:test:visual
```

Para validar e gerar o ZIP oficial:

```bash
npm run figma:zip
```

O único artefato oficial gerado é:

```text
FigmaPlugin/dist/figma-to-kodety.zip
```

O diretório `FigmaPlugin/bridge/` permanece no repositório apenas como legado
histórico. Ele não aparece no manifesto, não é iniciado pelo plugin e não é
incluído no pacote oficial.

O ZIP usa data, permissões, ordem e compressão fixas para permitir builds
reproduzíveis. Preserve `THIRD_PARTY_NOTICES.md` em toda distribuição.

## Limitações conhecidas

- recursos sem equivalente HTML/CSS podem exigir SVG ou PNG;
- bordas com gradiente e tracejado ou corner smoothing usam uma aproximação
  diagnosticada; gradientes oblíquos e pinturas mais complexas podem usar um
  imagem de pintura, mantendo o conteúdo separado e editável;
- bordas pintadas externas/centralizadas combinadas com clipping de filhos
  exigem um snapshot nativo da camada para não cortar o contorno; o diagnóstico
  informa a perda de edição individual do conteúdo nesse caso;
- recortes nativos de GIF animado preservam um quadro, com diagnóstico; GIFs
  simples permanecem com seus bytes originais;
- limites pintados sob ancestrais rotacionados ou inclinados ainda exigem
  conferência visual, assim como efeitos que dependem de conteúdo externo;
- fontes anexadas continuam sujeitas à licença original;
- a inferência inteligente só é aplicada quando a geometria é inequívoca;
- estados interativos, animações e lógica de aplicação não são deduzidos de uma
  imagem estática;
- a garantia pixel perfect deve ser avaliada no viewport original; adaptações
  responsivas são transformações intencionais e aparecem no CSS gerado.
