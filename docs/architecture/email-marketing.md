# Email Marketing (Kodety) — arquitetura

Addon nativo do Kodety: construtor de email, listas de contato e campanhas em massa.
Não é um plugin WordPress separado — vive dentro de `Wordpress/kodety/`, como
`Kodety_Members` e `Kodety_Analytics`.

**Restrição de projeto: zero dependência de serviço externo.** O próprio WordPress
é o backend. Nenhum SendGrid, SES, Resend ou API de terceiro. Todo driver de envio
usa apenas PHP + a stack de email do servidor do cliente.

---

## 1. O que o WordPress consegue fazer sozinho (e o que não consegue)

Consegue, 100% self-hosted:

| Necessidade | Solução WP-only |
| --- | --- |
| Entregar SMTP | `PHPMailer` (já embarcado no WP) via `phpmailer_init` |
| Assinar DKIM | `PHPMailer::$DKIM_domain/$DKIM_selector/$DKIM_private` (nativo) |
| Gerar par de chaves DKIM | `openssl_pkey_new()` |
| Auditar SPF/DKIM/DMARC/PTR | `dns_get_record()`, `gethostbyaddr()` |
| Fila, retry, throttle | Tabela própria + WP-Cron (+ cron real do sistema) |
| Abertura / clique | Endpoint de pixel e endpoint de redirect assinado |
| Descadastro | Token HMAC + header `List-Unsubscribe` / `One-Click` |
| Bounce sem webhook | Return-Path VERP + leitura IMAP/POP3 da caixa de retorno |
| Hospedar imagens | Media Library do WP (`Kodety_Media` já existe) |

**Não consegue, e nenhum código resolve:** reputação de IP. Se o site roda em
hospedagem compartilhada com IP em blocklist, sem PTR e sem SPF/DKIM publicados, o
email cai em spam — independente da qualidade do nosso código. Por isso o módulo
**não esconde** isso: ele tem uma tela de *Saúde de entrega* que audita o servidor,
mostra os registros DNS exatos para colar e bloqueia campanha grande enquanto o
domínio não estiver autenticado. Honestidade aqui é feature, não fricção.

### Drivers de envio (todos self-hosted)

`Kodety_Email_Transport` — interface interna fina. Nenhum driver de terceiro.

1. **`local`** (default) — `wp_mail()` → `mail()`/sendmail do servidor (Postfix/Exim
   do host). Funciona em qualquer lugar, zero config.
2. **`smtp`** — SMTP que **o cliente possui**: o servidor de email do próprio
   domínio, um Postfix em VPS, o SMTP da hospedagem. Host/porta/credenciais nas
   settings. Não é vendor: é a infra dele.
3. **`mx-direct`** (avançado, opt-in) — entrega direta ao MX do destinatário:
   `dns_get_record($domain, DNS_MX)` → PHPMailer aponta pro MX na porta 25. Faz do
   WordPress o próprio MTA. Exige porta 25 liberada na saída, PTR correto e IP
   dedicado. A fila já dá o retry/backoff que um MTA precisa. A UI só oferece esse
   modo depois do preflight passar.

Em todos os três, o Kodety assina DKIM, escreve o Return-Path VERP e aplica o
throttle. A escolha do driver não muda mais nada do sistema.

---

## 2. Modelo de dados

Novas tabelas, prefixo `{$wpdb->prefix}kodety_email_*`, criadas por `dbDelta` no
padrão já usado pelas outras classes (`DB_VERSION` + `maybe_upgrade`).

```
kodety_email_contacts        id, email(unique), name, status, consent_source,
                            consent_at, ip_hash, locale, timezone,
                            attributes(longtext json), unsubscribed_at,
                            bounced_at, complaint_at, created_at, updated_at
kodety_email_lists           id, name, slug, description, double_optin, created_at
kodety_email_list_contacts   list_id, contact_id, added_at, source   (PK composta)
kodety_email_segments        id, name, filters_json, cached_count, refreshed_at
kodety_email_templates       id, name, kind(campaign|automation|system),
                            project_json(longtext), html, thumbnail_id, updated_at
kodety_email_campaigns       id, name, subject, preheader, from_name, from_email,
                            reply_to, template_id, audience_json,
                            status(draft|scheduled|sending|paused|sent|failed),
                            scheduled_at, sent_at, stats_json, revision
kodety_email_queue           id, campaign_id, contact_id, status, attempts,
                            next_attempt_at, locked_until, message_id,
                            verp_token, error, sent_at
kodety_email_events          id, campaign_id, contact_id, type(sent|open|click|
                            bounce|complaint|unsubscribe), url, ip_hash,
                            user_agent, occurred_at
kodety_email_suppressions    email(PK), reason, campaign_id, created_at
```

