# Google Search Console no SEO Avançado

O conector do Google Search Console é um recurso **Pro**, controlado pelo
entitlement `advancedSeo`. Conexão, seleção de propriedade, sincronização,
métricas, callback OAuth e tarefas agendadas aplicam o bloqueio no servidor;
esconder ou desabilitar o botão não é usado como mecanismo de autorização.

Se a licença expirar, um administrador ainda recebe somente o estado mínimo da
conexão, pode consultar os metadados redigidos do cliente OAuth, desconectar a
conta e remover a configuração local. Isso não libera edição, conexão nem
métricas: apenas garante que refresh tokens e o Client Secret possam ser
apagados sem exigir a renovação do Pro.

## Experiência no Builder

Em **Settings → SEO → Avançado**, um administrador pode:

1. configurar o cliente OAuth diretamente no WordPress, quando a hospedagem
   ainda não fornecer essa configuração;
2. copiar a URI de redirecionamento calculada pelo plugin e cadastrá-la no
   cliente “Aplicativo da Web” do Google Cloud;
3. salvar o Client ID e o Client Secret de forma protegida no WordPress;
4. clicar em **Conectar com Google** e concluir o consentimento oficial;
5. selecionar uma propriedade, quando ela não puder ser identificada
   automaticamente;
6. sincronizar métricas e navegar por todas as URLs coletadas, em páginas de
   50 resultados;
7. desconectar somente a integração do projeto ativo.

Depois da conexão, o primeiro sync é enfileirado automaticamente. O WordPress
também executa um sync diário e usa tentativas com backoff para falhas
temporárias.

O inventário de URLs combina páginas públicas do WordPress, sitemap XML e as
URLs retornadas por Search Analytics. Isso é intencional: a API do Search
Console não oferece uma operação que enumere, sozinha, todas as URLs indexadas
de uma propriedade.

## Configuração OAuth no WordPress

O Google exige uma URI de redirecionamento exata. Há dois modos suportados.

### Formulário do plugin

O fluxo padrão é configurado em **Settings → SEO → Avançado**. O formulário
mostra a URI de redirecionamento gerada pelo próprio WordPress e oferece um
botão para copiá-la. No Google Cloud:

1. ative a Google Search Console API;
2. configure a tela de consentimento;
3. crie um cliente OAuth do tipo **Aplicativo da Web**;
4. cadastre exatamente a URI mostrada pelo plugin;
5. copie o Client ID e o Client Secret para o formulário e clique em
   **Salvar no WordPress**.

Em produção, a URI precisa usar HTTPS; HTTP é aceito somente para `localhost`,
`127.0.0.1` e `::1`. Quando o callback não é seguro, o Builder mantém a URI
visível para correção, mas desabilita os campos, **Salvar no WordPress** e
**Conectar com Google**. O backend repete a mesma validação e bloqueia tanto o
salvamento quanto o início do modo OAuth local.

O plugin solicita somente `openid`, `email` e
`https://www.googleapis.com/auth/webmasters.readonly`. O Client Secret é
cifrado antes de ser gravado no banco, não usa autoload e nunca é devolvido
pela REST API. O Builder recebe apenas o estado da configuração, uma dica
redigida do Client ID e a URI de callback.

Ao editar uma configuração existente, os campos mascarados podem permanecer
vazios para preservar o Client ID e o Client Secret atuais. Um novo valor só
substitui a credencial correspondente quando é enviado explicitamente.

A configuração é global para essa instalação do WordPress. Para evitar deixar
refresh tokens ligados ao cliente OAuth anterior, o plugin exige que todas as
contas Google sejam desconectadas antes de substituir ou remover o cliente.

### Configuração externa para instalações controladas

Hospedagens gerenciadas ainda podem definir as credenciais fora do banco, por
exemplo em `wp-config.php`:

```php
define('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID', '...apps.googleusercontent.com');
define('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET', '...');
```

Constantes e filtros de implantação têm precedência sobre o valor salvo pelo
formulário. Nesse modo o Builder informa que a configuração é gerenciada pelo
servidor e não permite alterá-la.

