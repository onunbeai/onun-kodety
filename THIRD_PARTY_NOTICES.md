# Componentes de terceiros

A GPL-3.0-only do Onun Kodety aplica-se ao código próprio deste repositório. Bibliotecas, fontes, ícones e outros ativos de terceiros conservam suas licenças e atribuições originais.

- **Ycode**: partes do projeto foram desenvolvidas com base no [repositório open source](https://github.com/ycode/ycode), principalmente quanto à arquitetura do editor. Copyright (c) 2026 Ycode; licença MIT integral em [licenses/YCODE-LICENSE.md](licenses/YCODE-LICENSE.md).
- **WordPress Playground**: GPL-2.0-or-later (`@wp-playground/client`).
- **Solar Icons**: CC-BY-4.0; wrapper React MIT. Atribuição em `Wordpress/kodety/THIRD_PARTY_NOTICES.txt` e `FigmaPlugin/THIRD_PARTY_NOTICES.md`.
- **Keyline Icons**: MIT; texto em `components/ui/KEYLINE-ICONS-LICENSE.txt`.
- **vanilla-cookieconsent**: MIT; texto em `lib/html-editor/vendor/vanilla-cookieconsent/LICENSE`.
- **Kodety Rocket e dependências PHP**: licenças preservadas em `Ecossistema do Codet/kodety-rocket/`.
- Demais dependências npm: consulte os respectivos arquivos `LICENSE` e `package.json` instalados com `npm ci`.

Serviços externos configurados pelo usuário possuem termos próprios. A licença do código do cliente não concede acesso a um serviço hospedado por terceiros.

## Motion e serviços opcionais

**Motion** substitui GSAP, CustomEase e ScrollTrigger como motor do editor. O núcleo `motion` é MIT; o texto integral está em `licenses/MOTION-LICENSE.md`. A edição não usa recursos pagos de Motion+.

**WebContainers**: o pacote cliente `@webcontainer/api` informa MIT, mas o runtime hospedado tem termos separados e exige licença para determinados usos comerciais em produção. Consulte https://webcontainers.io/enterprise. O Agent no navegador é opcional; o editor visual e a exportação HTML não dependem de ativar esse serviço.
