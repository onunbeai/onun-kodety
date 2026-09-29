# Integração frontend

A API v1 oferece shortcodes namespaced e enqueue de assets. Ela não expõe o
renderer interno, o CMS nativo nem a árvore do Builder.

## Runtime do site publicado

Use wrappers públicos para resolver um template/contexto próprio e transformar
o HTML final. Não registre diretamente nos filtros internos.

```php
$frontend = $extension->frontend();

$frontend->register_runtime_context_resolver(
    static function (
        array $runtime_context,
        Kodety_Extension_Context $extension
    ): array {
        if (!is_singular('vendor_project')) return $runtime_context;
        $runtime_context['pageRelative'] = 'case.html';
        $runtime_context['extensionOwner'] = $extension->slug();
        return $runtime_context;
    },
    priority: 20,
    accepted_args: 1
);

$frontend->register_runtime_html_transformer(
    static function (
        string $html,
        array $runtime_context,
        Kodety_Extension_Context $extension
    ): string {
        if (($runtime_context['extensionOwner'] ?? '') !== $extension->slug()) return $html;
        return Vendor_Project_Renderer::render_into_markers($html);
    },
    priority: 20,
    accepted_args: 2
);
```

Assinaturas:

```php
register_runtime_context_resolver(
    callable $resolver,
    int $priority = 10,
    int $accepted_args = 1
): string

register_runtime_html_transformer(
    callable $transformer,
    int $priority = 10,
    int $accepted_args = 2
): string
```

O resolver recebe o runtime context e, por último, o contexto da extensão. Seu
`accepted_args` precisa ser `1`. O transformer pode usar `accepted_args=1`
(`$html`, `$extension`) ou `2` (`$html`, `$runtime_context`, `$extension`). A
prioridade aceita valores de `-10000` a `10000`. Ambos exigem
`frontend.register` e retornam o nome do filtro registrado.

Callbacks sempre executam dentro do contexto capturado, portanto
`kodety_extension()` também aponta para a extensão durante a chamada. Exception
ou retorno de tipo inválido não substitui a página: a API registra o erro no log
e preserva o array/HTML recebido.

Um resolver deve devolver o contexto intacto quando a request não pertence à
extensão. Um transformer deve operar somente em markers próprios e nunca fazer
replace global de conteúdo arbitrário. O filtro HTML ocorre depois que o markup
autoral e integrações `wp_head`/`wp_footer` foram montados; preserve conteúdo,
SEO, acessibilidade e scripts que não pertencem à extensão.

## Shortcode

```php
$name = $extension->frontend()->shortcode(
    'project-card',
    static function (array|string $attributes, ?string $content, Kodety_Extension_Context $extension): string {
        $attributes = shortcode_atts(['id' => 0], is_array($attributes) ? $attributes : []);
        return '<article data-project="' . esc_attr((string) absint($attributes['id'])) . '">'
            . wp_kses_post((string) $content)
            . '</article>';
    }
);
```

Para o slug `vendor-feature`, o nome retornado é
`kodety_vendor_feature_project_card`. Registrar exige `frontend.register`.
Se o renderer lançar um `Throwable`, a API registra `shortcode.render` e devolve
string vazia, sem publicar output parcial ou detalhes da exception.

## Assets empacotados

```php
$frontend = $extension->frontend();
$css = $frontend->asset_url('assets/frontend.css');
$frontend->enqueue_style('frontend', $css, [], '1.2.0');
```

`asset_url()` exige `frontend.read`, aceita somente arquivo existente dentro do
pacote e funciona quando o storage de extensões está sob o diretório público de
uploads. Se `KODETY_EXTENSIONS_DIR` aponta para storage privado, publique assets
por um CDN/URL controlado ou produza markup sem assets locais; a API não torna o
diretório privado público.

`enqueue_style()` e `enqueue_script()` exigem `frontend.register`, validam a URL
e geram handles com o slug. Scripts são enfileirados no footer por padrão.

## Block types

```php
$canonical = $extension->blocks()->register('project-gallery', [
    'title' => 'Project gallery',
    'category' => 'media',
    'attributes' => ['projectId' => ['type' => 'integer']],
    'render' => static fn(array $attributes): string => '<div>...</div>',
]);
```

O nome será `vendor-feature/project-gallery` e ficará disponível no registry
`kodety_extension_block_types()`. Registrar exige `blocks.register`. A API v1
estabiliza o registry e o callback server-side; não promete componentes
visuais internos do editor.

Se o callback `render` lançar um `Throwable`, o registry registra
`block.render` e devolve string vazia. Isso mantém a página disponível; a
extensão deve monitorar o log para não deixar o fallback passar despercebido.

## Segurança de renderização

- escape texto com `esc_html`, atributos com `esc_attr` e URLs com `esc_url`;
- use `wp_kses_post` somente quando HTML limitado for uma decisão explícita;
- nunca renderize rascunhos ou dados privados em callbacks públicos;
- não injete scripts inline construídos com conteúdo do usuário;
- preserve acessibilidade e não dependa de classes CSS privadas do Onun Kodety.
