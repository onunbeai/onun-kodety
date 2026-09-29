# Agent mode (Codex App Server)

O modo Agent do Builder é um cliente do **Codex App Server**. O processo Codex mantém autenticação, modelos, threads, streaming, approvals, plugins/apps e skills. O Onun Kodety fornece ao App Server ferramentas dinâmicas do editor (`kodety_*`) e executa essas chamadas contra o estado vivo do canvas.

O chat usa dynamic tools do App Server; clientes externos usam o Remote MCP.
Ambos descobrem as mesmas operações nativas em `kodety_native_catalog` e as
executam com `kodety_native_call`. O catálogo único fica em
`agent-runtime/native-operations.json`; CMS, configurações e idiomas passam
pelas mesmas APIs REST, permissões, locks e confirmações de persistência.

Antes de operar uma área, filtre o catálogo pelo prefixo, por exemplo `cms`,
`localization` ou `project`, leia o `inputSchema` e consulte os dados atuais.
Operações CMS incluem artigos, importação, coleções, campos e templates. A
revisão do schema é usada para criação/importação/configuração; a revisão do
item é usada para edição/exclusão. A importação nativa valida o lote e tenta
reverter os itens anteriores se uma linha falhar; o resultado informa se a
reversão não pôde ser confirmada.

O Agent reaproveita a sessão do editor, serializa chamadas e atualiza as
superfícies afetadas após confirmação. O MCP externo pode adquirir uma sessão
pelas operações `editor_lock_*`; uma sessão ocupada permanece protegida. As
operações de arquivos/seções conservam o transporte de rascunho do MCP.
Erros de permissão, licença, conflito ou integração indisponível continuam
visíveis e não são tratados como execução bem-sucedida.

## Runtime gerenciado pelo WordPress

Quando a hospedagem permite executar o Agent, a preparação é automática: o cliente final não precisa instalar Node.js, Codex CLI nem o ChatGPT App. O WordPress procura executáveis funcionais e baixa somente os componentes ausentes ou incompatíveis, conferindo os hashes fixados em `agent-runtime/runtime-manifest.json`. Os arquivos ficam em diretórios privados fora do webroot. O ZIP permanece pequeno e uma instalação Linux não recebe binários de macOS, nem o contrário.

O provisionamento automático suporta Linux e macOS de 64 bits, em arquiteturas x64 e arm64. O host ainda precisa oferecer `proc_open()` (com controle do processo) ou `exec()`, além de `tar`, HTTPS de saída, armazenamento privado gravável, comunicação loopback e processos persistentes. Não existe garantia de funcionamento em toda hospedagem: PHP não consegue liberar restrições impostas pelo provedor. A indisponibilidade do Agent não impede a ativação do plugin.

### Download em etapas e recuperação

O painel do Agent e Settings > Agents mostram a etapa atual, os bytes baixados e, quando conhecido, o percentual do componente. A preparação funciona da seguinte forma:

- Cada chamada a `POST /agents/config/retry` baixa no máximo um bloco de 2 MiB, com timeout de rede de 20 segundos. Node.js e Codex são baixados sequencialmente, não em paralelo.
- O arquivo parcial e o último bloco confirmado ficam no armazenamento privado. Ao fechar o painel ou interromper a conexão, **Tentar novamente** retoma desse ponto. Áreas de instalação sem atividade por 24 horas podem ser descartadas numa preparação posterior; a limpeza do diretório temporário pelo host também pode remover esse progresso.
- A leitura de `GET /agents/config` informa o progresso e verifica/inicia processos já disponíveis, mas não baixa componentes. A sequência de downloads exige uma ação explícita do usuário. Ao fechar o painel, a interface deixa de solicitar novas etapas; uma chamada PHP já em execução ainda pode concluir seu bloco.
- A verificação do hash, a extração e os testes dos executáveis ocorrem em etapas separadas. Um hash inválido descarta somente o componente corrompido, sem executar o arquivo nem apagar o outro download concluído.
- Node.js é extraído e testado **antes** do download do Codex. Se já existir um Node funcional, apenas o Codex é baixado; o inverso também é suportado. Executáveis do host não são substituídos nem têm suas permissões alteradas.
- Checkpoints do instalador anterior são migrados sem descartar os downloads verificados, inclusive uma preparação parada em `validate_node`. Se um executável reaproveitado desaparecer, o componente volta a ser preparado.
- TLS, origem dos downloads e tamanho máximo continuam validados. Se o proxy ignorar `Range` em um arquivo grande, a instalação mostra o motivo e para; não passa silenciosamente a baixar tudo numa única requisição.

