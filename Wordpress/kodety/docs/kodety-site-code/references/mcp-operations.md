# Operação máxima do Onun Kodety Remote MCP

Use este guia sempre que uma conexão MCP do Onun Kodety estiver disponível. Ele
documenta somente ferramentas que existem no servidor atual.

## Protocolo obrigatório da sessão

1. Chame `kodety_get_site`.
2. Confirme `enabled`, `projectInstalled`, `connectionScope`, `target`,
   `capabilities` e `workspaceRevision`. Compare `target.workspaceProjectId` e
   `target.name` com o projeto atual.
3. Liste o workspace com `kodety_list_files`. Limite por `path` quando souber a
   pasta.
4. Leia a página, os estilos, o manifesto `.incode/project.json`, o
   `.incode/coded-build.json` quando existir e o documento de Interactions da
   página quando forem relevantes.
5. Escolha a ferramenta mais semântica disponível. Não use uma escrita de
   arquivo para simular uma operação que já possui ferramenta própria.
6. Faça uma mutação lógica por vez.
7. Confirme a resposta estruturada, guarde a nova `workspaceRevision` e leia de
   volta os artefatos críticos.
8. Antes da próxima mutação importante, use a revisão retornada. Se o usuário
   puder ter editado o Builder durante a tarefa, chame `kodety_get_site`
   novamente.
9. Em conflito, releia e reconcilie. Nunca repita uma gravação cegamente.
10. Publique apenas mediante pedido explícito.

## Escopo da conexão

- O ícone MCP da topbar abre `Settings → Integrações e IA → MCP`. A ação
  **Copiar conexão deste projeto** nessa tela cria uma conexão independente,
  exibida uma única vez e vinculada ao projeto aberto naquele momento.
- Criar outra conexão para o mesmo projeto não revoga nem rotaciona as
  anteriores.
- `connectionScope: project` não deve ser tratado como credencial global do
  site.
- O identificador interno do escopo é o `workspaceProjectId` persistido no
  projeto. Trocar ou importar outro workspace invalida o alvo da credencial e
  produz conflito em vez de redirecioná-la silenciosamente.
- Conexões legadas sem identidade persistida não são vinculadas novamente pelo
  cliente MCP. Um administrador deve criar uma conexão nova no projeto correto
  e revogar a antiga pela lista de conexões em Settings.

## Skills em clientes externos

- O Agent nativo do Builder usa as skills embarcadas na própria instalação e
  não precisa instalar, baixar ou verificar atualizações.
- Codex, Claude e outros clientes externos podem descobrir o catálogo em
  `kodety://skills/catalog` e usar o prompt MCP `install-kodety-skills`.
- Cada pacote externo possui um digest SHA-256 e um recurso `manifestUri`. O
  instalador grava esse conteúdo como `kodety.manifest.json` ao lado do
  `SKILL.md`.
- Compare o digest local com o catálogo quando operar por Remote MCP. Se forem
  iguais, não reescreva o pacote. Se diferirem, informe a atualização e use o
  prompt de instalação mediante ação do usuário.
- Nunca inclua URL MCP ou bearer token no manifest, na skill ou em logs.

## Hierarquia de ferramentas

Escolha nesta ordem:

1. `kodety_upsert_section` para criar ou substituir uma seção completa.
2. Ferramentas de CMS, conteúdo, mídia, configurações ou IA para os respectivos
   domínios.
3. `kodety_replace_in_file` para uma troca textual exata e localizada.
4. `kodety_write_file` para criar um arquivo novo ou substituir
   deliberadamente um arquivo inteiro.

Não edite arquivos gerados em `kodety-build/` como fonte autoral.

## Operações compartilhadas com o Agent

Use `kodety_native_catalog` com `area: "cms"`, `"localization"`, `"project"`
ou outro prefixo para descobrir as operações e seus schemas exatos. Execute
`kodety_native_call` com `{operation, arguments}`. Esse transporte usa as
mesmas APIs nativas do painel Agent, inclusive permissões, limites de licença,
escopo do projeto, revisão, locks, validação dos campos e confirmação da gravação.

- Artigos: `cms_list_items`, `cms_get_item`, `cms_create_item`,
  `cms_update_item`, `cms_delete_item` e `cms_import_items`.