No cliente OAuth do Google Cloud, registre exatamente a URI mostrada no
Builder, cujo formato normal é:

```text
https://SEU-DOMINIO/wp-admin/admin-post.php?action=kodety_search_console_oauth_callback
```

### Contrato REST

O formulário usa a rota privada:

```text
GET|POST|DELETE /wp-json/kodety/v1/seo/search-console/oauth-client
```

As três operações exigem usuário autenticado, permissão de gerenciamento e
nonce REST. POST, conexão e uso de dados exigem o recurso Pro. GET devolve
somente metadados redigidos e, assim como DELETE, continua disponível ao
administrador após o vencimento da licença. Isso permite identificar e remover
a configuração sem renovar. GET nunca devolve o Client Secret nem o valor
cifrado; a interface bloqueada não permite editar ou conectar.

### Distribuição para vários domínios

Para um botão sem configuração individual em cada WordPress, use um broker
OAuth hospedado pelo Onun Kodety com uma callback fixa registrada no Google. O
plugin expõe estes contratos para o serviço:

- `kodety_search_console_oauth_broker_authorization_url` — devolve a URL de
  autorização;
- `kodety_search_console_oauth_broker_exchange` — troca o código de uso único
  por tokens e recebe o `codeVerifier` mantido no servidor para concluir o
  desafio PKCE S256;
- `kodety_search_console_oauth_broker_refresh` — renova o access token.

Para o Builder reconhecer o broker antes do primeiro clique, o provedor deve
fazer `kodety_search_console_oauth_broker_configured` retornar `true`. O hook
`kodety_search_console_oauth_broker_authorization_url` continua sendo a fonte
autoritativa da URL de autorização em cada conexão; quando ele devolve uma URL
HTTPS válida, o fluxo usa o broker em vez do cliente local. Como compatibilidade,
o plugin também reconhece a presença desse hook de autorização como indicação
de que há um broker instalado.

O broker precisa vincular cada operação à instalação licenciada, ao `state`,
ao desafio PKCE e ao `siteKey`. As respostas de exchange e refresh devem
informar `scope`, conter a permissão exata `webmasters.readonly` e não conter
`webmasters`; o plugin rejeita qualquer grant de escrita. O client secret e o
refresh token nunca devem ser enviados ao navegador.

## Segurança e isolamento

- refresh tokens e access tokens em cache são autenticados e cifrados com uma
  chave derivada dos salts do WordPress;
- o Client Secret do cliente OAuth também é cifrado, salvo sem autoload e
  projetado na REST API somente como `hasClientSecret`;
- a opção durável `kodety_search_console_client_credentials` não compartilha o
  prefixo `kodety_search_console_oauth_`, reservado aos estados efêmeros, e
  portanto não é apagada pelo cleanup normal de handshakes;
- cada projeto ativo possui credencial, propriedade, cache, quota, lock e
  relatório independentes;
- o estado OAuth é aleatório, single-use, expira em dez minutos e é vinculado
  ao usuário e ao projeto que iniciou a conexão;
- todas as rotas exigem usuário autenticado, capability e nonce REST; as rotas
  de uso exigem Pro, enquanto status mínimo e desconexão continuam disponíveis
  ao gestor para remoção da credencial;
- constantes, filtros e broker são tratados como configuração externa e têm
  precedência sobre o formulário editável do WordPress;
- os destinos da API Google são fixos e o conector usa somente o escopo de
  leitura;
- a sincronização limita paginação, tamanho de resposta e inspeções de URL.

Na desinstalação, estados de handshake, locks e access tokens temporários são
sempre removidos. A configuração durável do cliente OAuth participa do purge
explícito controlado por `KODETY_PURGE_CONFIGURATION_ON_UNINSTALL`, seguindo a
mesma política das demais configurações persistentes do Onun Kodety.

## Validação rápida

```bash
npm run search-console:test
php Wordpress/tests/search-console-runtime.php
npm run seo:test
```