Locks de arquivo impedem downloads concorrentes e coordenam a ativação com o início do serviço. A nova instalação só é ativada depois das verificações. A troca preserva uma cópia `.previous` do runtime anterior e tenta restaurá-la se o rename final falhar; uma troca interrompida pode ser retomada. Isso não constitui rollback automático de falhas posteriores do Codex. É necessário suporte a `flock()` e ao menos 700 MiB livres para iniciar uma nova instalação.

### Diagnóstico e inicialização

O painel mostra uma mensagem, uma orientação e um código público para erros conhecidos: timeout, DNS, certificados HTTPS, bloqueio do download, integridade, espaço, permissões, criação de processos e inicialização do Codex. Os testes distinguem execução negada (`node_execution_denied` / `codex_execution_denied`), bibliotecas incompatíveis (`*_system_incompatible`), arquitetura/CPU (`*_architecture`), recursos (`*_resources`) e falta de resposta (`*_probe_timeout`). Esses códigos são classificações do resultado do teste; por exemplo, um processo morto não prova sozinho falta de RAM. Erros da API REST e sessão expirada também recebem orientações próprias. Logs, tokens, caminhos privados e o segredo do bridge não são enviados ao navegador.

Os processos recebem um ambiente mínimo, sem herdar credenciais do PHP. Com `proc_open`, as sondas têm timeout, saída limitada e encerramento forçado caso ignorem o primeiro sinal. Quando apenas `exec()` está disponível, o plugin utiliza o utilitário `timeout` se instalado; sem ele, continuam valendo os limites de execução do host. As assinaturas PHP deste módulo não exigem tipos literais introduzidos depois do PHP 8.0 declarado pelo plugin.

A resposta de `/health` confirma somente o serviço Node.js. O WordPress também consulta `/ready`, autenticado e isolado por usuário/projeto, antes de liberar o login. Essa verificação exige que o Codex tenha inicializado e confirmado o perfil de permissões obrigatório. O início nativo tem limite de 30 segundos e tentativas automáticas respeitam um intervalo de 30 segundos após falhas; a ação explícita de verificar novamente pode antecipar a nova tentativa. Processos de inicialização que não encerram após a solicitação de parada são terminados à força.

