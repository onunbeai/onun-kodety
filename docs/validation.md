# Verificação da preparação — 2026-09-29

## Verificações executadas

`npm run verify` concluído com sucesso em 2026-09-29, incluindo os dois builds finais.

- TypeScript do repositório e sintaxe PHP dos 62 arquivos do plugin.
- 73 testes Node de acesso open source, preservação da exportação, biblioteca de projetos, Agent e segurança de diretórios.
- Runtimes PHP isolados: licença offline, atualizações locais, permissões, salvamento incremental e publicação transacional com falhas/retries simulados.
- Motion em Chromium real: reprodução, reversão, keyframes, seek, callbacks, repetição/yoyo, stagger, easing, scroll, hover, ponteiro, texto, preview e preservação de globais do site.
- 14 transições Motion em HTML exportado, incluindo histórico, movimento reduzido e fallback sem View Transitions.
- Preview com documentos em buffer: promoção somente após prontidão visual, interpolação real, cancelamento de navegação anterior, mensagens antigas ignoradas e limpeza ao desmontar.
- Splitter de texto nativo com graphemes, palavras/linhas e restauração de DOM/listeners.
- Smoke do editor HTML sem conta: criar projeto local, abrir Builder e recarregar, sem chamadas aos serviços privados nem erros JavaScript.
- Regressões adicionais de editor HTML, publicação de animações, primeira pintura, interações, Agent, analytics e mídia.
- Estabilidade validada por segmentos, incluindo 70 casos de CSS e 84 combinações de viewport em Chromium, além de WebKit.
- Consistência de `package-lock.json` com `npm ci --dry-run --ignore-scripts --offline`.

## Limites da validação

A suíte ampliada `npm test` foi investigada e os grupos relevantes foram executados; não houve uma execução única completa dessa cadeia após todas as adaptações. Alguns testes herdados verificam detalhes textuais de implementação e exigem manutenção separada quando a interface muda.

Não foi instalada esta edição em um WordPress/MySQL real. Os runtimes PHP usam ambientes isolados de teste. Integrações com provedores externos, hospedagens, contas de IA e serviços de terceiros não foram exercitadas com credenciais reais.

Um teste herdado de CMS encontrou limitações do próprio harness no fluxo de redirecionamento de autolocalização (`get_theme_root`/campos de settings ausentes). Esse teste não integra o gate `verify`; a validação desse fluxo em WordPress real permanece pendente.

## Gate reproduzível

`npm run verify` executa tipos/PHP, os testes open source, a suíte Motion e builds do plugin WordPress e da aplicação HTML. O workflow `.github/workflows/ci.yml` executa esse mesmo comando.
