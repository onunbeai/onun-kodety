# E2E com WordPress instalado

Os três perfis (small, large e legacy) cobrem a lacuna entre contratos Node/PHP e um WordPress real. O smoke valida o fluxo funcional; o perfil de performance mede carregamento. Ambos rodam contra um ZIP e fixtures já instalados por um setup autorizado. Nenhum deles cria usuário, redefine senha, inventa credenciais ou instala projeto implicitamente.

## Estado e pré-requisitos

- Use Node.js 22.12+, 24 ou 26. A matriz recusa versões fora dessa faixa para manter o ambiente de release explícito.
- `@playwright/test` está fixado exatamente em `1.62.1` no pacote e no lock. Para reproduzir a instalação: `npm install --save-dev --save-exact @playwright/test@1.62.1`.
- Instale o Chromium correspondente com `npx playwright install chromium`. Os browsers ficam no cache do runner/usuário, sempre fora do Git.
- Use WordPress/MySQL descartável ou staging expressamente autorizado. O usuário precisa ser administrador; publicação continua opt-in.

Prepare uma instalação WordPress descartável própria, instale o ZIP gerado a partir desta cópia e forneça URL e credenciais somente por variáveis de ambiente. Os testes instalados não são executados nem certificados por uma compilação local.

## Ambiente compartilhado

Defina sem valores padrão no repositório:

```bash
export KODETY_E2E_BASE_URL='http://localhost:8080/'
export KODETY_E2E_USER='<USUARIO_TEMPORARIO>'
export KODETY_E2E_PASSWORD='<SENHA_TEMPORARIA>'
export KODETY_E2E_SMALL_PROJECT_FINGERPRINT='<SHA256_FIXTURE_SMALL>'
export KODETY_E2E_LARGE_PROJECT_FINGERPRINT='<SHA256_FIXTURE_LARGE>'
export KODETY_E2E_LEGACY_PROJECT_FINGERPRINT='<SHA256_FIXTURE_LEGACY>'
export KODETY_E2E_INSTALLED_FINGERPRINT_URL='http://localhost:8080/wp-json/kodety-e2e/v1/fixture-receipt'
```

`KODETY_E2E_LOGIN_URL` pode informar um slug de login personalizado. Sem ele, o harness deriva `wp-login.php`. Redirect final e `form.action` são verificados antes do preenchimento da senha; POST cross-origin é bloqueado. Login, Builder e workspaces permanecem na mesma origem.

URLs opcionais, relativas à base ou absolutas na mesma origem:

- `KODETY_E2E_BUILDER_URL`, `KODETY_E2E_SMALL_BUILDER_URL`, `KODETY_E2E_LARGE_BUILDER_URL`, `KODETY_E2E_LEGACY_BUILDER_URL`;
- `KODETY_E2E_PUBLISHED_URL`;
- `KODETY_E2E_SETTINGS_URL`, `KODETY_E2E_CMS_URL`, `KODETY_E2E_ANALYTICS_URL`;
- `KODETY_E2E_LOCALIZATION_URL`, `KODETY_E2E_EMAIL_URL`, `KODETY_E2E_FILE_SYSTEM_URL`.

## Smoke funcional

O smoke autentica, prova a fixture pelo receipt, abre o Builder, edita texto no iframe e estilo pelo Inspector, exige ACKs de autosave com `workspaceRevision`, recarrega, confere as duas persistências e abre Settings, CMS, Analytics, Localization, Email e File System. Cada superfície precisa sair do loading real. O alvo editável pode ser estabilizado com `KODETY_E2E_CANVAS_SELECTOR` e `KODETY_E2E_TEXT_SELECTOR`; o fallback é o primeiro `h1, p` visível. A fixture também precisa definir `KODETY_E2E_STYLE_CONTROL_SELECTOR`, `KODETY_E2E_STYLE_PROPERTY`, `KODETY_E2E_STYLE_VALUE` e o valor normalizado esperado em `KODETY_E2E_STYLE_EXPECTED_COMPUTED_VALUE`.

Execute uma fixture por vez:

