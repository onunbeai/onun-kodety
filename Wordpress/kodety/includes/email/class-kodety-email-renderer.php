<?php
/**
 * Personalização e preparo final da mensagem.
 *
 * O HTML já chega inline do construtor de email — inlining de CSS é trabalho
 * de exportação do builder, não de runtime. Aqui acontece o que só pode
 * acontecer no momento do envio, porque depende do destinatário: merge tags,
 * reescrita de links para rastreamento, pixel e versão texto.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Renderer {
    /**
     * @return array{subject:string,html:string,text:string,unsubscribe_url:string}
     */
    public static function render(
        array $campaign,
        array $contact,
        ?array $settings = null,
        bool $test_mode = false
    ): array {
        $campaign_id = (int) ($campaign['id'] ?? 0);
        $contact_id = (int) ($contact['id'] ?? 0);
        $settings ??= Kodety_Email_Settings::for_campaign($campaign);

        // Testes não representam um contato persistido. Fragmentos deixam os
        // links claramente não acionáveis e evitam tokens inválidos com id 0.
        $unsubscribe_url = $test_mode
            ? '#kodety-test-unsubscribe'
            : Kodety_Email_Tracking::unsubscribe_url($campaign_id, $contact_id);
        $view_url = $test_mode
            ? '#kodety-test-view-in-browser'
            : Kodety_Email_Tracking::view_url($campaign_id, $contact_id);
        $tokens = self::tokens($campaign, $contact, $unsubscribe_url, $view_url);

        // O assunto é texto puro no cabeçalho MIME: escapar aqui transformaria
        // "Bolsas & Sapatos" em "Bolsas &amp; Sapatos" na caixa de entrada.
        $subject = self::replace((string) ($campaign['subject'] ?? ''), $tokens, false);
        $html = self::replace((string) ($campaign['html'] ?? ''), $tokens);

        if (!$test_mode && !empty($settings['track_clicks'])) {
            $html = self::rewrite_links($html, $campaign_id, $contact_id, $unsubscribe_url);
        }

        // O valor ainda é texto neste ponto. inject_preheader() faz o único
        // escape HTML; escapar aqui também transformaria & em &amp;amp;.
        $preheader = self::replace((string) ($campaign['preheader'] ?? ''), $tokens, false);
        if ($preheader !== '') $html = self::inject_preheader($html, $preheader);

        if (!$test_mode && !empty($settings['track_opens'])) {
            $html = self::inject_pixel($html, $campaign_id, $contact_id);
        }

        $text = (string) ($campaign['text_body'] ?? '');
        $text = $text !== '' ? self::replace($text, $tokens, false) : self::html_to_text($html);

        return [
            'subject' => $subject,
            'html' => $html,
            'text' => $text,
            'unsubscribe_url' => $unsubscribe_url,
        ];
    }

    /**
     * Tokens disponíveis no assunto e no corpo.
     *
     * Todo valor é escapado: um contato cujo nome contenha HTML não pode
     * injetar markup no email de ninguém.
     *
     * @return array<string,string>
     */
    private static function tokens(
        array $campaign,
        array $contact,
        string $unsubscribe_url,
        string $view_url
    ): array {
        $attributes = json_decode((string) ($contact['attributes'] ?? ''), true);
        $attributes = is_array($attributes) ? $attributes : [];

        $email = (string) ($contact['email'] ?? '');
        $name = trim((string) ($contact['name'] ?? ''));
        // Sem nome, o primeiro trecho do email é um fallback melhor do que um
        // "Olá, " vazio no meio da frase.
        if ($name === '') $name = ucfirst(strtok($email, '@') ?: '');

        $tokens = [
            'contact.name' => $name,
            'contact.first_name' => strtok($name, ' ') ?: $name,
            'contact.email' => $email,
            'campaign.subject' => (string) ($campaign['subject'] ?? ''),
            'site.name' => (string) get_bloginfo('name'),
            'site.url' => (string) home_url('/'),
            'unsubscribe_url' => $unsubscribe_url,
            'view_in_browser_url' => $view_url,
        ];

        foreach ($attributes as $key => $value) {
            if (!is_scalar($value)) continue;
            $tokens['contact.attributes.' . $key] = (string) $value;
        }

        return $tokens;
    }

    /**
     * Substitui `{{token}}` com espaços opcionais. Token desconhecido vira
     * string vazia — melhor um espaço em branco do que `{{contact.nome}}`
     * literal chegando na caixa do cliente.
     */
    private static function replace(string $content, array $tokens, bool $html_context = true): string {
        if ($content === '' || !str_contains($content, '{{')) return $content;

        return (string) preg_replace_callback(
            '/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/',
            static function (array $matches) use ($tokens, $html_context): string {
                $key = $matches[1];
                if (!array_key_exists($key, $tokens)) return '';

                $value = $tokens[$key];
                if (!$html_context) return $value;

                // URLs entram em atributos href e não podem ser escapadas como
                // texto, sob pena de virar &amp; no meio da query.
                return str_ends_with($key, '_url') ? esc_url($value) : esc_html($value);
            },
            $content
        );
    }

    /**
     * Troca cada href externo por um redirecionamento assinado.
     *
     * Preserva mailto:, tel:, âncoras e o próprio link de descadastro —
     * rastrear o descadastro atrapalharia o one-click dos provedores.
     */
    private static function rewrite_links(string $html, int $campaign_id, int $contact_id, string $unsubscribe_url): string {
        return (string) preg_replace_callback(
            '/href=(["\'])(.*?)\1/i',
            static function (array $matches) use ($campaign_id, $contact_id, $unsubscribe_url): string {
                $quote = $matches[1];
                $url = html_entity_decode($matches[2], ENT_QUOTES, 'UTF-8');

                if ($url === '' || $url === $unsubscribe_url) return $matches[0];
                if (preg_match('/^(mailto:|tel:|sms:|#|\{\{)/i', $url)) return $matches[0];

                $scheme = strtolower((string) wp_parse_url($url, PHP_URL_SCHEME));
                if (!in_array($scheme, ['http', 'https'], true)) return $matches[0];

                $tracked = Kodety_Email_Tracking::click_url($campaign_id, $contact_id, $url);
                return 'href=' . $quote . esc_url($tracked) . $quote;
            },
            $html
        );
    }

    /**
     * Preheader: o texto de prévia que aparece na lista de mensagens, depois
     * do assunto. Fica escondido no corpo, seguido de espaços invisíveis para
     * o cliente não emendar o início do email na prévia.
     */
    private static function inject_preheader(string $html, string $preheader): string {
        $block = '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">'
            . esc_html($preheader)
            . str_repeat('&#8199;&#65279;&#847; ', 30)
            . '</div>';

        $position = stripos($html, '<body');
        if ($position === false) return $block . $html;

        $close = strpos($html, '>', $position);
        if ($close === false) return $block . $html;

        return substr($html, 0, $close + 1) . $block . substr($html, $close + 1);
    }

    private static function inject_pixel(string $html, int $campaign_id, int $contact_id): string {
        $pixel = '<img src="' . esc_url(Kodety_Email_Tracking::open_url($campaign_id, $contact_id))
            . '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">';

        $position = stripos($html, '</body>');
        return $position === false ? $html . $pixel : substr_replace($html, $pixel, $position, 0);
    }

    /**
     * Versão texto. Não é opcional: mensagem só-HTML é penalizada por filtro
     * de spam, e alguns clientes ainda exibem só o texto.
     */
    public static function html_to_text(string $html): string {
        $text = preg_replace('#<(script|style)[^>]*>.*?</\1>#is', '', $html);
        $text = preg_replace('#</(p|div|tr|h[1-6]|li)>#i', "\n", (string) $text);
        $text = preg_replace('#<br\s*/?>#i', "\n", (string) $text);

        // Mantém o destino dos links, que some ao remover as tags.
        $text = preg_replace_callback(
            '#<a[^>]+href=(["\'])(.*?)\1[^>]*>(.*?)</a>#is',
            static function (array $matches): string {
                $label = trim(wp_strip_all_tags($matches[3]));
                $url = html_entity_decode($matches[2], ENT_QUOTES, 'UTF-8');
                if ($label === '') return $url;
                // Parênteses sobrevivem ao wp_strip_all_tags() abaixo. Usar
                // `<url>` faria o parser interpretar o destino como tag HTML e
                // apagar justamente a informação que esta etapa preserva.
                return $label . ' (' . $url . ')';
            },
            (string) $text
        );

        $text = wp_strip_all_tags((string) $text);
        $text = html_entity_decode($text, ENT_QUOTES, 'UTF-8');
        $text = preg_replace("/[ \t]+/", ' ', $text);
        $text = preg_replace("/\n{3,}/", "\n\n", (string) $text);

        return trim((string) $text);
    }

    /**
     * Lint de pré-envio. Roda antes de enfileirar: é mais barato recusar aqui
     * do que descobrir o problema com 5.000 emails já entregues.
     *
     * @return array<int,array{level:string,message:string}>
     */
    public static function lint(array $campaign): array {
        $issues = [];
        $html = (string) ($campaign['html'] ?? '');

        if (trim($html) === '') {
            $issues[] = ['level' => 'error', 'message' => 'A campanha não tem conteúdo HTML.'];
        }
        if (trim((string) ($campaign['subject'] ?? '')) === '') {
            $issues[] = ['level' => 'error', 'message' => 'Defina um assunto para a campanha.'];
        }
        if (!self::has_functional_unsubscribe($html)) {
            $issues[] = [
                'level' => 'error',
                'message' => 'Falta um link de descadastro funcional. Use {{unsubscribe_url}} no endereço de um link visível.',
            ];
        }

        // Gmail trunca acima de ~102KB e esconde o resto atrás de "ver
        // mensagem completa", o que quebra o rastreamento de abertura.
        $size = strlen($html);
        if ($size > 102400) {
            $issues[] = ['level' => 'warning', 'message' => sprintf('O HTML tem %s. Acima de 100 KB o Gmail corta a mensagem.', size_format($size))];
        }

        $uncommented = (string) preg_replace('/<!--[\s\S]*?-->/', '', $html);
        $active_tags = [
            'script', 'form', 'iframe', 'frame', 'frameset', 'object', 'embed',
            'applet', 'input', 'textarea', 'select', 'option', 'button', 'base',
            'link', 'template', 'svg', 'math', 'video', 'audio', 'source',
            'track', 'portal',
        ];
        $safe_tags = [
            'html', 'head', 'body', 'meta', 'title', 'style', 'noscript',
            'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup',
            'col', 'caption', 'div', 'span', 'p', 'a', 'img', 'h1', 'h2',
            'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's',
            'strike', 'br', 'hr', 'ul', 'ol', 'li', 'blockquote', 'center',
            'font', 'small', 'sub', 'sup', 'pre', 'code', 'kbd', 'samp',
            'var', 'del', 'ins', 'mark', 'abbr', 'cite', 'q', 'dl', 'dt',
            'dd', 'address', 'figure', 'figcaption',
            'o:officedocumentsettings', 'o:pixelsperinch', 'v:rect', 'v:fill',
            'v:textbox', 'w:anchorlock',
        ];
        $found_active = [];
        $found_unknown = [];
        if (preg_match_all('/<\s*\/?\s*([a-z][\w:-]*)\b[^>]*>/i', $uncommented, $tags)) {
            foreach ($tags[1] as $tag) {
                $tag = strtolower((string) $tag);
                if (in_array($tag, $active_tags, true)) $found_active[$tag] = true;
                elseif (!in_array($tag, $safe_tags, true)) $found_unknown[$tag] = true;
            }
        }
        if ($found_active) {
            $issues[] = [
                'level' => 'error',
                'message' => 'HTML ativo não é permitido: ' . implode(', ', array_keys($found_active)) . '.',
            ];
        }
        if ($found_unknown) {
            $issues[] = [
                'level' => 'error',
                'message' => 'Tag HTML não reconhecida para email: ' . implode(', ', array_keys($found_unknown)) . '.',
            ];
        }
        if (preg_match('/(?:\s|\/)on[a-z][\w:-]*\s*=/i', $uncommented)) {
            $issues[] = [
                'level' => 'error',
                'message' => 'Atributos de evento (como onclick) não são permitidos em emails.',
            ];
        }
        if (preg_match('/\bsrcdoc\s*=/i', $uncommented)) {
            $issues[] = [
                'level' => 'error',
                'message' => 'O atributo srcdoc não é permitido em emails.',
            ];
        }
        if (preg_match('/<meta\b[^>]*http-equiv\s*=\s*(["\']?)refresh\1/i', $uncommented)) {
            $issues[] = [
                'level' => 'error',
                'message' => 'Redirecionamento automático por meta refresh não é permitido em emails.',
            ];
        }
        if (preg_match('/(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding\s*:)/i', $uncommented)) {
            $issues[] = [
                'level' => 'error',
                'message' => 'O email contém CSS ativo ou inseguro.',
            ];
        }

        foreach (self::url_attributes($uncommented) as $attribute) {
            if (self::has_unsafe_scheme($attribute['value'])) {
                $issues[] = [
                    'level' => 'error',
                    'message' => sprintf('O protocolo usado em %s não é permitido.', $attribute['name']),
                ];
                break;
            }
        }
        foreach (self::tags($uncommented, 'a', true) as $anchor) {
            $href = self::read_attribute($anchor['attributes'], 'href') ?? '';
            if (!self::is_sendable_link($href)) {
                $issues[] = [
                    'level' => 'error',
                    'message' => trim($href) === ''
                        ? 'Há um link sem endereço no email.'
                        : 'Há um link inválido. Use uma URL absoluta ou merge tag de URL.',
                ];
                break;
            }
        }
        foreach (self::tags($uncommented, 'img', false) as $image) {
            $src = self::read_attribute($image['attributes'], 'src') ?? '';
            $alt = self::read_attribute($image['attributes'], 'alt') ?? '';
            if (!self::is_remote_asset($src)) {
                $issues[] = [
                    'level' => 'error',
                    'message' => 'Uma imagem não tem URL http:// ou https:// absoluta válida.',
                ];
                break;
            }
            if (self::placeholder_alt($alt)) {
                $issues[] = [
                    'level' => 'error',
                    'message' => 'Toda imagem precisa de texto alternativo descritivo.',
                ];
                break;
            }
        }
        if (preg_match('/style=(["\'])[^"\']*display\s*:\s*(flex|grid)/i', $html)) {
            $issues[] = ['level' => 'warning', 'message' => 'Flex/grid não funcionam no Outlook. Use tabelas para o layout.'];
        }

        return $issues;
    }

    /**
     * Token solto ou oculto não cumpre descadastro: ele precisa ser o href de
     * um link acionável, com rótulo textual ou imagem descritiva efetivamente
     * visível. O próprio link e todos os ancestrais são verificados.
     */
    private static function has_functional_unsubscribe(string $html): bool {
        $html = (string) preg_replace('/<!--[\s\S]*?-->/', '', $html);
        foreach (self::tags($html, 'a', true) as $anchor) {
            $href = self::read_attribute($anchor['attributes'], 'href');
            if ($href === null || strtolower(preg_replace('/\s+/', '', $href)) !== '{{unsubscribe_url}}') {
                continue;
            }
            if (self::node_or_ancestor_hidden($html, $anchor, 'a')) continue;

            $content = (string) ($anchor['content'] ?? '');
            if (self::has_visible_unsubscribe_label($content, $html)) return true;
        }
        return false;
    }

    /**
     * @return array<int,array{attributes:string,content?:string,offset:int}>
     */
    private static function tags(string $html, string $tag, bool $paired): array {
        $tag = preg_quote($tag, '/');
        $pattern = $paired
            ? '/<' . $tag . '\b([^>]*)>([\s\S]*?)<\/' . $tag . '\s*>/i'
            : '/<' . $tag . '\b([^>]*)\/?>/i';
        if (!preg_match_all($pattern, $html, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) return [];

        $found = [];
        foreach ($matches as $match) {
            $item = [
                'attributes' => (string) ($match[1][0] ?? ''),
                'offset' => (int) ($match[0][1] ?? 0),
            ];
            if ($paired) $item['content'] = (string) ($match[2][0] ?? '');
            $found[] = $item;
        }
        return $found;
    }

    /** @param array{attributes:string,offset:int} $node */
    private static function node_or_ancestor_hidden(string $html, array $node, string $tag): bool {
        if (self::node_hidden($tag, (string) $node['attributes'], $html)) return true;

        $prefix = substr($html, 0, max(0, (int) $node['offset']));
        if (!preg_match_all(
            '/<\s*(\/?)\s*([a-z][\w:-]*)\b([^>]*)>/i',
            $prefix,
            $matches,
            PREG_SET_ORDER
        )) {
            return false;
        }

        $void = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
        $stack = [];
        foreach ($matches as $match) {
            $closing = (string) ($match[1] ?? '') === '/';
            $name = strtolower((string) ($match[2] ?? ''));
            $attributes = (string) ($match[3] ?? '');
            if ($closing) {
                for ($index = count($stack) - 1; $index >= 0; $index--) {
                    if ($stack[$index]['name'] !== $name) continue;
                    array_splice($stack, $index);
                    break;
                }
                continue;
            }
            if (in_array($name, $void, true) || str_ends_with(trim($attributes), '/')) continue;
            $stack[] = [
                'name' => $name,
                'hidden' => self::node_hidden($name, $attributes, $html),
            ];
        }

        foreach ($stack as $ancestor) {
            if (!empty($ancestor['hidden'])) return true;
        }
        return false;
    }

    private static function has_visible_unsubscribe_label(string $content, string $document): bool {
        $parts = preg_split(
            '/(<!--[\s\S]*?-->|<\s*\/?\s*[a-z][\w:-]*\b[^>]*>)/i',
            $content,
            -1,
            PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY
        );
        if (!is_array($parts)) return false;

        $void = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
        $stack = [];
        $visible_text = '';
        $visible_image = false;

        foreach ($parts as $part) {
            if (str_starts_with($part, '<!--')) continue;
            if (!str_starts_with(ltrim($part), '<')) {
                $hidden = $stack && !empty($stack[array_key_last($stack)]['hidden']);
                if (!$hidden) $visible_text .= ' ' . $part;
                continue;
            }
            if (!preg_match('/^<\s*(\/?)\s*([a-z][\w:-]*)\b([^>]*)>/i', $part, $match)) continue;

            $closing = (string) ($match[1] ?? '') === '/';
            $name = strtolower((string) ($match[2] ?? ''));
            $attributes = (string) ($match[3] ?? '');
            if ($closing) {
                for ($index = count($stack) - 1; $index >= 0; $index--) {
                    if ($stack[$index]['name'] !== $name) continue;
                    array_splice($stack, $index);
                    break;
                }
                continue;
            }

            $parent_hidden = $stack && !empty($stack[array_key_last($stack)]['hidden']);
            $hidden = $parent_hidden || self::node_hidden($name, $attributes, $document);
            if ($name === 'img' && !$hidden) {
                $alt = self::read_attribute($attributes, 'alt') ?? '';
                if (!self::placeholder_alt($alt)) $visible_image = true;
            }
            if (!in_array($name, $void, true) && !str_ends_with(trim($attributes), '/')) {
                $stack[] = ['name' => $name, 'hidden' => $hidden];
            }
        }

        $label = trim((string) preg_replace(
            '/\s+/',
            ' ',
            html_entity_decode(wp_strip_all_tags($visible_text), ENT_QUOTES | ENT_HTML5, 'UTF-8')
        ));
        return $label !== '' || $visible_image;
    }

    private static function node_hidden(string $tag, string $attributes, string $document): bool {
        if (preg_match('/(?:^|\s)(?:hidden|inert)(?:\s|=|$)/i', $attributes)) return true;
        if (preg_match('/(?:^|\s)aria-(?:hidden|disabled)\s*=\s*(?:"true"|\'true\'|true)(?:\s|$)/i', $attributes)) {
            return true;
        }

        $style = self::read_attribute($attributes, 'style') ?? '';
        if (self::style_hides($style)) return true;

        $classes = preg_split('/\s+/', trim((string) (self::read_attribute($attributes, 'class') ?? '')))
            ?: [];
        $id = trim((string) (self::read_attribute($attributes, 'id') ?? ''));
        if (!$classes && $id === '') return false;

        if (!preg_match_all('/([^{}]+)\{([^{}]*)\}/', $document, $rules, PREG_SET_ORDER)) return false;
        foreach ($rules as $rule) {
            if (!self::style_hides((string) ($rule[2] ?? ''))) continue;
            foreach (explode(',', (string) ($rule[1] ?? '')) as $selector) {
                if ($id !== '' && preg_match('/#' . preg_quote($id, '/') . '(?![\w-])/i', $selector)) {
                    return true;
                }
                foreach ($classes as $class) {
                    if ($class !== '' && preg_match('/\.' . preg_quote($class, '/') . '(?![\w-])/i', $selector)) {
                        return true;
                    }
                }
                if (trim(strtolower($selector)) === strtolower($tag)) return true;
            }
        }
        return false;
    }

    private static function style_hides(string $style): bool {
        $style = strtolower(html_entity_decode($style, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if (preg_match('/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|mso-hide\s*:\s*all|pointer-events\s*:\s*none|color\s*:\s*transparent)(?:\s*!important)?\s*(?:;|$)/i', $style)) {
            return true;
        }
        if (preg_match('/(?:^|;)\s*opacity\s*:\s*(0*(?:\.0+)?)(?:\s*!important)?\s*(?:;|$)/i', $style)) {
            return true;
        }
        if (
            preg_match('/(?:^|;)\s*(?:height|max-height)\s*:\s*0(?:px|em|rem|%)?(?:\s*!important)?\s*(?:;|$)/i', $style)
            && preg_match('/(?:^|;)\s*overflow\s*:\s*hidden(?:\s*!important)?\s*(?:;|$)/i', $style)
        ) {
            return true;
        }
        return (bool) preg_match('/(?:clip\s*:\s*rect\s*\(\s*0(?:px)?(?:\s*,?\s*0(?:px)?){3}\s*\)|left\s*:\s*-\d{3,}(?:px|em|rem))/i', $style);
    }

    private static function read_attribute(string $attributes, string $name): ?string {
        $escaped = preg_quote($name, '/');
        if (!preg_match(
            '/(?:^|\s)' . $escaped . '\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'=<>]+))/i',
            $attributes,
            $match
        )) {
            return null;
        }
        return (string) ($match[1] ?? $match[2] ?? $match[3] ?? '');
    }

    /** @return array<int,array{name:string,value:string}> */
    private static function url_attributes(string $html): array {
        if (!preg_match_all(
            '/\b(href|src|srcset|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'=<>`]+))/i',
            $html,
            $matches,
            PREG_SET_ORDER
        )) {
            return [];
        }

        $attributes = [];
        foreach ($matches as $match) {
            $attributes[] = [
                'name' => strtolower((string) ($match[1] ?? '')),
                'value' => (string) ($match[2] ?? $match[3] ?? $match[4] ?? ''),
            ];
        }
        return $attributes;
    }

    private static function has_unsafe_scheme(string $value): bool {
        $decoded = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        foreach (preg_split('/\s*,\s*/', $decoded) ?: [] as $candidate) {
            $compact = strtolower((string) preg_replace('/[\x00-\x20]+/', '', $candidate));
            if (preg_match('/^(javascript|vbscript|data):/', $compact)) return true;
        }
        return false;
    }

    private static function is_sendable_link(string $href): bool {
        $value = trim($href);
        if ($value === '' || self::has_unsafe_scheme($value)) return false;
        if (preg_match('/^\{\{\s*([a-z0-9_.-]+)\s*\}\}$/i', $value, $merge)) {
            return in_array(strtolower((string) $merge[1]), [
                'unsubscribe_url',
                'view_in_browser_url',
                'site.url',
            ], true);
        }
        if (preg_match('/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i', $value)) return true;
        if (preg_match('/^tel:\+?[\d().\s-]{5,}$/i', $value)) return true;

        $scheme = strtolower((string) wp_parse_url($value, PHP_URL_SCHEME));
        $host = (string) wp_parse_url($value, PHP_URL_HOST);
        return in_array($scheme, ['http', 'https'], true) && $host !== '';
    }

    private static function is_remote_asset(string $src): bool {
        $value = trim($src);
        if ($value === '' || self::has_unsafe_scheme($value)) return false;
        $scheme = strtolower((string) wp_parse_url($value, PHP_URL_SCHEME));
        $host = (string) wp_parse_url($value, PHP_URL_HOST);
        return in_array($scheme, ['http', 'https'], true) && $host !== '';
    }

    private static function placeholder_alt(string $value): bool {
        $value = strtolower(trim(remove_accents($value)));
        return $value === '' || in_array($value, [
            'alt',
            'image',
            'imagem',
            'placeholder',
            'texto alternativo',
            'descreva a imagem',
            'descrever imagem',
        ], true);
    }

    public static function has_blocking_issue(array $issues): bool {
        foreach ($issues as $issue) {
            if ($issue['level'] === 'error') return true;
        }
        return false;
    }
}
