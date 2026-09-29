# Media Library

O serviço usa attachments WordPress e nunca move arquivos para o workspace do
site ou para a pasta privada da extensão.

## Ler

```php
$item = $extension->media()->get(123);
if ($item) {
    // id, title, url, mime, alt e metadata
}

$images = $extension->media()->query([
    'post_mime_type' => 'image',
    'posts_per_page' => 20,
]);
```

`get()` e `query()` exigem `media.read`. `query()` recebe argumentos de
`get_posts`, mas força defaults seguros para attachment/inherit/ids. Limite a
quantidade e não exponha attachments privados por endpoints públicos.

## Enviar

```php
$attachment_id = $extension->media()->upload([
    'name' => 'cover.jpg',
    'tmp_name' => $temporary_file,
], 0, 'upload_files');

if (is_wp_error($attachment_id)) {
    // Trate e apresente mensagem segura.
}
```

Upload exige:

- `media.write` em `permissions`;
- `upload_files` em `capabilities`;
- usuário atual com `upload_files`;
- arquivo temporário aceito pelas regras MIME do WordPress.

O método usa `media_handle_sideload` e retorna ID ou `WP_Error`. Ele não baixa
URLs remotas. Se a extensão fizer download por conta própria, aplique allowlist
de protocolo/host, timeout, limite de bytes, bloqueio de rede privada, validação
MIME e limpeza do temporário para evitar SSRF e exaustão de disco.

Use attachment IDs como referência persistente. URLs e metadata podem mudar
após regeneração, CDN ou substituição. Não apague um attachment compartilhado
ao excluir um registro sem confirmar ownership exclusivo.