`status` de contato: `subscribed | pending | unsubscribed | bounced | complained`.
`kodety_email_suppressions` é consultada **antes de enfileirar** e é global — um
hard bounce nunca é reenviado por nenhuma campanha.

**Fonte da verdade é a tabela própria**, não `wp_users`: um lead que só deixou o
email num formulário não deve virar usuário WordPress. Conectores de entrada
(opt-in, por lista):

- submissões de `Kodety_Emails` (formulários do builder)
- membros de `Kodety_Members`
- compradores de `Kodety_Checkouts`
- usuários WP por role
- import CSV

---

## 3. Construtor de email

**Não clonar `HtmlProjectEditor.tsx` (13.347 linhas).** Clonar cria uma segunda
implementação divergente. Preserve uma única implementação compartilhada para esse contrato.

O caminho é **reusar as primitivas** de `lib/html-editor/` num shell novo e enxuto:

```
lib/email-editor/
  types.ts              EmailDocument = HtmlProject de 1 arquivo + meta do email
  blocks.ts             catálogo de blocos email-safe
  render.ts             árvore de blocos -> HTML de tabelas
  inline-css.ts         CSS -> style="" inline (usa postcss, já é dep)
  compat.ts             lint de compatibilidade (Outlook/Gmail/Apple Mail)
  mjml-lite.ts          helpers de MSO conditional comments
  import-zip.ts         ZIP externo -> EmailDocument + upload de assets

app/(builder)/kodety/email-editor/components/
  KodetyEmailEditor.tsx        shell (canvas + inspector + navigator)
  EmailBlockLibrary.tsx
  EmailInspector.tsx
  EmailPreviewFrame.tsx       desktop / mobile / texto puro
  EmailCompatPanel.tsx
```

Reaproveitado de `lib/html-editor/` sem fork: `css-patcher.ts` (escrita de CSS por
seletor/breakpoint), `preview.ts`, `project-io.ts`, `asset-tree.ts`, e os controles
de UI (`HtmlCssLengthField`, `HtmlClassSelector`, componentes de `components/ui`).

### O que "email-safe" significa aqui

O builder de site gera HTML moderno (flex/grid, classes utilitárias). Email não
aceita isso. Regras do renderizador de email:

- **Layout por `<table>`**, não flex/grid. Blocos de coluna emitem
  `<table role="presentation">` com `<td>` — e conditional comments MSO onde o
  Outlook precisa.
- **Largura fixa** (default 600px) num container centralizado.
- **CSS inline obrigatório** no build final. O autor edita com classes (produtivo);
  `inline-css.ts` resolve tudo para `style=""` na exportação. `<style>` no `<head>`
  fica só para o que não pode ser inline: media queries e pseudo-classes.
- **Mobile = media query**, não breakpoint do builder. Um único
  `@media (max-width:600px)` com as classes de stack (`.kodety-stack`,
  `.kodety-hide-mobile`) — o único mecanismo responsivo que Gmail/Apple Mail honram.
  Gmail app ignora media query: por isso a coluna também é fluida por padrão.
- **Sem JS, sem webfont crítica, sem background-image crítica.** Fallback de
  `background-color` sempre presente; `VML` para background em Outlook.
- **Imagens absolutas** apontando pra Media Library, com `width`/`height`
  explícitos e `alt` obrigatório (lint bloqueia sem alt).
- **Versão texto puro** gerada automaticamente do documento (multipart/alternative)
  — sem isso o filtro de spam pune.