Downloads menores reduzem o trabalho por requisição, mas não removem restrições da hospedagem a processos persistentes, memória ou comunicação loopback. Bibliotecas antigas do sistema também podem impedir a execução de um binário íntegro: por exemplo, o [Node oficial Linux desta versão requer glibc 2.28 ou superior](https://github.com/nodejs/node/blob/v24.14.0/BUILDING.md). Reutilizar um Node funcional fornecido pela hospedagem pode resolver esse caso; o plugin não instala runtimes antigos sem suporte nem desativa validações de segurança.

O plugin testa candidatos até encontrar um funcional, em vez de parar no primeiro arquivo executável. Além de PATH e diretórios padrão, procura Node nos caminhos versionados de CloudLinux, [cPanel](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/) e [Plesk](https://support.plesk.com/hc/en-us/articles/12377084794263-How-to-install-and-run-Node-js-application-in-Plesk), em instalações NVM/FNM, Volta e nos apps desktop do macOS. A descoberta é limitada e rejeita diretórios de busca graváveis por qualquer conta. Caminhos explícitos em `KODETY_AGENT_NODE_BINARY` ou `KODETY_CODEX_BINARY` têm precedência e falham de forma fechada quando inválidos.

### Armazenamento privado e pastas com noexec

Os dados existentes de login, sessões, anexos e o segredo do bridge permanecem no diretório atual. Se o armazenamento dos **executáveis** tiver `noexec` ou negar sua execução, o instalador procura uma pasta privada gravável da conta, fora do site público, e testa nela um pequeno binário do próprio sistema. Somente uma alternativa que passe nesse teste é selecionada. Não são alteradas as opções de montagem da hospedagem.

Downloads e checkpoints ficam no armazenamento de dados original; somente extração e ativação passam para a alternativa. Isso permite repetir a extração sem baixar novamente os pacotes já verificados e sem migrar tokens. A escolha persiste entre requisições e não substitui um `KODETY_AGENT_RUNTIME_DIR` configurado explicitamente. Se nenhuma alternativa funcionar, o painel informa a restrição e a orientação para o provedor.

O padrão usa um diretório `kodety-agent-<site>` dentro de `sys_get_temp_dir()`. Se um novo armazenamento temporário não puder ser criado (por exemplo, por `open_basedir`), o plugin tenta uma pasta privada da conta e salva essa escolha. Um armazenamento existente com permissões inválidas não é silenciosamente abandonado. Para garantir persistência dos logins mesmo quando o host limpa seus temporários, configure um diretório privado persistente:

```php
define('KODETY_AGENT_DATA_DIR', '/var/lib/kodety-agent');
// Opcional: diretório dedicado apenas aos binários, em um volume executável.
define('KODETY_AGENT_RUNTIME_DIR', '/var/lib/kodety-agent-binaries');
// Opcionais: use apenas para substituir o runtime privado gerenciado.
define('KODETY_AGENT_NODE_BINARY', '/usr/bin/node');
define('KODETY_CODEX_BINARY', '/usr/local/bin/codex');
```

Os caminhos de dados e de binários devem ser absolutos, dedicados, privados e fora de `ABSPATH`, `DOCUMENT_ROOT` e uploads. Os diretórios usam modo `0700`; dados privados usam `0600`. Uma instalação existente não deve ter `KODETY_AGENT_DATA_DIR` trocado sem uma migração administrada dos dados. As alternativas automáticas podem ser restringidas pelo filtro servidor `kodety_agents_private_runtime_parents`, sem relaxar essas verificações.

O sidecar faz um probe de `permissionProfile/list` antes de ficar disponível. A versão do Codex instalada precisa aceitar perfis nomeados em `thread/start`, `thread/resume` e `turn/start`; se o perfil `kodety-agent` não aparecer como permitido, o runtime falha fechado.

## Limite de execução do agente

Cada processo App Server é iniciado com o perfil `kodety-agent`. Esse perfil concede leitura somente às raízes de workspace declaradas para o projeto e para as skills, além do conjunto mínimo de arquivos de runtime da plataforma, e mantém a rede de comandos desligada. `CODEX_HOME`, o segredo do bridge e os diretórios de outros usuários não entram nas raízes do turno.

O sidecar também desabilita shell, subagentes, web search e `view_image` do host. A integração edita o Builder exclusivamente pelas dynamic tools `kodety_*`; o Figma é acessado pelo app oficial autorizado na conta do usuário. Não remova esses overrides supondo que o modo legado `read-only` limite a leitura ao `cwd`: sem um perfil restrito, ele pode permitir leitura mais ampla do host.

Em hospedagem multiusuário de alta confiança, execute o sidecar sob UID/container dedicado como segunda barreira. O perfil do App Server é necessário, mas não substitui o isolamento do processo no sistema operacional.

## Open source execution

The Agent runs in the browser or on your own server. The commercial hosted gateway, license exchange and remote session provider are removed. WordPress login, user capabilities, REST nonces and upstream provider authentication remain required. `POST /agents/remote/session` returns HTTP 410 after checking the caller's permissions.


## Sidecar gerenciado externamente

Para executar o sidecar com systemd, launchd ou outro supervisor:

```php
define('KODETY_AGENT_AUTOSTART', false);
define('KODETY_AGENT_BRIDGE_URL', 'http://127.0.0.1:45871');
define('KODETY_AGENT_SECRET', 'use-um-segredo-aleatorio-com-pelo-menos-32-caracteres');
```

Inicie `agent-runtime/server.mjs` com as variáveis correspondentes. Prefira `KODETY_AGENT_SECRET_FILE` apontando para um arquivo `0600`; não coloque o segredo na linha de comando.

O bridge aceita somente loopback, não segue redirects e expõe ao navegador apenas uma lista explícita de operações. Tokens da OpenAI, arquivos do `CODEX_HOME`, paths privados e o segredo do bridge nunca são enviados ao frontend.

## Conta OpenAI e Figma

Cada usuário do WordPress recebe um `CODEX_HOME` isolado. O login OpenAI é iniciado pelo App Server com device code e é persistido nesse diretório privado.

O Figma é o plugin/app oficial descoberto pelo catálogo da conta. O Onun Kodety não fixa um connector ID. Depois do login OpenAI, o painel tenta instalar esse plugin como integração padrão; se o App Server exigir um interstitial, aguarda a confirmação explícita do usuário. Quando o app obrigatório ainda não está autorizado, o painel abre o `installUrl` devolvido pelo App Server e consulta novamente `app/list` e `app/installed` até o app ficar `callable`.

## Skills

Cinco skills nativas acompanham o plugin:

- `kodety-editor` executa alterações gerais em páginas, seções, CMS e componentes;
- `kodety-widgets` cria, compila, insere, configura e verifica Code Components React/TSX;
- `kodety-motion` inspeciona a linguagem de animação do projeto e lê/aplica documentos Interactions v2 pelo motor nativo do Builder;
- `kodety-performance` cruza inventário e fontes do projeto com auditorias PageSpeed/Lighthouse e aplica otimizações seguras em HTML, CSS, JavaScript e outros arquivos de texto;
- `kodety-languages` traduz sites ou páginas inteiras pelo catálogo semântico da Localização, em lotes revisionados e sem clicar campo por campo nem depender da API de tradução opcional.

As cinco podem atualizar o card de progresso acima do composer por
`kodety_progress_update` quando a tarefa tem várias etapas. Esse card é
dirigido por marcos reais do agente e não substitui o indicador **Pensando**.

## Operação dos painéis visuais

O contexto do Agent diferencia o Canvas dos workspaces nativos. Em Settings,
CMS, Analytics, Localization, Members e Templates, `editor.nativePanel`
anuncia as ferramentas disponíveis. Prefira `kodety_native_catalog` e
`kodety_native_call` para operações presentes no catálogo. O Agent lê os controles vivos com
`kodety_panel_snapshot` e age com `kodety_panel_action`, sempre usando a revisão
mais recente. A leitura abrange abas, links, campos, botões, menus e diálogos;
portanto também cobre redirects, código personalizado e scripts, coleções e
campos CMS, funis, testes A/B, idiomas e qualquer controle futuro renderizado
nesses workspaces.

Localização também anuncia `kodety_localization_snapshot`,
`kodety_apply_localization_settings` e
`kodety_apply_localization_translations`. Essas ferramentas leem e persistem
conteúdo, SEO, rotas e metadados em lotes atômicos, preservam traduções humanas
por padrão. A ferramenta de configuração gerencia idiomas, fallback, prefixos
e preferências sem precisar abrir a tela de Localização.

Enquanto um painel nativo está ativo, as ferramentas visuais de
mutação de páginas, componentes e Motion permanecem vinculadas ao Canvas. Isso impede que o Agent contorne as
rotas, validações, permissões e persistência da interface editando o source do
projeto. Após navegar, abrir um menu ou alterar um campo, o Agent precisa ler o
painel novamente antes da próxima ação.

Skills enviadas por um usuário são validadas e gravadas fora do webroot, no espaço isolado daquele usuário. O plugin oficial Figma fornece suas próprias skills, inclusive `figma-design-to-code`; não mantenha uma cópia divergente no Onun Kodety.