```bash
KODETY_E2E_PROJECT_PROFILE=small \
KODETY_E2E_SMALL_BUILDER_URL='http://localhost:8080/kodety/editor/' \
KODETY_E2E_PROJECT_FIXTURE='small-configured' \
npm run wordpress:e2e:installed

KODETY_E2E_PROJECT_PROFILE=large \
KODETY_E2E_LARGE_BUILDER_URL='http://localhost:8080/kodety/editor/' \
KODETY_E2E_PROJECT_FIXTURE='large-configured' \
npm run wordpress:e2e:installed

KODETY_E2E_PROJECT_PROFILE=legacy \
KODETY_E2E_LEGACY_BUILDER_URL='http://localhost:8080/kodety/editor/' \
KODETY_E2E_PROJECT_FIXTURE='legacy-configured' \
npm run wordpress:e2e:installed
```

`KODETY_E2E_PROJECT_FIXTURE` é apenas uma anotação redigida. A prova é o GET autenticado e same-origin do receipt: perfil e SHA-256 precisam corresponder à fixture esperada antes de o Builder abrir. O setup deve instalar/restaurar a fixture antes do comando.

### Publicação opt-in

```bash
KODETY_E2E_ALLOW_PUBLISH=1 \
KODETY_E2E_PUBLISHED_URL='http://localhost:8080/' \
npm run wordpress:e2e:release
```

`wordpress:e2e:installed` continua sendo o smoke rápido e pode omitir a publicação. O comando de release define `KODETY_E2E_REQUIRE_PUBLISH=1`, mas nunca concede autorização: sem o `KODETY_E2E_ALLOW_PUBLISH=1` fornecido pelo operador ele falha antes do login/edição. Quando autorizado, exige ACK do endpoint, abre um contexto anônimo novo sem `wordpress_logged_in_`, rejeita redirect para login/admin e só então confere o texto na página pública. Use esse modo apenas em ambiente local/descartável.

## Perfil de performance instalado

O comando `npm run wordpress:e2e:performance` usa a configuração isolada `e2e/playwright.performance.config.mjs`: Chromium, um worker, zero retry e trace/screenshot/vídeo nativos desligados durante amostras temporizadas.

O WordPress descartável deve definir a constante PHP literal `KODETY_PERFORMANCE_DEBUG` como `true`. O perfil exige as fases redigidas `config`, `bootstrap` e `mount` nas superfícies do plugin; se a observabilidade ou as credenciais não estiverem disponíveis, ele falha em vez de fabricar métricas.

Calcule SHA-256 das três fixtures no setup e forneça todos, mesmo quando apenas um perfil estiver instalado. Eles precisam ser hexadecimais e distintos. O valor escolhido é apenas a expectativa; o harness não o trata como prova:

```bash
export KODETY_E2E_SMALL_PROJECT_FINGERPRINT='<SHA256_FIXTURE_SMALL>'
export KODETY_E2E_LARGE_PROJECT_FINGERPRINT='<SHA256_FIXTURE_LARGE>'
export KODETY_E2E_LEGACY_PROJECT_FINGERPRINT='<SHA256_FIXTURE_LEGACY>'
export KODETY_E2E_INSTALLED_FINGERPRINT_URL='http://localhost:8080/wp-json/kodety-e2e/v1/fixture-receipt'
```

Antes de medir, o login faz um GET autenticado e same-origin em `KODETY_E2E_INSTALLED_FINGERPRINT_URL`. O endpoint da fixture precisa responder `application/json` com `{"profile":"small|large|legacy","fingerprint":"<SHA256>"}`. Perfil e hash lidos precisam corresponder ao job e ao hash esperado; ausência, redirect externo, conteúdo não JSON ou divergência bloqueiam o gate. Esse receipt exige suporte do setup/backend descartável e é um bloqueio explícito onde ainda não existir.

O gate também exige `KODETY_E2E_PERF_BUDGET_PATH`, apontando para JSON revisado com `schemaVersion: 1` e uma entrada por perfil, throttle, tipo de relatório, alvo, modo e métrica. Cada entrada contém `baselineMedian`, `maximumMedian` e `rationale`. O arquivo precisa cobrir TTFB, FCP, LCP, CLS, load, ready, requests, bytes, blocking time/TBT, INP de laboratório e CPU para cold/warm; a página publicada acrescenta `speedIndexMs`, `thirdPartyRequestCount` e `thirdPartyTransferBytes`; o bloco `soak/Builder/duration` cobre `heapGrowthBytes`, `listenerGrowth`, `nodeGrowth` e `documentGrowth`. Ausência, duplicação, valor inválido ou medição acima do teto falha fechado. Os números devem vir de um release anterior medido no mesmo ambiente — o harness não gera tetos nem tolerância automaticamente.

