![Onun Kodety — editor visual para HTML e WordPress](docs/assets/readme-cover.png)

# Onun Kodety — Open Source Alternative to Framer & Webflow

Editor visual de sites para **HTML, CSS, JavaScript e WordPress**, desenvolvido pela Onun como uma alternativa aberta ao Framer e ao Webflow.

Crie e edite projetos HTML no navegador ou em uma pasta local, exporte seus arquivos e use o plugin para editar e publicar em uma instalação WordPress própria. O código próprio é licenciado sob **GPL-3.0-only**. Não há ativação comercial, serial ou conta Kodety obrigatória nesta edição.

As animações e transições de página usam **Motion**, com núcleo MIT. O preview e o HTML exportado compartilham os presets, incluindo blur com zoom, revelação circular e cortina. O motor respeita movimento reduzido e oferece fallback para navegadores sem View Transitions.

## Desenvolvimento local

Requisitos: Node.js 22.12+ (ou 24/26), npm e PHP 8.0+ para verificar/empacotar WordPress.

```sh
npm ci
npm run dev
```

Abra o endereço local informado pelo Vite. Para usar projetos WordPress no navegador (Playground), gere primeiro o plugin com `npm run wordpress:zip:plugin`. O editor HTML pode usar armazenamento do navegador; a opção de pasta requer um navegador compatível com File System Access. Exporte seus projetos para ter uma cópia fora do armazenamento do navegador.

## Builds

```sh
# Plugin WordPress instalável
npm run wordpress:zip:plugin

# Plugin + aplicação HTML para hospedagem própria
npm run build

# Servidor da aplicação compilada
npm start
```

O plugin é gerado em `Wordpress/dist/<versão_com_underscores>.zip`. Instale-o pelo painel de plugins de uma instalação WordPress 6.4+; a rota do editor permanece `/kodety` por compatibilidade. A aplicação web compilada fica em `WebApp/kodety-studio/dist/`.

O editor WordPress exige um usuário autorizado na instalação. Integrações externas e provedores de IA usam as credenciais e a infraestrutura configuradas pelo usuário e podem ter custos próprios.

## Verificações

```sh
npm run verify

# Suíte ampliada de regressões do editor
npm test
```

Os testes de navegador precisam do Chromium do Playwright (`npx playwright install chromium`). Testes contra uma instalação WordPress real requerem configuração local; veja `docs/guides/wordpress-installed-e2e.md`.

## Estrutura

- `app/(builder)/kodety/html-editor/`: interface do editor visual.
- `lib/html-editor/`: edição, parser, CSS, projetos, preview e publicação.
- `WebApp/kodety-studio/`: aplicativo HTML local e servidor para hospedagem própria.
- `Wordpress/kodety/`: plugin PHP, autenticação, APIs e publicação WordPress.
- `Wordpress/editor/`: entrada React do editor WordPress.
- `packages/`: SDK, componentes e bridges compartilhadas.
- `ChromeExtension/` e `FigmaPlugin/`: integrações e fontes compartilhados.

Identificadores internos como `kodety`, `KODETY_*` e `@coday/*` foram preservados para compatibilidade com projetos e integrações existentes.

## Contribuir e publicar

Leia [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) e o [registro de preparação](docs/open-source-preparation.md).

Projeto da [**Onun**](https://github.com/onunbeai). Esta edição possui histórico Git independente; o histórico do projeto privado não acompanha o código aberto.

## Créditos e agradecimentos

Partes do Onun Kodety foram desenvolvidas com base no repositório open source do [Ycode](https://github.com/ycode/ycode), principalmente em aspectos da arquitetura do editor. Agradecemos à equipe e à comunidade do Ycode por compartilharem esse trabalho.

O código proveniente do Ycode mantém sua licença MIT e seus avisos de autoria, preservados em [licenses/YCODE-LICENSE.md](licenses/YCODE-LICENSE.md). As contribuições próprias do Onun Kodety são distribuídas sob GPL-3.0-only.

## Licença

Código próprio: [GNU GPL v3.0](LICENSE), SPDX `GPL-3.0-only`. Dependências e ativos de terceiros conservam seus próprios termos; veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
