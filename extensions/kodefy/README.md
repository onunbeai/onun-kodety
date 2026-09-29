# Kodefy — Shopify Commerce para Kodety

Extensão instalável que mantém o front no WordPress/Kodety e usa a Shopify
como fonte de produtos, variantes, estoque, carrinho e checkout.

## Fluxo

1. Atualize o núcleo Kodety para 1.36.2 ou superior.
2. Instale e ative `kodefy-shopify.zip` em **Kodety → Extensões**.
3. No topo do Builder, abra **Templates** e escolha **Kodefy Commerce** para carregar o ecommerce inteiro.
4. No topo do Builder, abra **Kodefy** e informe `loja.myshopify.com` e um token Storefront criado no canal Headless.
5. Personalize as páginas. O download manual do kit ZIP continua disponível como alternativa.
6. Publique o projeto no WordPress.

O runtime usa somente operações GraphQL allowlisted. Tokens nunca entram no
HTML do projeto. Um token público ou privado da Storefront API pode ser salvo;
ambos passam pelo proxy WordPress da extensão.

Depois de conectar a loja, a extensão cria no CMS as collections somente leitura
**Produtos Shopify** e **Coleções Shopify**. Elas são atualizadas automaticamente
pela Shopify e alimentam páginas, sitemap e bindings server-side sem edição manual.

## Componentes do kit

- vitrine e coleção;
- card de produto;
- página de produto com variantes, galeria e estoque;
- carrinho lateral e página de carrinho;
- busca;
- favoritos locais;
- acesso à conta Shopify;
- políticas, estados vazios e página 404;
- slider nativo do Kodety.

Os contratos são marcados com atributos `data-kodefy-*`, mantendo classes e
estrutura editáveis. Produto e coleção usam rotas virtuais
`/products/{handle}/` e `/collections/{handle}/`, resolvidas para os templates
`product.html` e `collection.html`.

## Projetos com Liquid

O suporte a Liquid pertence ao Builder e não a um tema empacotado na extensão.
ZIPs e pastas que contenham `layout/theme.liquid` podem ser importados pelo fluxo
normal. O Builder preserva os arquivos Liquid, cria prévias editáveis das
sections e o comando comum **Exportar projeto ZIP** recompõe automaticamente os
arquivos originais. Alterações diretas no código Liquid têm prioridade sobre a
prévia visual.

O ZIP instalável da extensão não incorpora temas Shopify ou temas de terceiros.

Documentação oficial:

- <https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/getting-started>
- <https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage>
- <https://shopify.dev/docs/storefronts/themes/architecture>
- <https://shopify.dev/docs/storefronts/themes/tools/theme-check>