A página publicada também é um alvo próprio, medido sem cookie autenticado. Informe uma URL e um marcador imutável já presente na fixture publicada:

```bash
export KODETY_E2E_PUBLISHED_URL='http://localhost:8080/'
export KODETY_E2E_PUBLISHED_MARKER='fixture-release-2026-08-30'
export KODETY_E2E_PUBLISHED_INTERACTION_SELECTOR='button[data-e2e-inp-probe]'
# Opcional; o padrão é body.
export KODETY_E2E_PUBLISHED_READY_SELECTOR='main'
```

Execute jobs separados, restaurando WordPress/DB antes de cada perfil:

```bash
KODETY_E2E_PROJECT_PROFILE=small \
KODETY_E2E_SMALL_BUILDER_URL='http://localhost:8080/kodety/editor/' \
npm run wordpress:e2e:performance

KODETY_E2E_PROJECT_PROFILE=large \
KODETY_E2E_LARGE_BUILDER_URL='http://localhost:8080/kodety/editor/' \
npm run wordpress:e2e:performance

KODETY_E2E_PROJECT_PROFILE=legacy \
KODETY_E2E_LEGACY_BUILDER_URL='http://localhost:8080/kodety/editor/' \
npm run wordpress:e2e:performance
```

Para provar o isolamento lazy real, cada workspace exige um seletor de controle no Builder e uma regex de recurso que não pertence ao closure inicial do Builder. Defina os pares `KODETY_E2E_<WORKSPACE>_TRIGGER_SELECTOR` e `KODETY_E2E_<WORKSPACE>_LAZY_RESOURCE_REGEX` para `SETTINGS`, `CMS`, `ANALYTICS`, `LOCALIZATION`, `EMAIL` e `FILE_SYSTEM`. A aplicação usa navegação nativa (`window.location.assign`/links), não uma transição SPA: o gate abre um contexto/cache novo por workspace, registra os recursos do Builder, clica o controle, exige novo `performance.timeOrigin` e verifica no documento de destino um recurso `script`, `link`, `fetch` ou `xmlhttprequest` ausente no closure inicial e correspondente à regex. Sem seletores/regexes específicos da fixture, ele falha em vez de confundir navegação direta com lazy loading.

Cada superfície também exige um controle explícito, não destrutivo e que permaneça visível após o clique para o probe de INP: `KODETY_E2E_BUILDER_INTERACTION_SELECTOR` e `KODETY_E2E_<WORKSPACE>_INTERACTION_SELECTOR` para `SETTINGS`, `CMS`, `ANALYTICS`, `LOCALIZATION`, `EMAIL` e `FILE_SYSTEM`. A página pública usa `KODETY_E2E_PUBLISHED_INTERACTION_SELECTOR`. Em cada amostra o harness executa cinco cliques reais, recusa navegação/alteração de URL, exige cinco IDs do Event Timing e calcula o percentil 98 (o pior caso neste conjunto curto). O resultado `inpMs` é INP de laboratório controlado e entra no budget; não é Core Web Vitals de campo.

Não execute small/large/legacy em paralelo contra a mesma instalação. Para cada uma das sete superfícies autenticadas e para a página publicada anônima, o spec faz cinco pares independentes:

1. autentica uma vez sem instrumentação e mantém `storageState` somente em memória;
2. cria um contexto novo por par, com cache vazio mas habilitado;
3. mede a primeira navegação como **cold** e espera a rede ficar 500 ms sem requests em voo;
4. abre `about:blank` sem limpar o cache e mede a segunda como **warm**;
5. fecha o contexto antes do par seguinte.

São 80 amostras por projeto (`8 superfícies × 5 pares × 2 modos`), 240 para small + large + legacy por perfil de rede e 480 na passagem Slow 4G + Fast 3G, além das seis transições lazy por projeto e throttle.

### Matriz small + large + legacy executável

`e2e/run-wordpress-performance-matrix.mjs` executa small, large e legacy sequencialmente em Slow 4G e Fast 3G. Ele força evidência redigida completa, exige Node 22.12+, 24 ou 26 e não usa shell. Antes de alterar a primeira fixture, lê e valida a cobertura integral do budget, as três URLs/fingerprints, URLs same-origin, regexes, inteiros, seletores de soak distintos e os três arrays de setup. Os comandos de restauração são arrays JSON, não strings interpoladas; não coloque credenciais nesses argumentos. O runner remove `KODETY_E2E_USER` e `KODETY_E2E_PASSWORD` do ambiente do subprocesso de setup:

```bash
export KODETY_E2E_SMALL_SETUP_ARGV='["./ci/restore-wordpress-fixture.sh","small"]'
export KODETY_E2E_LARGE_SETUP_ARGV='["./ci/restore-wordpress-fixture.sh","large"]'
export KODETY_E2E_LEGACY_SETUP_ARGV='["./ci/restore-wordpress-fixture.sh","legacy"]'
node e2e/run-wordpress-performance-matrix.mjs
```

O script de setup é externo a este repositório: ele precisa restaurar arquivos/DB, instalar a versão sob teste, publicar o marcador e atualizar o receipt antes de retornar zero. A ausência desses comandos ou de qualquer variável obrigatória bloqueia a matriz antes do primeiro job.

Para isolar diagnósticos sem mudar a configuração:

```bash
npm run wordpress:e2e:performance -- --grep 'workspaces instalados'
npm run wordpress:e2e:performance -- --grep 'página publicada anônima'
npm run wordpress:e2e:performance -- --grep 'transições lazy do Builder'
```

### Throttling reprodutível

`KODETY_E2E_PERF_THROTTLE_PROFILE` aceita:

- `slow4g` (padrão e gate de release): 100 ms, 4.000.000 bit/s down, 3.000.000 bit/s up, CPU 2×;
- `fast3g` (gate de release): 150 ms, 1.600.000 bit/s down, 750.000 bit/s up, CPU 4×;
- `desktop`: 40 ms, 10.000.000 bit/s down, 5.000.000 bit/s up, CPU 1×, apenas diagnóstico;
- `mobile`: alias diagnóstico histórico de 150 ms, 1.600.000 bit/s down, 750.000 bit/s up, CPU 4×;
- `none`: sem limitação de rede, CPU 1×; útil apenas para diagnóstico local fora do agregador, nunca promovível.

O runner registra os valores numéricos e a API CDP efetivamente usada. Ele tenta `Network.emulateNetworkConditionsByRule` + `Network.overrideNetworkState` e mantém fallback compatível com o Chromium fixado. Mantenha hardware, SO, viewport, versão do browser, modo headless e perfil de throttle idênticos entre baselines. Esses presets não são Lighthouse e não simulam dados de campo.

`KODETY_E2E_PERF_SETTLE_MS` pode ajustar a janela pós-ready entre 500 e 10.000 ms; o padrão é 2.500 ms. Alterar esse valor cria outro perfil e precisa constar na comparação.

### Soak de heap e listeners

Cada job da matriz mantém o Builder aberto por no mínimo 30 minutos. Defina `KODETY_E2E_SOAK_OPEN_SELECTOR` e `KODETY_E2E_SOAK_CLOSE_SELECTOR` para controles distintos de um painel reversível da fixture. Cada ciclo prova que o controle de fechar começa invisível, aparece depois da abertura, desaparece depois do fechamento e devolve o controle de abrir; só então incrementa o contador. O teste captura `JSHeapUsedSize` e `Memory.getDOMCounters` a cada cinco minutos e compara os maiores crescimentos de heap, listeners, nós e documentos com o budget revisado. `KODETY_E2E_SOAK_DURATION_MS` só aceita 30 minutos ou mais; `KODETY_E2E_SOAK_CYCLE_MS` controla o intervalo entre 1 e 60 segundos. A matriz força evidência redigida `all` também para o soak.

### Métricas e estatística

Cada amostra retém valores brutos de TTFB do documento, DCL, load, FCP, LCP de laboratório, CLS de laboratório, INP de laboratório do probe explícito, navegação→workspace ready, requests, bytes transferidos/codificados/decodificados, recursos vindos de cache, `Server-Timing`, long tasks e blocking time/TBT até ready, CPU (task/script/layout), delta de heap e fases Kodety. A página publicada acrescenta Speed Index visual, requests/bytes de terceiros e um inventário técnico sem URLs/conteúdo: elemento LCP (tag, dimensões, prioridade/loading), mídia abaixo da dobra, dimensões explícitas de imagens, stylesheets/fontes render-blocking e agrupamento first-party/third-party por tipo. Ready e load são aguardados em paralelo a partir do commit da navegação, portanto `readyMs` não é artificialmente atrasado até load.

