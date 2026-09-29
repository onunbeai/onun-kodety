# Fixture instalada de estabilidade

Esta fixture leve tem duas páginas, dois blocos dentro de `main`, título editável, cor `#112233` e opt-in de Canvas Infinito Beta. O seed usa os arquivos desta pasta e mapeia `project.json` para `.incode/project.json` no ZIP. Não contém credenciais ou conteúdo de clientes.

O runner `scripts/test-wordpress-stability-installed.mjs` exige um WordPress **descartável**, instalado em uma pasta cujo nome começa com `kodety-stability-wp-`, com banco próprio cujo nome começa com `kodety_stability_`, URL em `127.0.0.1`, usuário administrador de teste e WP-CLI/PHP disponíveis. Prepare esse WordPress com `wp config create`, `wp db create` e `wp core install`, usando conexão e senha exclusivas de teste. Nunca aponte para uma instalação existente de produção.

Mantenha um JSON de ambiente **fora da pasta servida por HTTP**, em diretório `0700` e arquivo `0600`, com estas chaves:

- `KODETY_STABILITY_WP_ROOT`: caminho absoluto da instalação descartável.
- `KODETY_E2E_BASE_URL`: origem, por exemplo `http://127.0.0.1:52670`.
- `KODETY_E2E_USER` e `KODETY_E2E_PASSWORD`: administrador de teste.
- `KODETY_E2E_LOGIN_URL`: opcional; o runner descobre a rota real com `wp_login_url()`.

Instale o Chromium com `npx playwright install chromium` se ainda não estiver disponível. Inicie o servidor PHP/WordPress na origem configurada, com suporte a permalinks. Não disponibilize JSON de ambiente, cookies, logs ou resultados pelo servidor HTTP.

Execute na raiz do repositório, informando o hash do ZIP que será homologado:

```sh
node scripts/test-wordpress-stability-installed.mjs \
  --environment /private/tmp/kodety-stability-secrets/test-environment.json \
  --plugin-zip /caminho/do/candidato.zip \
  --expected-sha256 HASH_SHA256_DO_ZIP \
  --output /private/tmp/kodety-stability-results
```

O runner instala/ativa somente esse ZIP, executa o seed rastreável `scripts/fixtures/stability-stage-project.php` e percorre as jornadas reais da UI: texto, cor, salvar/reabrir, excluir até `main`, desfazer/refazer e menu da logo → Criar novo. Na última jornada, o servidor recebe o ZIP, o ACK é deliberadamente perdido e a gravação local falha por quota. Um contador confirma que a exceção de quota realmente ocorreu. O teste verifica o novo projeto reaberto e os arquivos do ZIP remoto.

A medição realiza 100 cliques reais por carregamento, em cinco carregamentos por modo (convencional e infinito), com cinco aquecimentos explícitos por carregamento. O runner identifica somente o iframe interativo, excluindo buffers `inert` ou `aria-hidden`, e aguarda sua promoção antes de medir. A prontidão aceita um `main` vazio com altura zero, mantendo o iframe pintado e sem tela de carregamento ou erro. O polling de observação fica fora do iframe porque Design suspende temporizadores e animações autorais. Os relógios são nativos do navegador; o relatório separa destaque, mensagem de identidade, oportunidade de pintura e detalhes computados. O duplo `requestAnimationFrame` delimita uma oportunidade de pintura, sem medir a apresentação do compositor. Esta fixture não homologa projetos grandes, legado ou uso prolongado.

`--skip-selection-measurement` permite repetir somente as jornadas funcionais. `--only-selection` executa somente a medição; `--measurement-sessions` e `--measurement-samples` permitem uma rodada curta de diagnóstico, mantendo cinco sessões de 100 ações como padrão. `--only-create --skip-selection-measurement` isola a recuperação de criação. Rodadas curtas não substituem a medição completa. `--keep-fixture` evita executar o seed; utilize apenas quando o estado instalado ainda for adequado ao teste. O resultado fica em `report.json`; falhas geram `failure.png`. O runner remove a senha das mensagens de erro e não gera HAR, vídeo ou trace autenticado.

Após a validação, pare o servidor, remova apenas o banco descartável com `wp --path=RAIZ_DESCARTAVEL db drop --yes` e descarte os diretórios temporários de WordPress, credenciais e resultados.
