# Qualidade local e release WordPress

`package.json` mantém duas identidades explícitas: `version` é a versão SemVer do workspace npm e deve acompanhar o `package-lock.json`; `kodety.wordpressVersion` é a versão literal da distribuição WordPress e deve existir no cabeçalho `Version`, em `KODETY_VERSION` e no changelog. Essa separação impede o npm de normalizar sequências públicas como `1.1.01` para `1.1.1`.

## Comandos

- Use Node.js 22.12+ LTS para os gates locais. O campo `engines` aceita as
  linhas pares suportadas 22, 24 e 26; versões 18/20 ficam fora do contrato
  porque o toolchain atual já não oferece um baseline comum nelas.
- `npm run wordpress:version:check`: falha sem alterar arquivos se as versões divergirem.
- `npm run wordpress:version:sync`: atualiza o bootstrap do plugin para `kodety.wordpressVersion`.
- `npm run wordpress:bundle:test`: impede que páginas leves voltem a importar chunks pesados do Builder e aplica um orçamento de bundle.
- `npm run wordpress:integration-boundary:test`: garante que Airtable, captura
  legada de thumbnail e sua dependência não voltem às fontes WordPress.
- `npm run wordpress:browser-runtime-boundary:test`: varre todo JavaScript
  efetivamente distribuído no plugin, Membership, Localization e File System;
  rejeita rotas `/kodety/api/` e módulos browser/backend legados, com
  distribuição e arquivo no diagnóstico.
- `npm run wordpress:performance:test`: mede os fechamentos estáticos
  de Builder, Settings, CMS, Analytics, Email, Localization, File System e
  component compiler, com limites raw/gzip/Brotli, número de chunks e maior
  chunk. O comando lê a árvore já compilada; ele não a regenera nem certifica
  que os assets estejam atuais em relação às fontes.
- `npm run wordpress:performance:self-test`: exercita budgets e a coleta de
  closure/JS/CSS/assets usando fixtures temporárias, sem depender de um build.
- `npm run wordpress:performance:report`: grava o inventário
  reproduzível e os arquivos acima de 100 KiB em
  `artifacts/kodety-hardening/front-06/`.
- `npm run wordpress:observability:test`: valida no browser e no PHP que a instrumentação
  permanece sem efeitos quando desligada, usa somente campos permitidos e não
  vaza URLs, caminhos, payloads, nonces ou mensagens de erro.
- `npm run wordpress:e2e:contract:test`: valida o contrato e as
  proteções do smoke test instalado sem exigir navegador ou credenciais.
- `npm run wordpress:e2e:installed`, `npm run wordpress:e2e:release` e
  `npm run wordpress:e2e:performance`: executam respectivamente o smoke rápido,
  o smoke que torna a publicação obrigatória e o perfil cold/warm no WordPress
  autorizado. O comando de release ainda exige a autorização independente
  `KODETY_E2E_ALLOW_PUBLISH=1`; nenhum deles inventa ambiente ou credenciais.
- `npm run wordpress:hardening:focused:test`: agrega os gates funcionais
  críticos entregues pelas Frentes 01–05: componentes, page transitions,
  referências/remoção segura de assets, wiring de observabilidade e a
  regressão transacional de publicação/colisão de rota.
- `npm run wordpress:quality:test`: agrega boundary, observabilidade, E2E
  estrutural, self-test de budgets e o hardening focado acima.
- `npm run wordpress:package:test`: testa contratos de versão, manifest,
  caminhos permitidos e empacotamento; as asserções de runtime compilado são
  repetidas obrigatoriamente depois do build canônico.
- `npm run wordpress:preflight`: valida uma árvore já compilada, incluindo artefatos obrigatórios e todos os arquivos citados pelo manifest do Vite.
- `npm run wordpress:php-lint`: executa `php -l` em todo PHP distribuído.
- `npm test`: executa contratos TypeScript/JavaScript e runtimes PHP sem gerar o ZIP.
- `npm run ci:local`: valida tudo, executa a suíte pré-build com Forms em modo
  source-only, faz duas compilações completas do plugin, compara o runtime
  copiado no pós-build e confirma a reprodutibilidade do ZIP.

## Camadas de validação