O Speed Index usa frames JPEG temporários do screencast CDP somente em memória, comparados ao frame final por `sharp`; nenhum frame/base64 é gravado, anexado ou incluído em diagnóstico. A captura é limitada em quantidade/tamanho e ocorre apenas na página publicada. A cadeia `project_*` do Builder cold exige `download_body → unzip → parse → first_canvas_visual_ready` com a mesma correlação, resultado `ok` e duração monotônica. No warm, um `download_body` com cache hit é válido e deve pular unzip/parse; fases emitidas sempre exigem ID opaco, duração, cache e outcome fechados.

O init script reserva 5.000 entradas de Resource Timing e registra `resourcetimingbufferfull`; atingir o limite ou perder suporte/ativação de LCP, layout shift, long task ou Event Timing invalida a amostra. As métricas CDP obrigatórias também falham quando ausentes, em vez de serem convertidas para zero. Antes de trocar cold por warm, o recorder drena requests em voo e finalizadores do waterfall; uma rede que não fica ociosa bloqueia o par.

O relatório agrega mínimo, máximo, range, mediana, MAD, Q1, Q3 e IQR. Cinco observações não sustentam p95; o harness não o rotula. O `inpMs` usa cinco interações reais e explicitamente configuradas por amostra, não eventos sintéticos, e continua sendo uma medida de laboratório. LCP/CLS/INP aqui não são Core Web Vitals de campo. Não declare score ou ganho antes de um rerun equivalente.

## Falhas e evidências

Smoke e performance falham com `console.error` não permitido, 4xx/5xx inesperado, falha de rede crítica, loading infinito ou métrica/fase ausente. As allowlists `KODETY_E2E_CONSOLE_ERROR_ALLOWLIST` e `KODETY_E2E_HTTP_ERROR_ALLOWLIST` aceitam array JSON de regexes ou uma regex por linha; não permita categorias amplas.

O smoke desliga trace, screenshot, vídeo e HAR nativos porque eles atravessariam login e DOM autenticado sem passar pelo scanner próprio. Em falha, somente o HAR reduzido é serializado pelo redator fail-closed, sem headers, cookies ou bodies, com URLs/diagnósticos sanitizados, escrita atômica e permissão `0600`.

No perfil de performance, o relatório JSON redigido é sempre escrito em `artifacts/kodety-hardening/front-06/e2e/performance/`. `KODETY_E2E_PERF_EVIDENCE=failure` (padrão) escreve `.trace.json` diagnóstico e HAR próprio apenas na falha; `all` escreve ambos para cada amostra. Não é usado HAR/trace nativo durante timing.

Os artefatos próprios removem query values, fragmentos, credenciais, Authorization, tokens/nonces em texto ou JSON, headers, cookies e bodies; limitam tamanho/volume e usam nomes únicos por run/perfil/throttle/alvo/modo/repetição. O usuário é redigido nos campos de origem, mas apenas segredos de alta entropia, como a senha, são procurados como substring global — assim o usuário `admin` não torna `/wp-admin/` um falso positivo. Um scanner fail-closed valida todos os documentos antes de qualquer write, grava temporários com modo `0600`, faz rename e remove o conjunto parcial se houver erro. Ele bloqueia credencial literal, Authorization cru, payload proibido, header/cookie não vazio ou query não redigida. Mesmo assim, trate a pasta como evidência restrita e revise antes de publicar.

## Gates

1. **quick** — versão, typecheck, contratos rápidos, PHP/segurança, observabilidade e budgets estáticos; sem banco/browser.
2. **smoke instalado** — ZIP real, WordPress/MySQL, credenciais temporárias e smoke funcional small/large.
3. **performance/release** — ambiente restaurado, receipt autenticado, `KODETY_PERFORMANCE_DEBUG`, budget de medianas revisado, cinco pares cold/warm das sete superfícies e da página pública anônima, seis transições lazy, small/large/legacy em Slow 4G e Fast 3G, relatórios completos, build/preflight, dois ZIPs determinísticos e smoke verde. O runner de matriz cobre a medição reproduzível; executar só um `KODETY_E2E_PROJECT_PROFILE` ou throttle não fecha o gate.

Staging com credenciais externas fica em job manual separado. Rubrica continua um job privado explícito; sua ausência não pode parecer sucesso do plugin principal.

O contrato estrutural não abre browser nem precisa de URL/credenciais:

```bash
node scripts/test-wordpress-e2e-contract.mjs
```

Com as dependências instaladas, o quick gate também pode confirmar o registro dos três jobs sem abrir Chromium:

```bash
npm run wordpress:e2e:performance -- --list
```
