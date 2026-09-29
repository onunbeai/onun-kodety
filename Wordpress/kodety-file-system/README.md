# Onun Kodety File System

Plugin WordPress independente para gerenciamento de arquivos e assets com uma
interface própria do Onun Kodety. O shell não chama `wp_head()`, `wp_footer()` nem
carrega CSS do admin do WordPress.

## Instalação

Instale `kodety-file-system.zip` normalmente em **Plugins > Adicionar novo**.
Depois da ativação, o menu **Onun Kodety Files** abre a aplicação autenticada em
`/kodety-files/` (ou pelo fallback de query string quando permalinks não estão
disponíveis).

O modo local não depende do EasyPanel. Em uma hospedagem comum:

- o mount `public` usa `wp-content/uploads/kodety-file-system/public`;
- `project`, `private`, versões, lixeira e uploads temporários ficam em uma raiz
  específica fora do document root;
- se o host não oferecer uma raiz externa gravável, os mounts privados são
  desabilitados e a interface recebe um aviso de saúde.

## Configuração de storage

As constantes são opcionais e devem ser definidas no `wp-config.php`.

```php
define( 'KODETY_FS_STORAGE_ROOT', '/srv/kodety-storage' );
define( 'KODETY_FS_PRIVATE_ROOT', '/srv/kodety-storage' );
```

No desenho recomendado para EasyPanel, o bind mount pertence somente ao serviço
Asset API e o plugin usa o provider remoto; o container WordPress não recebe
acesso à pasta da VPS. O modo local existe para hospedagens sem esse backend. Se
você optar conscientemente por ele em Docker, painel gerenciado ou bare metal,
monte/apresente ao PHP uma pasta dedicada e aponte as constantes para o caminho
visto pelo processo WordPress. Não use uma raiz ampla (`/`, `public_html`,
`wp-content`) e não use `chmod 777`.

Se nenhum caminho for configurado, o plugin continua portátil: o mount público
fica nos uploads do WordPress e ele tenta criar uma raiz privada irmã ao
document root. Quando a hospedagem não permite essa raiz externa, somente as
funções que dependem de storage privado (lixeira, versões, chunks e mounts
protegidos) ficam desabilitadas; o painel mostra o motivo em vez de fingir que
`.htaccess` protege todos os servidores.

É possível reservar espaço livre e definir uma quota lógica para todas as
mutações locais:

```php
define( 'KODETY_FS_STORAGE_QUOTA_BYTES', 50 * 1024 * 1024 * 1024 ); // 50 GiB.
```

Mesmo sem quota explícita, o plugin recusa operações que consumiriam a reserva
mínima de segurança informada pelo filesystem. Os limites também podem ser
ajustados pelos filtros `kodety_fs_storage_quota_bytes` e
`kodety_fs_min_free_bytes`.

Para uma URL pública atendida por Nginx/CDN, configure o filtro:

```php
add_filter( 'kodety_fs_public_base_url', fn() => 'https://assets.example.com' );
```

HTML, JavaScript, SVG e XML ativos são bloqueados no mount público por padrão
para não executarem no mesmo origin do WordPress. Só habilite esses tipos quando
o filtro acima apontar para um host HTTPS realmente separado e sem cookies **e**
`KODETY_FS_STORAGE_ROOT` estiver fisicamente fora de `ABSPATH`/document root:

```php
define( 'KODETY_FS_ALLOW_PUBLIC_ACTIVE_CONTENT', true );
```

Hosts internos de uma API remota precisam de allowlist exata, além da
autenticação de serviço:

```php
define( 'KODETY_FS_REMOTE_INTERNAL_HOSTS', 'asset-api.internal' );
```

O provider remoto exige duas credenciais diferentes: um access token e um
segredo de assinatura HMAC. Ambos são criptografados no banco do WordPress e
nunca são enviados ao navegador. Por padrão, o storage remoto fica restrito a
quem possui `kodety_files_manage_storage`; delegação a outros papéis só deve ser
ativada quando a Asset API validar o contexto e os scopes assinados:

```php
define( 'KODETY_FS_REMOTE_DELEGATED_ACCESS', true );
```

Downloads remotos não são oferecidos pela UI v1 até a Asset API implementar um
contrato de URL temporária com host permitido. Isso evita transformar o
WordPress em proxy de arquivos grandes ou aceitar redirects arbitrários.

## Operação e backup

Volumes/bind mounts ficam fora do ZIP e nunca são apagados na desinstalação. Um
bind mount da VPS precisa de backup próprio (R2, S3, Backblaze ou equivalente),
incluindo a raiz privada. O rescan reconcilia o índice quando arquivos legítimos
são adicionados por SSH, mas links simbólicos e arquivos públicos ativos ou
executáveis continuam bloqueados.

O shell calcula a CSP com as origens exatas de `KODETY_FS_URL` e `rest_url()`.
Se o REST estiver em outra origem same-site, ela também precisa permitir CORS
com credenciais apenas para a origem exata do shell e os cookies de
autenticação precisam ser válidos nesse contexto. Previews autenticados usam
`Cross-Origin-Resource-Policy: same-site`; uma origem WordPress única ou
subdomínios same-site são, portanto, o contrato suportado. Uma API REST
cross-site arbitrária não é suportada. Liberar `*` com credenciais não funciona
nos navegadores e não deve ser usado.

## Capabilities

- `kodety_files_read`
- `kodety_files_upload`
- `kodety_files_edit`
- `kodety_files_delete`
- `kodety_files_manage_private`
- `kodety_files_edit_code`
- `kodety_files_share`
- `kodety_files_purge`
- `kodety_files_manage_storage`
- `kodety_files_view_audit`

Administradores recebem todas as capabilities. Editors recebem apenas leitura,
upload e edição/movimentação.

Tipos sensíveis como PHP, shell e arquivos ENV exigem, além da capability de
edição de código, uma habilitação explícita e continuam restritos aos mounts
locais protegidos:

```php
define( 'KODETY_FS_ENABLE_DANGEROUS_FILE_EDITING', true );
```

## Dados

O filesystem continua sendo a autoridade dos bytes; as tabelas WordPress são o
índice de assets, versões, metadados, lixeira, usos, compartilhamentos e log de
atividade. A desinstalação preserva os arquivos de storage por segurança.