O ciclo rápido roda contratos, type-check e testes focados sem compilar ou
empacotar. O smoke instalado roda Playwright contra uma instalação WordPress
descartável, com URL e credenciais fornecidas apenas pelo ambiente; publicação
é opt-in e nunca acontece por padrão. O gate de release só começa depois que as
frentes de implementação estabilizam e então executa build, budgets sobre os
assets recém-gerados, smoke instalado, empacotamento e verificação de
reprodutibilidade.

O empacotador do plugin valida o runtime de formulários imediatamente após o
Vite e antes de inspecionar o bundle. O agregador de distribuições recompila a
extensão Localization e o plugin File System, executa o boundary sobre todos
os runtimes de browser distribuídos, exige sidecars de módulos correspondentes
aos manifests atuais, grava o relatório de performance e conclui a validação local dos pacotes; qualquer runtime legado, sidecar stale ou budget vermelho
interrompe essa promoção. Como o
smoke depende de WordPress/MySQL/Chromium e segredos efêmeros, ele permanece um
job instalado separado e não é mascarado como sucesso pelo `ci:local` sem
credenciais.

Consulte `docs/guides/wordpress-installed-e2e.md` para as variáveis, perfis e
comandos do smoke. Sem uma instalação acessível e credenciais temporárias, o
resultado correto é registrar o smoke e as cinco medições cold/warm como
pendentes; não se substitui esse dado por estimativas.

## Garantias do empacotamento

O comando `npm run wordpress:build` usa somente as dependências locais instaladas, valida a árvore antes de compactar e grava o arquivo versionado, como `Wordpress/dist/1_0_16.zip`, de forma atômica. Não é criado um `kodety.zip` intermediário. A release anterior permanece intacta se build, validação ou compactação falhar.

Os arquivos entram no ZIP em ordem lexical, com timestamp e permissões normalizados. Ao final, o script reabre o arquivo, verifica CRC, lista de entradas, conteúdo e versão, e informa o SHA-256.

O preflight bloqueia travessia de diretório, links simbólicos, segredos (`.env`, chaves e certificados privados), metadados locais, árvores de teste/dependências, source maps e temporários. Também bloqueia manifest vazio ou inconsistente, artefatos obrigatórios ausentes/vazios e divergência entre as versões do pacote e do plugin.

## Fluxo recomendado de release

1. Atualize `version`/lockfile quando houver uma release do workspace e defina a versão pública literal em `kodety.wordpressVersion`.
2. Execute `npm run wordpress:version:sync`.
3. Adicione a entrada correspondente em `Wordpress/kodety/changelog.json`.
4. Confirme `npm run wordpress:test-publish-sync`: o caso `about.html` +
   `about/index.html` deve falhar com `project-page-route-collision` antes da
   ativação e preservar byte a byte os arquivos/metadados da release anterior.
5. Execute `npm run wordpress:quality:test`. O agregador inclui explicitamente
   `html-components:test`, `page-transitions:test`, as duas regressões de
   assets, o wiring de observabilidade e `wordpress:test-publish-sync`.
6. Execute **uma única vez** `npm run ci:local`. Esse é o build determinístico
   de release: ele gera o ZIP versionado e as extensões, recompila File System,
   mede os outputs atuais e compara duas compilações onde o packager declara
   determinismo. Não rode `wordpress:build` depois dele.
7. Registre imediatamente versão, caminho, tamanho e SHA-256 do ZIP principal;
   instale exatamente esses bytes no WordPress descartável, sem copiar fontes
   avulsos para a instalação.
8. Confirme o preflight de paridade e execute a matriz instalada:

   ```bash
   KODETY_AUTH_MATRIX_ALLOW_TEMP_USERS=1 WP_ENVIRONMENT_TYPE=local \
     wp --path=/path/to/wordpress eval-file \
     /path/to/repository/Wordpress/tests/installed-authorization-matrix.php
   ```

9. Contra essa mesma instalação e sem novo build, execute small/large/legacy
   pelo runner documentado de performance. Rode o smoke rápido quando útil e,
   no fechamento, `KODETY_E2E_ALLOW_PUBLISH=1 npm run wordpress:e2e:release`
   para tornar ACK + validação pública anônima obrigatórios.
10. Rode `npm run wordpress:update:prepare`, confira que ele referencia o mesmo
    SHA-256 registrado e publique exatamente esse ZIP pelo painel de Releases;
    o comando não cria `latest.json` local.