`EmailCompatPanel` roda `compat.ts` e mostra avisos acionáveis antes do envio
("Outlook não suporta `border-radius` neste botão", "imagem sem alt", "peso do HTML
acima de 102KB — Gmail vai truncar").

### Blocos v1

Seção/container, coluna (1–4, com stack no mobile), texto rico, imagem, botão
(VML-safe), divisor, espaçador, social, HTML bruto, rodapé com merge tags legais.

### Merge tags e personalização

`{{contact.name}}`, `{{contact.email}}`, `{{contact.attributes.plano}}`,
`{{campaign.subject}}`, `{{unsubscribe_url}}`, `{{view_in_browser_url}}`.
Resolvidas em PHP no momento do envio (não no builder), com escape de HTML e valor
default por tag. `{{unsubscribe_url}}` é **obrigatória** — o lint impede enviar sem.

### Import de ZIP externo

`POST kodety/v1/email/import-zip`: valida (zip bomb, path traversal, MIME
allowlist — reusar as guardas de `Kodety_Plugin::import` e `Kodety_Security`), extrai
o HTML principal, sobe cada imagem pela Media Library, reescreve os `src` relativos
para as URLs absolutas do WP e grava como template. O HTML importado é preservado
como está (modo "HTML bruto"); o autor pode editar por regiões marcadas em vez de
re-parsear tudo em blocos.

---

## 4. Envio: fila, disparo e throttle

**v1 é disparo manual.** Não há agendamento nem automação: o autor abre a campanha,
clica em *Enviar agora* e acompanha a barra de progresso. Os campos legados
`scheduled_at` e `status='scheduled'` continuam no schema apenas para migração;
ao atualizar, campanhas antigas voltam a rascunho e nenhuma agenda é registrada.
Automação futura vira um novo *gatilho* para a mesma fila, mediante uma decisão
explícita de produto.

Envio manual **não elimina a fila**: 5.000 emails não cabem numa requisição HTTP.
O que muda é quem bate o relógio.

```
Campanha "Enviar agora"
  -> resolve audiência (listas ∪ segmentos − suppressions − unsubscribed − bounced)
  -> insere N linhas em kodety_email_queue (status=pending), em lotes de 1000
  -> status da campanha = sending
  -> a tela começa a bater o tick e mostra o progresso
```

Worker (`kodety_email_tick`):

1. Claim de lote com `UPDATE ... SET locked_until = NOW()+120 WHERE status='pending'
   AND next_attempt_at <= NOW() LIMIT :batch` — lock por linha, seguro contra dois
   ticks concorrentes.
2. Para cada item: renderiza merge tags, monta multipart, assina DKIM, define
   Return-Path VERP, envia pelo driver.
3. Sucesso → `status=sent` + evento `sent`. Falha 4xx temporária → `attempts++`,
   `next_attempt_at = NOW() + backoff(attempts)` (1m, 5m, 30m, 2h, 6h; 5 tentativas).
   Falha 5xx permanente → `status=failed` + suppression + evento `bounce`.
4. Respeita `emails_per_minute` / `emails_per_hour` e um watchdog de tempo de
   execução (para antes do `max_execution_time`).

### Quem bate o tick

Com disparo manual, o **navegador do autor é o motor principal** — não um fallback.
Ele acabou de clicar em enviar e está olhando a tela.

1. **Browser tick (principal).** Enquanto a tela da campanha está aberta, o React
   faz poll em `POST kodety/v1/email/tick`, que processa um lote e devolve
   `{ sent, pending, failed, throttledUntil }`. A barra de progresso é o retorno
   real da fila. Zero dependência de cron, de tráfego ou de acesso ao host.
2. **WP-Cron (retomada).** Se a aba fechar no meio, a campanha fica `sending` com
   itens pendentes. O `kodety_email_tick` agendado retoma em best-effort. Aqui o
   pseudo-cron é aceitável porque é rede de segurança, não caminho crítico.
3. **Cron real (opcional, recomendado em volume).** A tela de Saúde de entrega
   mostra a linha pronta — `*/1 * * * * cd /path && wp kodety email tick --quiet`
   com `DISABLE_WP_CRON` — para quem envia muito ou quer fechar o notebook.

Consequência importante: **v1 não tem nenhum caminho crítico dependente de cron.**
Os únicos jobs agendados (leitura de bounce, limpeza de eventos) toleram jitter de
horas, exatamente como os crons que o Kodety já usa hoje.

A UI precisa ser honesta sobre o caso "fechei a aba": ao reabrir uma campanha
`sending` com pendentes, mostra `X de Y enviados` e um botão **Retomar envio**, em
vez de fingir que continuou sozinha. Fechar a aba nunca duplica entrega — o claim
por linha e o `status=sent` na mesma transação garantem isso.

Warm-up: as primeiras campanhas de um domínio novo têm cap sugerido crescente
(50/dia → 200 → 1000…), porque disparar 10 mil emails de um IP virgem é a receita
mais rápida pra blocklist.

---

## 5. Tracking, descadastro e bounce — sem webhook

- **Abertura**: `GET /kodety-email/o/{token}.gif` (rewrite rule, igual ao padrão de
  `kodety_variant`) → grava evento `open`, devolve GIF 1x1. Token = HMAC de
  `campaign_id|contact_id` com `wp_salt()`. Configurável (privacidade).
- **Clique**: `GET /kodety-email/c/{token}?u=<url assinada>` → grava `click`, valida
  a assinatura da URL (impede open redirect) e faz `wp_safe_redirect`.
- **Descadastro**: `GET /kodety-email/u/{token}` → página de preferências (por lista
  ou tudo). Headers `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  em toda campanha — Gmail e Yahoo já exigem isso pra remetentes em volume.
- **Bounce sem webhook**: Return-Path VERP `bounce+{token}@dominio`. Um leitor
  IMAP/POP3 (`kodety_email_bounces`, de hora em hora) abre a caixa de retorno,
  casa o token, classifica hard/soft pelo DSN (`Status: 5.x.x` vs `4.x.x`) e
  aplica suppression no hard. Caixa de retorno é do cliente — nada externo.
- **Reclamação (FBL)**: mesma caixa, detecta `report-type=feedback-report` →
  suppression imediata.

---

## 6. Interface, rotas e menu

Segue exatamente o padrão de `members`: a UI vive no shell React do Kodety, e o
wp-admin só leva pra lá.

**Menu (o dropdown pedido).** `Kodety_Emails::admin_menu()` já cria o top-level
`kodety-emails` ([class-kodety-emails.php:105](../../Wordpress/kodety/includes/class-kodety-emails.php#L105)).
Basta adicionar submenus — o WP transforma o item em dropdown automaticamente:

```
Emails  (top-level existente)
├── Caixa de entrada        kodety-emails            (atual, formulários)
├── Email Marketing         kodety-email-marketing   -> /kodety/email/
├── Campanhas               kodety-email-campaigns   -> /kodety/email/campaigns/
├── Contatos                kodety-email-contacts    -> /kodety/email/contacts/
├── Templates               kodety-email-templates   -> /kodety/email/templates/
├── Saúde de entrega        kodety-email-health      -> /kodety/email/health/
└── Configurações           kodety-emails-settings   (atual)
```

Os itens novos usam `'__return_null'` como callback e são redirecionados no
`admin_init`, igual a `kodety-cms-collections` em
[class-kodety-plugin.php:1474](../../Wordpress/kodety/includes/class-kodety-plugin.php#L1474).

**Rotas do shell** (`Kodety_Plugin::add_rewrite_rule`, ~linha 226):

```php
add_rewrite_rule('^kodety/email/?$',            'index.php?kodety_app=email', 'top');
add_rewrite_rule('^kodety/email/([a-z-]+)/?$',  'index.php?kodety_app=email&kodety_email_view=$matches[1]', 'top');
```

E em `app_template()`: `'email' => 'kodety_manage_email_marketing'` no match de
capability. Novas caps: `kodety_manage_email_marketing` (editar/enviar) e
`kodety_view_email_marketing` (ler relatórios), concedidas ao administrator no
`activate()`.

**Bundle.** `appView` em [editor-shell.php:26](../../Wordpress/kodety/templates/editor-shell.php#L26)
ganha `'email'`; `HtmlProjectEditor` faz lazy-load de `KodetyEmailEditor` nesse
modo (`React.lazy`) — o chunk de email não pesa no carregamento do editor de site.
Adicionar o grupo correspondente em `wordpressEditorChunk()` no
`Wordpress/vite.config.ts`.

**REST** (`kodety/v1/email/*`): `contacts`, `contacts/import`, `lists`, `segments`,
`templates`, `templates/{id}/render`, `campaigns`, `campaigns/{id}/test`,
`campaigns/{id}/send`, `campaigns/{id}/pause`, `campaigns/{id}/report`,
`import-zip`, `tick`, `health`, `settings`. Todas com
`permission_callback` de capability + nonce `wp_rest`, no padrão das rotas atuais.

**Código PHP.** `includes/class-kodety-email-marketing.php` é a fachada, mas o
módulo **não** deve virar outro arquivo de 500KB como `class-kodety-plugin.php`.
Split desde o início:

```
includes/email/class-kodety-email-contacts.php
includes/email/class-kodety-email-campaigns.php
includes/email/class-kodety-email-queue.php
includes/email/class-kodety-email-transport.php     interface + local/smtp/mx-direct
includes/email/class-kodety-email-renderer.php      merge tags, multipart, texto puro
includes/email/class-kodety-email-tracking.php      pixel, clique, unsubscribe
includes/email/class-kodety-email-bounces.php       IMAP/POP3 + DSN
includes/email/class-kodety-email-health.php        SPF/DKIM/DMARC/PTR/porta
includes/email/class-kodety-email-rest.php
```

---

## 7. Segurança e conformidade

- Envio em massa exige capability dedicada + confirmação explícita com contagem.
- Rate limit por usuário em `campaigns/{id}/send` (reusar `Kodety_Security`).
- Import CSV: limite de tamanho, validação de email, dedupe, e registro de
  `consent_source` — não existe import sem origem de consentimento declarada.
- Nunca enviar para `status != subscribed`, nunca para suppression.
- Anti-abuso: o Kodety não pode virar plataforma de spam de terceiro. Domínio do
  `from_email` precisa casar com o site (ou passar verificação DNS).
- LGPD/GDPR: exportar e apagar contato (endpoint), retenção configurável de eventos
  (`retention_days`, como já existe em `Kodety_Emails` e `Kodety_Analytics`), IP
  sempre em hash.
- Preflight obrigatório antes do primeiro envio: SPF, DKIM publicado, DMARC,
  from verificado, unsubscribe presente, versão texto presente.

---

## 8. Fases

**Fase 0 — fundação (sem UI nova)**
Tabelas, caps, `Kodety_Email_Transport` com driver `local`, assinatura DKIM +
geração de chave, tela de Saúde de entrega, fila + endpoint de tick. Testável por
WP-CLI. *Prova: enviar 1 email autenticado, DKIM `pass` no cabeçalho recebido.*

**Fase 1 — construtor**
`lib/email-editor/` + `KodetyEmailEditor`, blocos v1, inliner de CSS, preview
desktop/mobile/texto, lint de compatibilidade, templates, import de ZIP.
*Prova: template criado no builder passa no lint e renderiza igual em Gmail,
Outlook e Apple Mail.*

**Fase 2 — audiência**
Contatos, listas, import CSV, conectores (formulários, members, checkouts),
segmentos, double opt-in, preferências e descadastro.

**Fase 3 — campanhas (disparo manual)**
Audiência, envio de teste, **Enviar agora** com fila + browser tick, progresso ao
vivo, throttle, warm-up, pausar/retomar. Tracking de abertura/clique. Bounce por
IMAP. Relatório da campanha. Sem agendamento na UI.
*Prova: 5.000 destinatários entregues respeitando throttle, com bounce processado,
e uma campanha interrompida por fechamento de aba retomada sem duplicar entrega.*

**Fase 4 — depois**
Automações recorrentes e por gatilho (drip, formulário, compra, novo membro),
A/B de assunto, relatórios comparativos, RSS-to-email, integração com
`Kodety_Analytics` para atribuição de receita. Qualquer agendamento futuro exige
uma decisão explícita de produto e não é ativado por campos legados do schema.

---

## 9. Validação

Cada fase entra em `npm run ci:local`. Novos scripts no padrão de `scripts/`:

- `scripts/test-email-editor.mjs` — contratos do editor de email
- `scripts/test-email-inliner.mjs` — snapshots de CSS inline e tabelas
- `scripts/test-email-queue.mjs` — claim concorrente, backoff, throttle
- `scripts/test-email-runtime.mjs` — tracking, tokens, unsubscribe
- `lint-wordpress-php.mjs` já cobre a sintaxe dos novos arquivos PHP

Contratos do pacote (`scripts/wordpress-package-contracts.mjs`) precisam listar os
novos arquivos PHP e o chunk do editor de email.