- Estrutura CMS: schema, coleções, campos e templates têm operações de leitura
  e alteração. Consulte `cms_schema` antes de criar coleções, campos ou itens.
- Configurações: `project_get_settings` lê fontes de configuração do projeto;
  `project_apply_delta` aplica um delta revisionado com recibo. Preserve campos
  e arquivos não relacionados. O catálogo descreve o payload e a integridade.
- Idiomas: `localization_get` lê metadados e revisão; `localization_update`
  salva a configuração pela API nativa, sem editar o idioma fonte ou publicar.
- Integrações: operações específicas de AI, Adobe Fonts e Meta CAPI usam seus
  contratos nativos. Valores privados não são devolvidos nas leituras.

Criação, importação e schema usam `expectedRevision` do schema CMS; edição e
exclusão de um artigo usam a revisão retornada por `cms_get_item`. Preserve
rascunho como padrão. A exclusão move para a lixeira. A importação é um lote
validado com rollback; se houver `rollbackFailed`, relate a falha e releia os
dados antes de qualquer nova tentativa.

Chamadas externas que exigem lease usam `editor_lock_acquire`, com identificadores
de sessão/lease escolhidos pelo cliente no formato do schema. Confirme que a
resposta concede edição e envie `context.editorSession` e `context.editorLease`
nas próximas chamadas. Libere com `editor_lock_release` ao concluir. Se outro
editor estiver ativo, não tome seu lock. Adobe Fonts e Meta CAPI aceitam a
identidade do request MCP autenticado como transporte alternativo ao nonce de
browser. Permissões administrativas continuam obrigatórias; copiar um header
ou reutilizar um token revogado não concede esse acesso.

Os nomes antigos de CMS continuam disponíveis e encaminham às mesmas APIs.
Suas mutações agora exigem `expectedRevision` e contexto nativo; as respostas
incluem os dados e revisões nativos. Use o catálogo para tarefas novas. Não use
`force` para remover artigos nem crie coleção e campos em um comando legado:
crie a coleção, releia a revisão e configure os campos em seguida.

Uma falha de execução vem com `isError: true` e erro estruturado com código,
mensagem, status e dados de conflito quando disponíveis. Isso é diferente de
uma chamada de protocolo inválida. Não confirme sucesso sem ACK e leitura final.

## Inventário das ferramentas

### Estado e leitura

- `kodety_get_site`: leia o alvo, o escopo da conexão, capacidades,
  configuração, release e revisões.
- `kodety_get_settings`: leia logo e preferências visuais permitidas.
- `kodety_list_files`: liste até 2.000 arquivos; aceite `path` como prefixo.
- `kodety_read_file`: leia `path`; texto retorna UTF-8 e binário retorna base64.
- `kodety_list_content`: consulte posts/collections antes de criar duplicatas.
- `kodety_get_content`: leia um item por `id`, incluindo conteúdo e metadados.
- `kodety_get_ai_status`: confirme provedor/modelo sem expor credenciais.
- `kodety_generate_ai_content`: gere somente rascunho; não suponha persistência.
- `kodety_list_collections`: descubra slugs e campos antes de editar schema ou
  conteúdo.
- `kodety_list_media`: pesquise assets existentes antes de enviar duplicatas.

### Site e arquivos

- `kodety_upsert_section`: envie `page`, `sectionId`, `html`, `baseRevision` e,
  quando necessários, `css` e `interactions`. A raiz deve possuir
  `data-kodety-section-id` idêntico a `sectionId`. IDs de Interactions devem
  começar com `<sectionId>-`.
- `kodety_replace_in_file`: envie `path`, `search`, `replacement` e
  `replaceAll` apenas quando todas as ocorrências devam mudar. Se houver mais
  de uma ocorrência sem `replaceAll`, aumente o contexto de `search`.
- `kodety_write_file`: envie `path`, `content` e `encoding` (`utf8` ou
  `base64`) e `baseRevision`. Leia antes de substituir um arquivo existente.
- `kodety_delete_file`: use somente com alvo explícito e confirme que nenhum
  HTML, CSS, manifesto ou Interaction ainda o referencia. Envie `baseRevision`.

### CMS e conteúdo

- `kodety_create_collection`: crie collection com `name`, `singular`, `slug` e
  opcionalmente `fields`.
