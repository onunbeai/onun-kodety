# Preparação do Onun Kodety

## Escopo

Cópia independente do código atual do Kodety para um projeto de editor visual HTML e WordPress da Onun. O repositório original foi mantido intacto. A nova cópia começa com um histórico Git próprio, sem remoto pessoal nem envio ao GitHub.

## Limpeza

- Backups, arquivos ZIP, builds duplicados, artefatos locais e dependências instaladas não fazem parte do Git.
- Painel comercial privado, Agent Gateway privado, integração de contas/projetos na nuvem Kodety e documentos operacionais antigos foram retirados.
- Conteúdo e ferramentas de entrega de clientes (Deckdocs/Rubrika) foram retirados.
- Ativação por serial, avaliação temporária, planos pagos, upsell e atualizações pelo servidor comercial foram removidos dos fluxos do produto.
- Autenticação WordPress, permissões, nonces, controle de revisão e autenticação dos provedores configurados pelo usuário foram preservados.
- Cursores extraídos do macOS foram substituídos por cursores nativos.
- Nome público: **Onun Kodety**. Identificadores de API/armazenamento e versões do código de origem foram preservados para compatibilidade.

## Animações

O GSAP e seus plugins foram substituídos pelo núcleo MIT do **Motion 13.4.5**. O formato de documento de interações V2 foi preservado; o motor do projeto usa Motion para reprodução, mistura de valores e easing, com adaptação para timeline, scroll, texto, preview e exportação.

Transições de página usam `Motion.animateView` com a View Transition API e `Motion.animate` como fallback. O preview usa Motion sobre os dois documentos em buffer. Existem 14 presets, incluindo blur com zoom, revelação circular e cortina. Nenhum recurso Motion+ foi incorporado.

Código JavaScript autoral que usa APIs específicas do GSAP fora do contrato de interações pode exigir migração manual; o editor não inclui mais a biblioteca. Scripts que pertencem aos sites importados não são reescritos indiscriminadamente.

## Licenças e serviços

Código próprio: GPL-3.0-only. O Ycode é creditado pela base de partes do projeto, principalmente na arquitetura; sua licença MIT e autoria estão preservadas em `licenses/YCODE-LICENSE.md`. Licenças de terceiros ficam preservadas; veja `THIRD_PARTY_NOTICES.md`. WebContainers e provedores externos são integrações opcionais com termos próprios. Eles não são necessários para abrir o editor HTML ou exportar um projeto.

## Publicação no GitHub

Destino da publicação: [onunbeai/onun-kodety](https://github.com/onunbeai/onun-kodety), na organização **Onun be AI**. A publicação foi solicitada pelo mantenedor após a preparação local.

## Validação

O registro final das verificações desta preparação está em `docs/validation.md`. Testes PHP isolados não substituem uma instalação real do plugin em WordPress. Recursos de serviços externos exigem credenciais próprias para uma validação integrada.
