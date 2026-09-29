# Autenticação da área de membros

A identidade pública de membros é isolada da autenticação administrativa do
WordPress. Login, cadastro, link mágico e logout do site nunca chamam
`wp_set_auth_cookie()`, `wp_signon()` ou `wp_logout()`.

## Sessão pública

- Cookie host-only `HttpOnly`, `SameSite=Lax`, caminho `/` e `Secure` em sites
  HTTPS.
- Bearer aleatório de 256 bits; apenas o hash identifica o transient no
  servidor.
- Duração de 12 horas ou 30 dias com “lembrar”.
- Prova vinculada ao hash atual da senha. Redefinir a senha invalida sessões
  anteriores.
- Operações mutáveis exigem origem local e `X-Kodety-Member-CSRF`.
- Logout remove somente a sessão Kodety. A sessão do editor no WP Admin não é
  alterada.

Transients são um armazenamento fail-closed: expiração, limpeza de cache ou
evicção encerram a sessão e exigem novo login; nunca concedem acesso sem estado
válido no servidor.

## Fronteira de identidade

Somente contas Kodety marcadas como `active`, `invited` ou `suspended`, usando
uma função pública segura (`subscriber` ou `customer` sem capabilities
elevadas), pertencem ao domínio de membros. Contas legadas sem marcador só são
migradas quando existe evidência em grant, assinatura ou auditoria Kodety.

Contas de editor e administrador não podem abrir sessão pública. Contas de
membro não podem autenticar pelo login nativo nem usar Application Passwords.
Uma conta suspensa pode redefinir a senha, mas não abrir sessão.

## Conteúdo e checkout

Páginas, condicionais, downloads protegidos e checkout público resolvem
exclusivamente `Kodety_Members::current_member_id()`. A identidade nativa do
WordPress permanece reservada para APIs administrativas do Builder e do
WP Admin.

Login, conta e redefinição usam somente URLs same-origin configuradas no
Builder. Os fluxos públicos não geram links para `wp-login.php`.