- `kodety_update_collection_fields`: leia primeiro a collection e envie
  `postType` com a lista completa de `fields`.
- `kodety_upsert_content`: use `id` para atualizar; sem `id`, crie em rascunho
  por padrão. Aceite `postType`, `title`, `content`, `excerpt`, `slug`,
  `status` e `meta`.
- `kodety_delete_content`: prefira lixeira; use `force` somente quando o usuário
  pedir remoção permanente.

### Mídia, configuração e publicação

- `kodety_upload_media`: envie `filename`, `base64`, `title`, `alt` e
  opcionalmente `projectPath` para também gravar o asset no projeto. Pesquise
  primeiro com `kodety_list_media`.
- `kodety_update_settings`: altere somente `editorCornerIcon` ou
  `interfaceAccentColor`, depois de `kodety_get_settings`.
- `kodety_publish`: é destrutiva no sentido operacional. Chame somente após
  autorização explícita e validação final.

## Confirmação por tipo de mutação

### Seção

Exija na resposta:

- `operation` igual a `created` ou `replaced`;
- `changed` com os caminhos esperados;
- `workspaceRevision` maior que a revisão-base.

Depois leia:

- a página e confirme uma única raiz com o `sectionId`;
- o CSS de seção listado em `changed`, quando enviado;
- `.incode/animations/<caminho-HTML-percent-encoded>.json`, quando houver
  Interactions (por exemplo, `pages/about.html` vira
  `pages%2Fabout.html.json`);
- `.incode/coded-build.json`, quando presente.

### Arquivo

Confirme `path`, `size` e `workspaceRevision`. Leia novamente o arquivo ou ao
menos o trecho exato alterado. Não considere apenas a ausência de erro como
confirmação.

### CMS ou conteúdo

Confirme o `id`/`postType` retornado e releia com `kodety_get_content` ou
`kodety_list_collections`. Para mídia, confirme `id`, `url` e o arquivo do
projeto quando `projectPath` for usado.

## Concorrência, erros e repetição

- `kodety_upsert_section` usa comparação pela `baseRevision`. HTTP 409 exige
  nova leitura e reconciliação.
- `kodety_mcp_project_target_changed` não é conflito de conteúdo. Ele indica
  que a credencial pertence a outro projeto e bloqueia qualquer repetição até
  o Builder voltar ao alvo vinculado.
- Outras mutações retornam revisão, mas não devem ser tratadas como se todas
  aceitassem compare-and-swap. Serialize chamadas e faça leitura de volta.
- Erro de ocorrência múltipla em replace exige contexto maior; não habilite
  `replaceAll` por conveniência.
- Erros de permissão não devem ser contornados com outra ferramenta.
- Falha transitória permite repetição somente após verificar se a primeira
  tentativa já alterou a revisão.
- Projeto com Área de Membros pode bloquear mutações de HTML e artefatos
  privados. Oriente a edição pelo Builder em vez de tentar contornar.

## Limites e segurança

- Texto: até 4 MB.
- Arquivo ou mídia: até 25 MB, também sujeito ao limite do WordPress.
- Links simbólicos e traversal continuam bloqueados. Em uploads ZIP, arquivos
  ocultos fora de `.incode` e formatos incompatíveis entram no fallback: são
  ignorados sem bloquear a importação do restante do projeto.
- Nunca exponha URL com token, bearer token, configuração privada ou conteúdo
  sigiloso em logs, arquivos, commits ou resposta final.
- A configuração copiada contém a única exibição do token em texto puro.
  Transfira-a diretamente ao cliente MCP e não tente persistir uma cópia.
- Nunca publique, force-delete conteúdo ou substitua arquivo inteiro por
  inferência.

## Checklist de uso máximo

- Confirmou `connectionScope` e `target` com `kodety_get_site`.
- Inventariou e leu o estado atual.
- Preferiu ferramenta semântica.
- Reutilizou IDs estáveis.
- Incluiu CSS responsivo, assets e Interactions no mesmo trabalho lógico.
- Confirmou caminhos e revisão.
- Leu a gravação de volta.
- Preservou fontes autorais de projeto compilado.
- Reutilizou a revisão nova.
- Manteve tudo em rascunho salvo, salvo pedido explícito de publicação.
