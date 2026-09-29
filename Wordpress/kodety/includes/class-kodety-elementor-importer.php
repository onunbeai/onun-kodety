<?php

defined('ABSPATH') || exit;

/**
 * One-way Elementor document converter for an editable Onun Kodety draft.
 *
 * This class is deliberately independent from Elementor's runtime. It reads a
 * decoded `_elementor_data` document and emits browser-native HTML/CSS. The
 * caller remains responsible for fetching/localizing assets and staging the
 * resulting ZIP in the private Builder workspace.
 */
final class Kodety_Elementor_Importer {
    private const SUPPORTED_WIDGETS = [
        'heading',
        'text-editor',
        'image',
        'button',
        'divider',
        'spacer',
        'image-box',
        'testimonial',
        'image-gallery',
        'accordion',
        'toggle',
        'counter',
        'progress',
        'menu-anchor',
        'html',
    ];

    /** @var array<string,int> */
    private array $supported_widgets = [];
    /** @var list<array<string,string>> */
    private array $unsupported_widgets = [];
    /** @var array<string,int> */
    private array $preserved_widgets = [];
    /** @var list<string> */
    private array $warnings = [];
    /** @var list<string> */
    private array $css_rules = [];
    /** @var array<string,true> */
    private array $used_ids = [];
    /** @var array<string,mixed> */
    private array $globals = [];
    /** @var array<string,string> Elementor node ID => rendered fallback HTML. */
    private array $rendered_widgets = [];
    private int $source_post_id = 0;
    private int $node_count = 0;
    /** @var array<string,int> Source widths, in CSS cascade order. */
    private array $breakpoints = [];
    private string $source_url = '';

    /**
     * @param list<array<string,mixed>> $elements
     * @param array{
     *   title?:string,
     *   language?:string,
     *   sourcePostId?:int,
     *   sourceUrl?:string,
     *   globals?:array<string,mixed>,
     *   breakpoints?:array<string,int>,
     *   renderedWidgets?:array<string,string>
     * } $context
     * @return array{html:string,css:string,project:array<string,mixed>,report:array<string,mixed>}
     */
    public function convert(array $elements, array $context = []): array {
        $this->supported_widgets = [];
        $this->unsupported_widgets = [];
        $this->preserved_widgets = [];
        $this->warnings = [];
        $this->css_rules = [];
        $this->used_ids = [];
        $this->node_count = 0;
        $this->source_post_id = max(0, (int) ($context['sourcePostId'] ?? 0));
        $this->globals = is_array($context['globals'] ?? null) ? $context['globals'] : [];
        $this->source_url = trim((string) ($context['sourceUrl'] ?? ''));
        $this->breakpoints = $this->normalize_breakpoints($context['breakpoints'] ?? $this->globals['breakpoints'] ?? []);
        $this->rendered_widgets = [];
        foreach (is_array($context['renderedWidgets'] ?? null) ? $context['renderedWidgets'] : [] as $id => $html) {
            if (is_string($id) && is_string($html) && trim($id) !== '' && trim($html) !== '') {
                $this->rendered_widgets[trim($id)] = $html;
            }
        }

        $title = $this->plain_text((string) ($context['title'] ?? 'Página importada do Elementor'));
        if ($title === '') $title = 'Página importada do Elementor';
        $requested_language = (string) ($context['language'] ?? 'pt-BR');
        $language = preg_match('/^[a-z]{2,3}(?:-[A-Z]{2})?$/D', $requested_language)
            ? $requested_language
            : 'pt-BR';

        $content = '';
        foreach ($elements as $element) {
            if (is_array($element)) $content .= $this->render_node($element, 0);
        }
        if (trim($content) === '') {
            throw new InvalidArgumentException('O documento Elementor não contém elementos que possam ser importados.');
        }

        $css = $this->base_css() . "\n" . implode("\n", $this->css_rules);
        $css = (string) preg_replace('/\s*!\s*important\b/i', '', $css);
        $title_html = $this->escape($title);
        $html = '<!doctype html>' . "\n"
            . '<html lang="' . $this->escape($language) . '">' . "\n"
            . '<head>' . "\n"
            . '  <meta charset="UTF-8">' . "\n"
            . '  <meta name="viewport" content="width=device-width, initial-scale=1">' . "\n"
            . '  <title>' . $title_html . '</title>' . "\n"
            . '  <link rel="stylesheet" href="css/elementor-converted.css">' . "\n"
            . '</head>' . "\n"
            . '<body>' . "\n"
            . '  <main class="elementor-converted-page" data-label="' . $title_html . '" data-kodety-elementor-import="native">' . "\n"
            . $content
            . '  </main>' . "\n"
            . '</body>' . "\n"
            . '</html>' . "\n";

        ksort($this->supported_widgets);
        ksort($this->preserved_widgets);
        $supported_count = array_sum($this->supported_widgets);
        $report = [
            'version' => 2,
            'source' => 'elementor',
            'mode' => 'native',
            'sourcePostId' => $this->source_post_id,
            'sourceUrl' => (string) ($context['sourceUrl'] ?? ''),
            'nodeCount' => $this->node_count,
            'supportedWidgetCount' => $supported_count,
            'supportedWidgets' => $this->supported_widgets,
            'preservedWidgetCount' => array_sum($this->preserved_widgets),
            'preservedWidgets' => $this->preserved_widgets,
            'unsupportedWidgetCount' => count($this->unsupported_widgets),
            'unsupportedWidgets' => $this->unsupported_widgets,
            'warnings' => array_values(array_unique($this->warnings)),
            'sourceBreakpoints' => $this->breakpoints,
        ];
        $project = [
            'version' => 1,
            'name' => $title,
            'mainHtmlPath' => 'index.html',
            'homeHtmlPath' => 'index.html',
            'rootPath' => '',
            'breakpointSchemaVersion' => 2,
            'primaryBreakpoint' => [
                'id' => 'base',
                'label' => 'Primary',
                'mode' => 'max-width',
                'width' => 1920,
            ],
            'breakpoints' => array_map(fn(string $id, int $width): array => [
                'id' => $id,
                'label' => ucwords(str_replace('_', ' ', $id)),
                'mode' => $id === 'widescreen' ? 'min-width' : 'max-width',
                'width' => $width,
            ], array_keys($this->breakpoints), array_values($this->breakpoints)),
        ];
        return compact('html', 'css', 'project', 'report');
    }

    /** @param array<string,mixed> $node */
    private function render_node(array $node, int $depth): string {
        if ($depth > 100 || $this->node_count >= 20000) {
            throw new InvalidArgumentException('O documento Elementor excede o limite seguro de elementos ou profundidade.');
        }
        $this->node_count++;
        $source_id = trim((string) ($node['id'] ?? 'node-' . $this->node_count));
        $stable_id = $this->stable_id($source_id);
        $settings = is_array($node['settings'] ?? null) ? $node['settings'] : [];
        if (!empty($settings['custom_css'])) $this->warnings[] = 'CSS personalizado do Elementor requer revisão após a conversão estrutural.';
        if (!empty($settings['__dynamic__'])) $this->warnings[] = 'Conteúdo dinâmico do Elementor foi importado como conteúdo estático e requer revisão.';
        $element_type = strtolower(trim((string) ($node['elType'] ?? 'container')));
        if ($element_type === 'widget') {
            return $this->render_widget($node, $settings, $source_id, $stable_id, $depth);
        }

        $kind = in_array($element_type, ['section', 'column', 'container'], true)
            ? $element_type
            : 'container';
        $label = match ($kind) {
            'section' => 'Seção Elementor',
            'column' => 'Coluna Elementor',
            default => $depth === 0 ? 'Container Elementor' : 'Container',
        };
        $children = '';
        foreach (is_array($node['elements'] ?? null) ? $node['elements'] : [] as $child) {
            if (is_array($child)) $children .= $this->render_node($child, $depth + 1);
        }
        $tag = $this->enum((string) ($settings['html_tag'] ?? ''), ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside']);
        if ($tag === '') $tag = $depth === 0 || $kind === 'section' ? 'section' : 'div';
        $class = 'elementor-native-node elementor-native-' . $kind . ' ' . $stable_id;
        $this->append_node_styles($stable_id, $settings, $kind);
        return str_repeat('  ', min(8, $depth + 2))
            . '<' . $tag
            . ' id="' . $this->escape($this->node_html_id($settings, $stable_id)) . '"'
            . ' class="' . $this->escape($class . $this->custom_classes($settings)) . '"'
            . ' data-label="' . $this->escape($label) . '"'
            . ' data-kodety-source-id="' . $this->escape($source_id) . '">'
            . "\n" . $children
            . str_repeat('  ', min(8, $depth + 2)) . '</' . $tag . '>' . "\n";
    }

    /** @param array<string,mixed> $node @param array<string,mixed> $settings */
    private function render_widget(array $node, array $settings, string $source_id, string $stable_id, int $depth): string {
        $widget_type = strtolower(trim((string) ($node['widgetType'] ?? 'unknown')));
        $label = $this->widget_label($widget_type);
        $this->append_node_styles($stable_id, $settings, 'widget', $widget_type);
        $supported = in_array($widget_type, self::SUPPORTED_WIDGETS, true);
        $preserve_dynamic = !empty($settings['__dynamic__']) && isset($this->rendered_widgets[$source_id]);
        if (!$supported || $preserve_dynamic) {
            $fallback_html = isset($this->rendered_widgets[$source_id])
                ? $this->sanitize_fragment($this->rendered_widgets[$source_id])
                : '';
            $preserved_mode = 'rendered-html';
            if ($fallback_html === '' && !empty($node['elements']) && is_array($node['elements'])) {
                foreach ($node['elements'] as $child) {
                    if (is_array($child)) $fallback_html .= $this->render_node($child, $depth + 1);
                }
                $preserved_mode = 'child-elements';
                $this->warnings[] = 'Um widget aninhado foi convertido em seus elementos editáveis; sua interação requer revisão.';
            }
            if ($fallback_html !== '') {
                // A rendered wrapper is already browser-native HTML. Preserve
                // it as an editable Onun Kodety layer and record the widget type,
                // rather than styling it like an error or replacing it with a
                // generic placeholder.
                $this->preserved_widgets[$widget_type] = ($this->preserved_widgets[$widget_type] ?? 0) + 1;
                return '    <div id="' . $this->escape($this->node_html_id($settings, $stable_id)) . '" class="elementor-native-node elementor-native-widget elementor-native-rendered-widget '
                    . $stable_id . $this->escape($this->custom_classes($settings)) . '" data-label="' . $this->escape($label)
                    . '" data-kodety-source-id="' . $this->escape($source_id)
                    . '" data-kodety-elementor-widget="' . $this->escape($widget_type)
                    . '" data-kodety-elementor-preserved="' . $preserved_mode . '">' . "\n"
                    . $fallback_html . "\n"
                    . '    </div>' . "\n";
            }
            $this->unsupported_widgets[] = [
                'id' => $source_id,
                'widgetType' => $widget_type,
                'fallback' => 'placeholder',
            ];
            $fallback_html = '<p>Widget “' . $this->escape($widget_type !== '' ? $widget_type : 'desconhecido')
                . '” precisa ser revisado após a conversão.</p>';
            return '    <aside id="' . $stable_id . '" class="elementor-native-node elementor-native-widget elementor-native-fallback '
                . $stable_id . '" data-label="' . $this->escape($label . ' · fallback visual')
                . '" data-kodety-source-id="' . $this->escape($source_id)
                . '" data-kodety-elementor-fallback="' . $this->escape($widget_type) . '">' . "\n"
                . $fallback_html . "\n"
                . '    </aside>' . "\n";
        }

        $this->supported_widgets[$widget_type] = ($this->supported_widgets[$widget_type] ?? 0) + 1;
        $attributes = ' id="' . $this->escape($this->node_html_id($settings, $stable_id)) . '" class="elementor-native-node elementor-native-widget elementor-native-widget-'
            . $this->css_identifier($widget_type) . ' ' . $stable_id . $this->escape($this->custom_classes($settings)) . '" data-label="' . $this->escape($label)
            . '" data-kodety-source-id="' . $this->escape($source_id) . '"';

        return match ($widget_type) {
            'heading' => $this->render_heading($settings, $attributes),
            'text-editor' => $this->render_text($settings, $attributes),
            'image' => $this->render_image($settings, $attributes),
            'button' => $this->render_button($settings, $attributes),
            'divider' => '    <div' . $attributes . '><hr aria-hidden="true"></div>' . "\n",
            'spacer' => '    <div' . $attributes . ' aria-hidden="true"></div>' . "\n",
            'image-box', 'testimonial' => $this->render_content_card($settings, $attributes, $widget_type),
            'image-gallery' => $this->render_gallery($settings, $attributes),
            'accordion', 'toggle' => $this->render_disclosures($settings, $attributes, $widget_type),
            'counter' => $this->render_counter($settings, $attributes),
            'progress' => $this->render_progress($settings, $attributes),
            'menu-anchor' => '    <div' . $attributes . ' aria-hidden="true"></div>' . "\n",
            'html' => '    <div' . $attributes . '>' . $this->sanitize_fragment((string) ($settings['html'] ?? '')) . '</div>' . "\n",
            default => '',
        };
    }

    /** @param array<string,mixed> $settings */
    private function render_heading(array $settings, string $attributes): string {
        $tag = strtolower((string) ($settings['header_size'] ?? 'h2'));
        if (!in_array($tag, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'p'], true)) $tag = 'h2';
        $title = $this->sanitize_inline((string) ($settings['title'] ?? 'Título'));
        if ($title === '') $title = 'Título';
        $title = $this->linked_content($title, $settings['link'] ?? []);
        return '    <div' . $attributes . '><' . $tag . '>' . $title . '</' . $tag . '></div>' . "\n";
    }

    /** @param array<string,mixed> $settings */
    private function render_text(array $settings, string $attributes): string {
        $content = $this->sanitize_fragment((string) ($settings['editor'] ?? ''));
        if ($content === '') $content = '<p>Texto importado do Elementor.</p>';
        return '    <div' . $attributes . '>' . $content . '</div>' . "\n";
    }

    /** @param array<string,mixed> $settings */
    private function render_image(array $settings, string $attributes): string {
        $image = is_array($settings['image'] ?? null) ? $settings['image'] : [];
        $url = $this->image_url($image, (string) ($settings['image_size'] ?? 'full'));
        if (empty($image['alt']) && !empty($image['id']) && function_exists('get_post_meta')) {
            $image['alt'] = get_post_meta((int) $image['id'], '_wp_attachment_image_alt', true);
        }
        $alt = $this->plain_text((string) ($image['alt'] ?? $settings['caption'] ?? ''));
        $caption = $this->plain_text((string) ($settings['caption'] ?? ''));
        if (($settings['caption_source'] ?? '') === 'none') $caption = '';
        if (($settings['caption_source'] ?? '') === 'attachment' && !empty($image['id']) && function_exists('wp_get_attachment_caption')) {
            $caption = $this->plain_text((string) wp_get_attachment_caption((int) $image['id']));
        }
        if ($url === '') {
            $this->warnings[] = 'Uma imagem não possuía URL e foi mantida como placeholder.';
            return '    <figure' . $attributes . '><div class="elementor-native-image-placeholder" role="img" aria-label="Imagem sem arquivo"></div></figure>' . "\n";
        }
        $img = '<img src="' . $this->escape($url) . '" alt="' . $this->escape($alt)
            . '" loading="lazy" decoding="async">';
        if (($settings['link_to'] ?? '') === 'file') $img = $this->linked_content($img, ['url' => $url]);
        elseif (($settings['link_to'] ?? '') === 'custom') $img = $this->linked_content($img, $settings['link'] ?? []);
        $html = '    <figure' . $attributes . '>' . $img;
        if ($caption !== '') $html .= '<figcaption>' . $this->escape($caption) . '</figcaption>';
        return $html . '</figure>' . "\n";
    }

    /** @param array<string,mixed> $settings */
    private function render_button(array $settings, string $attributes): string {
        $link = is_array($settings['link'] ?? null) ? $settings['link'] : [];
        $url = $this->safe_url((string) ($link['url'] ?? '#'));
        if ($url === '') $url = '#';
        $text = $this->plain_text((string) ($settings['text'] ?? 'Saiba mais'));
        if ($text === '') $text = 'Saiba mais';
        $target = !empty($link['is_external']) ? ' target="_blank"' : '';
        $rel_values = [];
        if (!empty($link['nofollow'])) $rel_values[] = 'nofollow';
        if ($target !== '') $rel_values[] = 'noopener';
        $rel = $rel_values ? ' rel="' . implode(' ', $rel_values) . '"' : '';
        return '    <div' . $attributes . '><a class="kodety-button" href="' . $this->escape($url) . '"'
            . $target . $rel . '>' . $this->escape($text) . '</a></div>' . "\n";
    }

    private function linked_content(string $content, mixed $link): string {
        if (!is_array($link)) return $content;
        $url = $this->safe_url((string) ($link['url'] ?? ''));
        if ($url === '') return $content;
        $rel = !empty($link['nofollow']) ? ['nofollow'] : [];
        $target = !empty($link['is_external']) ? ' target="_blank"' : '';
        if ($target !== '') $rel[] = 'noopener';
        return '<a href="' . $this->escape($url) . '"' . $target
            . ($rel ? ' rel="' . implode(' ', $rel) . '"' : '') . '>' . $content . '</a>';
    }

    /** Resolve media-library-only entries without requiring Elementor to run. */
    private function image_url(array $image, string $size = 'full'): string {
        $url = (string) ($image['url'] ?? '');
        if (!empty($image['id']) && function_exists('wp_get_attachment_image_url')) {
            $attachment = wp_get_attachment_image_url((int) $image['id'], $size);
            if (is_string($attachment) && $attachment !== '') $url = $attachment;
        }
        return $this->safe_url($url);
    }

    private function render_content_card(array $settings, string $attributes, string $type): string {
        $testimonial = $type === 'testimonial';
        $image = $settings[$testimonial ? 'testimonial_image' : 'image'] ?? [];
        $image = is_array($image) ? $image : [];
        $url = $this->image_url($image, (string) ($settings['thumbnail_size'] ?? 'full'));
        $picture = $url !== '' ? '<img src="' . $this->escape($url) . '" alt="' . $this->escape($this->plain_text((string) ($image['alt'] ?? ''))) . '" loading="lazy" decoding="async">' : '';
        if ($testimonial) {
            $content = '<blockquote>' . $this->sanitize_fragment((string) ($settings['testimonial_content'] ?? '')) . '</blockquote>'
                . '<div class="elementor-native-card-title">' . $this->escape($this->plain_text((string) ($settings['testimonial_name'] ?? ''))) . '</div>'
                . '<p class="elementor-native-card-description">' . $this->escape($this->plain_text((string) ($settings['testimonial_job'] ?? ''))) . '</p>';
        } else {
            $tag = $this->enum((string) ($settings['title_size'] ?? 'h3'), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'p', 'span']) ?: 'h3';
            $content = '<' . $tag . ' class="elementor-native-card-title">' . $this->linked_content($this->sanitize_inline((string) ($settings['title_text'] ?? '')), $settings['link'] ?? []) . '</' . $tag . '>'
                . '<div class="elementor-native-card-description">' . $this->sanitize_fragment((string) ($settings['description_text'] ?? '')) . '</div>';
            $picture = $this->linked_content($picture, $settings['link'] ?? []);
        }
        return '    <div' . $attributes . '>' . $picture . '<div class="elementor-native-card-content">' . $content . '</div></div>' . "\n";
    }

    private function render_gallery(array $settings, string $attributes): string {
        $html = '';
        foreach (is_array($settings['wp_gallery'] ?? null) ? $settings['wp_gallery'] : [] as $image) {
            if (!is_array($image)) continue;
            $url = $this->image_url($image, (string) ($settings['thumbnail_size'] ?? 'full'));
            if ($url === '') continue;
            $img = '<img src="' . $this->escape($url) . '" alt="' . $this->escape($this->plain_text((string) ($image['alt'] ?? ''))) . '" loading="lazy" decoding="async">';
            if (($settings['gallery_link'] ?? 'file') === 'file') $img = $this->linked_content($img, ['url' => $url]);
            $html .= '<figure>' . $img . '</figure>';
        }
        return '    <div' . $attributes . '>' . $html . '</div>' . "\n";
    }

    private function render_disclosures(array $settings, string $attributes, string $type): string {
        $html = '';
        $group = 'elementor-accordion-' . substr(hash('sha256', $attributes), 0, 16);
        foreach (is_array($settings['tabs'] ?? null) ? $settings['tabs'] : [] as $index => $tab) {
            if (!is_array($tab)) continue;
            $html .= '<details' . ($type === 'accordion' ? ' name="' . $group . '"' : '') . ($type === 'accordion' && $index === 0 ? ' open' : '') . '><summary>'
                . $this->sanitize_inline((string) ($tab['tab_title'] ?? '')) . '</summary><div class="elementor-native-disclosure-content">'
                . $this->sanitize_fragment((string) ($tab['tab_content'] ?? '')) . '</div></details>';
        }
        return '    <div' . $attributes . '>' . $html . '</div>' . "\n";
    }

    private function render_counter(array $settings, string $attributes): string {
        $number = (float) ($this->number($settings['ending_number'] ?? 100) ?? '100');
        $separator = ($settings['thousand_separator'] ?? 'yes') === 'yes' ? (string) ($settings['thousand_separator_char'] ?? ',') : '';
        $decimals = str_contains((string) $number, '.') ? strlen(rtrim(explode('.', (string) $number)[1], '0')) : 0;
        $text = (string) ($settings['prefix'] ?? '') . number_format($number, min(4, $decimals), '.', $separator) . (string) ($settings['suffix'] ?? '');
        return '    <div' . $attributes . '><div class="elementor-native-counter-number">' . $this->escape($text)
            . '</div><div class="elementor-native-counter-title">' . $this->sanitize_inline((string) ($settings['title'] ?? '')) . '</div></div>' . "\n";
    }

    private function render_progress(array $settings, string $attributes): string {
        $percent = $settings['percent'] ?? [];
        $value = max(0, min(100, (float) ($this->number(is_array($percent) ? ($percent['size'] ?? 0) : $percent) ?? '0')));
        $title = $this->plain_text((string) ($settings['title'] ?? ''));
        return '    <div' . $attributes . '><span class="elementor-native-progress-title">' . $this->escape($title)
            . '</span><progress max="100" value="' . $value . '" aria-label="' . $this->escape($title) . '">' . $value . '%</progress>'
            . '<span>' . $this->escape($this->plain_text((string) ($settings['inner_text'] ?? '')))
            . (($settings['display_percentage'] ?? 'show') === 'show' ? ' ' . $value . '%' : '') . '</span></div>' . "\n";
    }

    /** @param array<string,mixed> $settings */
    private function append_node_styles(string $stable_id, array $settings, string $kind, string $widget_type = ''): void {
        foreach (['' => 0] + $this->breakpoints as $device => $width) {
            $selector = '.' . $stable_id;
            $suffix = $device === '' ? '' : '_' . $device;
            $rules = [];
            $declarations = $this->layout_declarations($settings, $kind, $widget_type, $device);
            if ($device === 'mobile' && $kind === 'column' && !isset($settings['_column_size_mobile']) && !isset($settings['_inline_size_mobile'])) {
                array_unshift($declarations, 'flex:0 0 100%;width:100%;');
            }
            if ($declarations) $rules[] = $selector . '{' . implode('', $declarations) . '}';
            if ($kind === 'widget') {
                foreach ($this->widget_style_rules($selector, $settings, $widget_type, $suffix) as $rule) $rules[] = $rule;
            }
            if (!$rules) continue;
            $css = implode('', $rules);
            if ($device !== '') $css = '@media (' . ($device === 'widescreen' ? 'min' : 'max') . '-width:' . $width . 'px){' . $css . '}';
            $this->css_rules[] = $css;
        }
        // Elementor hide controls are intervals, not cumulative mobile-first flags.
        $ranges = $this->breakpoints;
        unset($ranges['widescreen']);
        asort($ranges, SORT_NUMERIC);
        $lower = 0;
        foreach ($ranges as $device => $width) {
            if (!empty($settings['hide_' . $device])) {
                $min = $lower > 0 ? '(min-width:' . ($lower + 1) . 'px) and ' : '';
                $this->css_rules[] = '@media ' . $min . '(max-width:' . $width . 'px){.' . $stable_id . '{display:none;}}';
            }
            $lower = $width;
        }
        if (!empty($settings['hide_desktop'])) {
            $max = isset($this->breakpoints['widescreen']) ? ' and (max-width:' . ($this->breakpoints['widescreen'] - 1) . 'px)' : '';
            $this->css_rules[] = '@media (min-width:' . ($lower + 1) . 'px)' . $max . '{.' . $stable_id . '{display:none;}}';
        }
        if (isset($this->breakpoints['widescreen']) && !empty($settings['hide_widescreen'])) {
            $this->css_rules[] = '@media (min-width:' . $this->breakpoints['widescreen'] . 'px){.' . $stable_id . '{display:none;}}';
        }
    }

    /** @return list<string> */
    private function layout_declarations(array $settings, string $kind, string $widget_type, string $breakpoint): array {
        $declarations = [];
        $suffix = $breakpoint !== '' ? '_' . $breakpoint : '';
        $prefix = $kind === 'widget' ? '_' : '';
        foreach (['margin', 'padding', 'border_radius', 'border_width'] as $property) {
            $value = $this->dimension($settings[$prefix . $property . $suffix] ?? null);
            if ($value !== '') $declarations[] = str_replace('_', '-', $property) . ':' . $value . ';';
        }
        foreach (['width' => 'width', 'max_width' => 'max-width', 'height' => 'height', 'min_height' => 'min-height', 'z_index' => 'z-index'] as $key => $property) {
            $value = $this->size($settings[$prefix . $key . $suffix] ?? null, $key === 'z_index' ? '' : 'px');
            if ($value !== '') $declarations[] = $property . ':' . $value . ';';
        }
        foreach ($this->background_declarations($settings, $prefix, $suffix) as $declaration) $declarations[] = $declaration;
        $border = $this->enum((string) ($settings[$prefix . 'border_border' . $suffix] ?? ''), ['none', 'solid', 'double', 'dotted', 'dashed', 'groove']);
        if ($border !== '') $declarations[] = 'border-style:' . $border . ';';
        elseif (isset($settings[$prefix . 'border_width' . $suffix])) $declarations[] = 'border-style:solid;';
        $border_color = $this->color_setting($settings, $prefix . 'border_color' . $suffix);
        if ($border_color !== '') $declarations[] = 'border-color:' . $border_color . ';';
        $shadow = $this->box_shadow($settings[$prefix . 'box_shadow_box_shadow' . $suffix] ?? null);
        if ($shadow !== '') $declarations[] = 'box-shadow:' . $shadow . ';';
        $position = $this->enum((string) ($settings['_position' . $suffix] ?? $settings['position' . $suffix] ?? ''), ['relative', 'absolute', 'fixed', 'sticky']);
        if ($position !== '') $declarations[] = 'position:' . $position . ';';
        foreach (['offset_x' => 'left', 'offset_y' => 'top', 'offset_x_end' => 'right', 'offset_y_end' => 'bottom'] as $key => $property) {
            $value = $this->size($settings[$key . $suffix] ?? null, 'px');
            if ($value !== '') $declarations[] = $property . ':' . $value . ';';
        }
        foreach (['flex_grow' => 'flex-grow', 'flex_shrink' => 'flex-shrink', 'flex_order' => 'order', '_flex_grow' => 'flex-grow', '_flex_shrink' => 'flex-shrink', '_flex_order' => 'order'] as $key => $property) {
            $value = $this->number($settings[$key . $suffix] ?? null);
            if ($value !== null) $declarations[] = $property . ':' . $value . ';';
        }
        $self = $this->enum((string) ($settings['_flex_align_self' . $suffix] ?? $settings['flex_align_self' . $suffix] ?? ''), ['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline']);
        if ($self !== '') $declarations[] = 'align-self:' . $self . ';';

        if ($kind !== 'widget') {
            $direction = $this->enum((string) ($settings['flex_direction' . $suffix] ?? ''), ['row', 'row-reverse', 'column', 'column-reverse']);
            if ($direction !== '') $declarations[] = 'flex-direction:' . $direction . ';';
            foreach (['flex_justify_content' => 'justify-content', 'flex_align_items' => 'align-items', 'flex_align_content' => 'align-content'] as $key => $property) {
                $value = $this->enum((string) ($settings[$key . $suffix] ?? ''), ['stretch', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'baseline']);
                if ($value !== '') $declarations[] = $property . ':' . $value . ';';
            }
            $wrap = $this->enum((string) ($settings['flex_wrap' . $suffix] ?? ''), ['nowrap', 'wrap', 'wrap-reverse']);
            if ($wrap !== '') $declarations[] = 'flex-wrap:' . $wrap . ';';
            $gap = $settings['flex_gap' . $suffix] ?? null;
            if (is_array($gap)) {
                $row = $this->size($gap['row'] ?? $gap['size'] ?? null, (string) ($gap['unit'] ?? 'px'));
                $column = $this->size($gap['column'] ?? $gap['size'] ?? null, (string) ($gap['unit'] ?? 'px'));
                if ($row !== '') $declarations[] = 'row-gap:' . $row . ';';
                if ($column !== '') $declarations[] = 'column-gap:' . $column . ';';
            }
            $content_width = $this->size($settings['content_width' . $suffix] ?? $settings['boxed_width' . $suffix] ?? null, 'px');
            if ($content_width !== '') $declarations[] = 'max-width:' . $content_width . ';margin-inline:auto;';
            if ($kind === 'column') {
                $width = $this->number($settings['_column_size' . $suffix] ?? $settings['_inline_size' . $suffix] ?? null);
                if ($width !== null) $declarations[] = 'flex:0 0 ' . $width . '%;width:' . $width . '%;';
            }
            if (($settings['container_type' . $suffix] ?? '') === 'grid') $declarations[] = 'display:grid;';
            foreach (['grid_columns_grid' => 'grid-template-columns', 'grid_rows_grid' => 'grid-template-rows'] as $key => $property) {
                $value = $settings[$key . $suffix] ?? null;
                $count = $this->number(is_array($value) ? ($value['size'] ?? null) : $value);
                if ($count !== null && (int) $count > 0 && (int) $count <= 100) $declarations[] = $property . ':repeat(' . (int) $count . ',minmax(0,1fr));';
            }
            foreach (['grid_column_gap' => 'column-gap', 'grid_row_gap' => 'row-gap'] as $key => $property) {
                $value = $this->size($settings[$key . $suffix] ?? null, 'px');
                if ($value !== '') $declarations[] = $property . ':' . $value . ';';
            }
            $overflow = $this->enum((string) ($settings['overflow' . $suffix] ?? ''), ['hidden', 'visible', 'clip', 'auto']);
            if ($overflow !== '') $declarations[] = 'overflow:' . $overflow . ';';
        } else {
            $align = $this->enum((string) ($settings['align' . $suffix] ?? $settings['alignment' . $suffix] ?? ''), ['left', 'center', 'right', 'justify', 'start', 'end']);
            if ($align !== '') $declarations[] = 'text-align:' . $align . ';';
            $element_width = (string) ($settings['_element_width' . $suffix] ?? '');
            if ($element_width === 'initial') {
                $width = $this->size($settings['_element_custom_width' . $suffix] ?? null, 'px');
                if ($width !== '') $declarations[] = 'width:' . $width . ';';
            } elseif ($element_width === 'auto') $declarations[] = 'width:auto;';
            elseif ($element_width === 'inherit') $declarations[] = 'width:100%;';
            if ($widget_type === 'spacer') {
                $value = $this->size($settings['space' . $suffix] ?? null, 'px');
                if ($value !== '') $declarations[] = 'height:' . $value . ';';
            }
            if ($widget_type === 'image-gallery') {
                $columns = $this->number($settings['gallery_columns' . $suffix] ?? null);
                if ($columns !== null && (int) $columns > 0 && (int) $columns <= 100) $declarations[] = 'grid-template-columns:repeat(' . (int) $columns . ',minmax(0,1fr));';
                $gap = $this->size($settings['gallery_spacing' . $suffix] ?? null, 'px');
                if ($gap !== '') $declarations[] = 'gap:' . $gap . ';';
            }
        }
        return array_values(array_unique($declarations));
    }

    /** @return list<string> */
    private function background_declarations(array $settings, string $prefix, string $suffix): array {
        $declarations = [];
        $color = $this->color_setting($settings, $prefix . 'background_color' . $suffix);
        if ($color !== '') $declarations[] = 'background-color:' . $color . ';';
        $image = $settings[$prefix . 'background_image' . $suffix] ?? null;
        $url = is_array($image) ? $this->image_url($image) : '';
        if ($url !== '') $declarations[] = 'background-image:url("' . $this->css_string($url) . '");';
        if (($settings[$prefix . 'background_background' . $suffix] ?? '') === 'gradient') {
            $second = $this->color_setting($settings, $prefix . 'background_color_b' . $suffix);
            if ($color !== '' && $second !== '') {
                $first_stop = $this->size($settings[$prefix . 'background_color_stop' . $suffix] ?? null, '%') ?: '0%';
                $second_stop = $this->size($settings[$prefix . 'background_color_b_stop' . $suffix] ?? null, '%') ?: '100%';
                $angle = $settings[$prefix . 'background_gradient_angle' . $suffix] ?? null;
                $angle = $this->number(is_array($angle) ? ($angle['size'] ?? null) : $angle) ?? '180';
                $gradient = ($settings[$prefix . 'background_gradient_type' . $suffix] ?? '') === 'radial' ? 'radial-gradient(circle,' : 'linear-gradient(' . $angle . 'deg,';
                $declarations[] = 'background-image:' . $gradient . $color . ' ' . $first_stop . ',' . $second . ' ' . $second_stop . ');';
            }
        }
        foreach (['background_size' => ['auto', 'cover', 'contain'], 'background_repeat' => ['repeat', 'repeat-x', 'repeat-y', 'no-repeat', 'space', 'round'], 'background_attachment' => ['scroll', 'fixed'], 'background_position' => ['center center', 'center left', 'center right', 'top center', 'top left', 'top right', 'bottom center', 'bottom left', 'bottom right']] as $key => $allowed) {
            $value = $this->enum((string) ($settings[$prefix . $key . $suffix] ?? ''), $allowed);
            if ($value !== '') $declarations[] = str_replace('_', '-', $key) . ':' . $value . ';';
        }
        return $declarations;
    }

    private function box_shadow(mixed $value): string {
        if (!is_array($value)) return '';
        $color = $this->color((string) ($value['color'] ?? ''));
        if ($color === '') return '';
        $parts = [];
        foreach (['horizontal', 'vertical', 'blur', 'spread'] as $key) $parts[] = ($this->number($value[$key] ?? 0) ?? '0') . 'px';
        return implode(' ', $parts) . ' ' . $color . (($value['position'] ?? '') === 'inset' ? ' inset' : '');
    }

    /** Emit component controls on their actual HTML target, preserving wrapper controls independently. */
    private function widget_style_rules(string $selector, array $settings, string $type, string $suffix): array {
        $target = match ($type) {
            'button' => $selector . ' > .kodety-button',
            'heading' => $selector . ' > *',
            'image' => $selector . ' img',
            'divider' => $selector . ' > hr',
            default => $selector,
        };
        $declarations = [];
        if (in_array($type, ['heading', 'text-editor', 'button'], true)) {
            $color_key = match ($type) { 'heading' => 'title_color', 'text-editor' => 'text_color', default => 'button_text_color' };
            $color = $this->color_setting($settings, $color_key . $suffix);
            if ($color !== '') $declarations[] = 'color:' . $color . ';';
            $declarations = array_merge($declarations, $this->typography_declarations($settings, 'typography', $suffix));
        }
        if ($type === 'button') {
            $declarations = array_merge($declarations, $this->background_declarations($settings, '', $suffix));
            foreach (['text_padding' => 'padding', 'border_radius' => 'border-radius', 'border_width' => 'border-width'] as $key => $property) {
                $value = $this->dimension($settings[$key . $suffix] ?? null);
                if ($value !== '') $declarations[] = $property . ':' . $value . ';';
            }
            $border = $this->enum((string) ($settings['border_border' . $suffix] ?? ''), ['none', 'solid', 'dashed', 'dotted', 'double']);
            if ($border !== '') $declarations[] = 'border-style:' . $border . ';';
            $color = $this->color_setting($settings, 'border_color' . $suffix);
            if ($color !== '') $declarations[] = 'border-color:' . $color . ';';
            if (($settings['align' . $suffix] ?? '') === 'justify') $declarations[] = 'width:100%;';
        } elseif ($type === 'image') {
            foreach (['width' => 'width', 'space' => 'max-width', 'height' => 'height'] as $key => $property) {
                $value = $this->size($settings[$key . $suffix] ?? null, 'px');
                if ($value !== '') $declarations[] = $property . ':' . $value . ';';
            }
            $fit = $this->enum((string) ($settings['object-fit' . $suffix] ?? ''), ['fill', 'contain', 'cover', 'none', 'scale-down']);
            if ($fit !== '') $declarations[] = 'object-fit:' . $fit . ';';
            $radius = $this->dimension($settings['image_border_radius' . $suffix] ?? null);
            if ($radius !== '') $declarations[] = 'border-radius:' . $radius . ';';
            $shadow = $this->box_shadow($settings['image_box_shadow_box_shadow' . $suffix] ?? null);
            if ($shadow !== '') $declarations[] = 'box-shadow:' . $shadow . ';';
        } elseif ($type === 'divider') {
            $weight = $this->size($settings['weight' . $suffix] ?? null, 'px');
            if ($weight !== '') $declarations[] = 'border-top-width:' . $weight . ';';
            $width = $this->size($settings['width' . $suffix] ?? null, '%');
            if ($width !== '') $declarations[] = 'width:' . $width . ';';
            $color = $this->color_setting($settings, 'color' . $suffix);
            if ($color !== '') $declarations[] = 'border-color:' . $color . ';';
        }
        $rules = $declarations ? [$target . '{' . implode('', $declarations) . '}'] : [];
        // Box, testimonial and disclosure typography uses distinct source controls.
        $parts = match ($type) {
            'image-box' => ['title' => '.elementor-native-card-title', 'description' => '.elementor-native-card-description'],
            'testimonial' => ['content' => 'blockquote', 'name' => '.elementor-native-card-title', 'job' => '.elementor-native-card-description'],
            'counter' => ['number' => '.elementor-native-counter-number', 'title' => '.elementor-native-counter-title'],
            'accordion', 'toggle' => ['title' => 'summary', 'content' => '.elementor-native-disclosure-content'],
            default => [],
        };
        foreach ($parts as $part => $child) {
            $part_settings = $part;
            $styles = $this->typography_declarations($settings, $part_settings . '_typography', $suffix);
            // Group controls may be named title_typography or number_typography, with the member suffix only once.
            $styles = array_merge($styles, $this->typography_declarations($settings, $type === 'counter' ? 'typography_' . $part : $part_settings, $suffix));
            $color_key = $type === 'testimonial' ? ($part === 'content' ? 'content_content_color' : $part . '_text_color') : $part_settings . '_color';
            $color = $this->color_setting($settings, $color_key . $suffix);
            if ($color !== '') $styles[] = 'color:' . $color . ';';
            if ($styles) $rules[] = $selector . ' ' . $child . '{' . implode('', array_unique($styles)) . '}';
        }
        if ($type === 'button') {
            $hover = [];
            foreach (['hover_color' => 'color', 'button_background_hover_color' => 'background-color', 'button_hover_border_color' => 'border-color'] as $key => $property) {
                $value = $this->color_setting($settings, $key . $suffix);
                if ($value !== '') $hover[] = $property . ':' . $value . ';';
            }
            if ($hover) $rules[] = $target . ':hover,' . $target . ':focus-visible{' . implode('', $hover) . '}';
        }
        return $rules;
    }

    /** @param array<string,mixed> $settings @return list<string> */
    private function typography_declarations(array $settings, string $prefix, string $suffix): array {
        $declarations = [];
        $references = is_array($settings['__globals__'] ?? null) ? $settings['__globals__'] : [];
        $global_ref = (string) (($references[$prefix . '_typography' . $suffix] ?? '') ?: ($references[$prefix . '_typography'] ?? ''));
        $global = [];
        if (preg_match('~globals/typography\?id=([A-Za-z0-9_-]+)~', $global_ref, $match)) {
            $candidate = $this->globals['typography'][$match[1]] ?? [];
            if (is_array($candidate)) $global = $candidate;
        }
        // Responsive global values inherit through CSS. Re-emitting desktop values
        // at tablet/mobile would erase the source's intermediate overrides.
        $value_for = static function(string $property) use ($settings, $prefix, $suffix, $global): mixed {
            $value = $settings[$prefix . '_' . $property . $suffix] ?? null;
            if (is_array($value) && ($value['size'] ?? '') === '') $value = null;
            if ($value !== null && $value !== '') return $value;
            return $global[$property . $suffix] ?? $global['typography_' . $property . $suffix] ?? null;
        };
        $family = trim((string) $value_for('font_family'));
        $family = trim((string) preg_replace('/[^\pL\pN _-]+/u', '', $family));
        if ($family !== '') $declarations[] = 'font-family:"' . $this->css_string($family) . '",sans-serif;';
        $weight = trim((string) $value_for('font_weight'));
        if (in_array($weight, ['normal', 'bold', 'bolder', 'lighter'], true) || (ctype_digit($weight) && (int) $weight >= 1 && (int) $weight <= 1000)) $declarations[] = 'font-weight:' . $weight . ';';
        foreach (['font_size' => 'font-size', 'line_height' => 'line-height', 'letter_spacing' => 'letter-spacing', 'word_spacing' => 'word-spacing'] as $key => $property) {
            $value = $this->size($value_for($key), $key === 'line_height' ? '' : 'px');
            if ($value !== '') $declarations[] = $property . ':' . $value . ';';
        }
        foreach (['font_style' => ['normal', 'italic', 'oblique'], 'text_transform' => ['none', 'uppercase', 'lowercase', 'capitalize'], 'text_decoration' => ['none', 'underline', 'overline', 'line-through']] as $key => $allowed) {
            $value = $this->enum((string) $value_for($key), $allowed);
            if ($value !== '') $declarations[] = str_replace('_', '-', $key) . ':' . $value . ';';
        }
        return $declarations;
    }

    private function normalize_breakpoints(mixed $values): array {
        $result = ['tablet' => 1024, 'mobile' => 767];
        foreach (is_array($values) ? $values : [] as $device => $value) {
            if (!in_array($device, ['mobile', 'mobile_extra', 'tablet', 'tablet_extra', 'laptop', 'widescreen'], true)) continue;
            $width = $this->number(is_array($value) ? ($value['value'] ?? $value['width'] ?? null) : $value);
            if ($width !== null && (int) $width >= 320 && (int) $width <= 10000) $result[$device] = (int) $width;
        }
        arsort($result, SORT_NUMERIC);
        return $result;
    }

    private function node_html_id(array $settings, string $stable_id): string {
        $requested = trim((string) ($settings['_element_id'] ?? $settings['anchor'] ?? ''));
        if ($requested === '' || preg_match('/[\s<>"\x00-\x1f\x7f]/u', $requested)) return $stable_id;
        if (isset($this->used_ids[$requested]) && $requested !== $stable_id) {
            $this->warnings[] = 'Um ID de âncora duplicado foi substituído por um ID exclusivo.';
            return $stable_id;
        }
        $this->used_ids[$requested] = true;
        return $requested;
    }

    private function custom_classes(array $settings): string {
        $tokens = preg_split('/\s+/', trim((string) ($settings['_css_classes'] ?? $settings['css_classes'] ?? ''))) ?: [];
        $tokens = array_filter($tokens, static fn(string $token): bool => preg_match('/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/D', $token) === 1);
        return $tokens ? ' ' . implode(' ', array_unique($tokens)) : '';
    }

    private function base_css(): string {
        $tokens = [
            ':root{--elementor-converted-text:#1f2937;--elementor-converted-surface:#ffffff;--elementor-converted-accent:#6d5dfc;',
        ];
        foreach (is_array($this->globals['colors'] ?? null) ? $this->globals['colors'] : [] as $id => $value) {
            $color = $this->color(is_array($value) ? (string) ($value['color'] ?? '') : (string) $value);
            if ($color !== '') $tokens[] = '--elementor-' . $this->css_identifier((string) $id) . ':' . $color . ';--e-global-color-' . $this->css_identifier((string) $id) . ':' . $color . ';';
        }
        $tokens[] = '}';
        $css = implode('', $tokens) . "\n" . <<<'CSS'
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;min-width:320px;background:var(--elementor-converted-surface);color:var(--elementor-converted-text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}
img,svg,video{display:block;max-width:100%;height:auto}
a{color:inherit}
:focus-visible{outline:2px solid var(--elementor-converted-accent);outline-offset:3px}
.elementor-converted-page{width:100%;min-height:100svh;overflow-x:clip}
.elementor-native-node{min-width:0;max-width:100%}
.elementor-native-section{display:flex;flex-wrap:wrap;width:100%}
.elementor-native-column{display:flex;flex:1 1 0;flex-direction:column}
.elementor-native-container{display:flex;flex-direction:column}
.elementor-native-widget-image img{width:var(--elementor-image-width,auto)}
.elementor-native-widget-image{margin:0}
.elementor-native-widget-image img{display:inline-block;vertical-align:middle}
.elementor-native-widget-heading{font-size:2rem;font-weight:600;line-height:1.2}
.elementor-native-widget-heading > *{margin:0;font:inherit;letter-spacing:inherit}
.elementor-native-widget-heading a{text-decoration:inherit}
.elementor-native-widget-image-gallery{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}
.elementor-native-widget-image-gallery figure{margin:0}
.elementor-native-widget-image-gallery img{width:100%;height:auto}
.elementor-native-widget-image-box img,.elementor-native-widget-testimonial img{margin-inline:auto}
.elementor-native-widget-testimonial{text-align:center}
.elementor-native-widget-testimonial blockquote{margin:0 0 1rem}
.elementor-native-widget-testimonial img{width:60px;height:60px;object-fit:cover;border-radius:50%}
.elementor-native-widget-accordion details,.elementor-native-widget-toggle details{border:1px solid #d5d8dc}
.elementor-native-widget-accordion summary,.elementor-native-widget-toggle summary{cursor:pointer;padding:15px 20px;font-weight:700}
.elementor-native-disclosure-content{padding:15px 20px}
.elementor-native-counter-number{font-size:69px;font-weight:600;line-height:1}
.elementor-native-counter-title{font-size:19px}
.elementor-native-widget-counter{text-align:center}
.elementor-native-widget-progress progress{display:block;width:100%;accent-color:var(--elementor-converted-accent)}
.kodety-button{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.75rem 1.25rem;border-radius:var(--elementor-button-radius,.375rem);background:var(--elementor-button-bg,var(--elementor-converted-accent));color:inherit;text-decoration:none}
.elementor-native-widget-divider hr{width:var(--elementor-divider-width,100%);margin:0;border:0;border-top:var(--elementor-divider-weight,1px) solid currentColor}
.elementor-native-fallback{padding:1rem;border:1px dashed #b6b6c8;border-radius:.5rem;background:#f7f7fb}
.elementor-native-rendered-widget [data-kodety-elementor-inert]{pointer-events:none}
.elementor-native-image-placeholder{min-height:12rem;background:#ececf3;border-radius:.5rem}
CSS;
        // Legacy Elementor columns stack only at the source mobile breakpoint.
        return $css . "\n" . '@media (max-width:' . $this->breakpoints['mobile'] . 'px){.elementor-native-widget-image-gallery{grid-template-columns:repeat(2,minmax(0,1fr));}}';
    }

    private function stable_id(string $source_id): string {
        $source = $this->css_identifier($source_id !== '' ? $source_id : 'node-' . $this->node_count);
        $base = 'elementor-' . ($this->source_post_id > 0 ? $this->source_post_id . '-' : '') . $source;
        $candidate = $base;
        $suffix = 2;
        while (isset($this->used_ids[$candidate])) $candidate = $base . '-' . $suffix++;
        $this->used_ids[$candidate] = true;
        return $candidate;
    }

    private function widget_label(string $widget_type): string {
        return match ($widget_type) {
            'heading' => 'Título',
            'text-editor' => 'Texto',
            'image' => 'Imagem',
            'button' => 'Botão',
            'divider' => 'Divisor',
            'spacer' => 'Espaçador',
            'image-box' => 'Imagem com texto',
            'testimonial' => 'Depoimento',
            'image-gallery' => 'Galeria de imagens',
            'accordion' => 'Acordeão',
            'toggle' => 'Conteúdo expansível',
            'counter' => 'Contador',
            'progress' => 'Progresso',
            'menu-anchor' => 'Âncora',
            'html' => 'HTML',
            default => 'Widget Elementor · ' . ($widget_type !== '' ? $widget_type : 'desconhecido'),
        };
    }

    private function dimension(mixed $value): string {
        if (!is_array($value)) return '';
        $unit = $this->unit((string) ($value['unit'] ?? 'px'));
        $parts = [];
        foreach (['top', 'right', 'bottom', 'left'] as $side) {
            $number = $this->number($value[$side] ?? null);
            if (($value[$side] ?? '') === 'auto') $parts[] = 'auto';
            elseif ($number !== null) $parts[] = $number . $unit;
            elseif (($value['isLinked'] ?? false) && isset($parts[0])) $parts[] = $parts[0];
            else return '';
        }
        return implode(' ', $parts);
    }

    private function size(mixed $value, string $default_unit): string {
        $unit = $default_unit;
        if (is_array($value)) {
            $unit = $this->unit((string) ($value['unit'] ?? $default_unit));
            $value = $value['size'] ?? $value['value'] ?? null;
        } else {
            $unit = $this->unit($default_unit);
        }
        $number = $this->number($value);
        return $number === null ? '' : $number . $unit;
    }

    private function number(mixed $value): ?string {
        if (!is_int($value) && !is_float($value) && !(is_string($value) && preg_match('/^-?(?:\d+|\d*\.\d+)$/D', trim($value)))) return null;
        $number = (float) $value;
        if (!is_finite($number) || abs($number) > 100000) return null;
        $normalized = rtrim(rtrim(number_format($number, 4, '.', ''), '0'), '.');
        return $normalized !== '' && $normalized !== '-' ? $normalized : '0';
    }

    private function unit(string $unit): string {
        $unit = strtolower(trim($unit));
        return in_array($unit, ['', 'px', '%', 'em', 'rem', 'vw', 'vh', 'svh', 'dvh'], true) ? $unit : 'px';
    }

    /** @param array<string,mixed> $settings */
    private function color_setting(array $settings, string $key): string {
        $value = (string) ($settings[$key] ?? '');
        $references = is_array($settings['__globals__'] ?? null) ? $settings['__globals__'] : [];
        $reference = (string) ($references[$key] ?? '');
        if ($reference !== '' && preg_match('~globals/colors\?id=([A-Za-z0-9_-]+)~', $reference, $match)) {
            $candidate = $this->globals['colors'][$match[1]] ?? '';
            $value = is_array($candidate) ? (string) ($candidate['color'] ?? '') : (string) $candidate;
        }
        return $this->color($value);
    }

    private function color(string $value): string {
        $value = trim($value);
        if (preg_match('/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iD', $value)) return strtolower($value);
        if (preg_match('/^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s-]+\)$/iD', $value)) return $value;
        if (preg_match('/^var\(--[a-z0-9_-]+\)$/iD', $value)) return $value;
        if (in_array(strtolower($value), ['transparent', 'currentcolor', 'inherit', 'black', 'white'], true)) return strtolower($value);
        return '';
    }

    private function enum(string $value, array $allowed): string {
        $value = strtolower(trim($value));
        return in_array($value, $allowed, true) ? $value : '';
    }

    private function css_identifier(string $value): string {
        $value = strtolower(trim($value));
        $value = (string) preg_replace('/[^a-z0-9_-]+/', '-', $value);
        $value = trim($value, '-_');
        return $value !== '' ? substr($value, 0, 100) : 'node';
    }

    private function css_string(string $value): string {
        return str_replace(['\\', '"', '<', '>', "\n", "\r"], ['\\\\', '\\"', '\\3c ', '\\3e ', '', ''], $value);
    }

    private function plain_text(string $value): string {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = (string) preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $value);
        return trim((string) preg_replace('/\s+/u', ' ', $value));
    }

    private function sanitize_inline(string $html): string {
        $html = strip_tags($html, '<span><strong><b><em><i><u><s><br><small><sup><sub>');
        return $this->sanitize_fragment($html);
    }

    private function sanitize_fragment(string $html): string {
        $html = trim($html);
        if ($html === '') return '';
        // KSES is the first allow-list pass in WordPress, not the last one.
        // Continue through the DOM hardening so any preserved form controls are
        // inert and author CSS cannot retain executable/priority escapes.
        if (function_exists('wp_kses_post')) $html = trim((string) wp_kses_post($html));
        if ($html === '') return '';
        if (!class_exists('DOMDocument')) {
            $this->warnings[] = 'A extensão DOM não está disponível; fragmentos foram reduzidos a texto seguro.';
            return $this->escape($this->plain_text($html));
        }
        $previous = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        $dom->loadHTML('<?xml encoding="utf-8" ?><div id="kodety-fragment-root">' . $html . '</div>', LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_COMPACT);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        $root = null;
        foreach ($dom->getElementsByTagName('div') as $div) {
            if ($div instanceof DOMElement && $div->getAttribute('id') === 'kodety-fragment-root') { $root = $div; break; }
        }
        if (!$root instanceof DOMElement) return '';
        foreach (iterator_to_array($root->getElementsByTagName('*')) as $element) {
            if (!$element instanceof DOMElement) continue;
            $tag = strtolower($element->tagName);
            if (in_array($tag, ['script', 'style', 'iframe', 'object', 'embed', 'meta', 'base', 'link', 'animate', 'animatetransform', 'animatemotion', 'set', 'foreignobject'], true)) {
                $element->parentNode?->removeChild($element);
                continue;
            }
            foreach (iterator_to_array($element->attributes ?? []) as $attribute) {
                $name = strtolower($attribute->name);
                $value = $attribute->value;
                if (str_starts_with($name, 'on') || in_array($name, ['srcdoc', 'integrity', 'formaction', 'formmethod', 'formtarget', 'autofocus', 'autoplay'], true)) {
                    $element->removeAttribute($attribute->name);
                    continue;
                }
                if (in_array($name, ['href', 'xlink:href', 'src', 'poster', 'action', 'background'], true)) {
                    $safe = $this->safe_url($value);
                    if ($name === 'action' || $safe === '') $element->removeAttribute($attribute->name);
                    else $element->setAttribute($attribute->name, $safe);
                } elseif ($name === 'srcset') {
                    $candidates = [];
                    foreach (explode(',', $value) as $candidate) {
                        $parts = preg_split('/\s+/', trim($candidate)) ?: [];
                        $url = $this->safe_url((string) ($parts[0] ?? ''));
                        $descriptor = (string) ($parts[1] ?? '');
                        if ($url !== '' && count($parts) <= 2 && ($descriptor === '' || preg_match('/^\d+(?:\.\d+)?[wx]$/D', $descriptor))) {
                            $candidates[] = $url . ($descriptor !== '' ? ' ' . $descriptor : '');
                        }
                    }
                    if ($candidates) $element->setAttribute('srcset', implode(', ', $candidates));
                    else $element->removeAttribute('srcset');
                } elseif ($name === 'style') {
                    $clean = (string) preg_replace('/\s*!\s*important\b/i', '', $value);
                    if (preg_match('/(?:expression\s*\(|javascript\s*:|@import|behavior\s*:|-moz-binding\s*:|[<>\\\\])/i', $clean)) $element->removeAttribute('style');
                    else $element->setAttribute('style', $clean);
                }
            }
            if ($tag === 'form') {
                $element->setAttribute('data-kodety-elementor-inert', 'true');
                $element->setAttribute('aria-disabled', 'true');
                $element->removeAttribute('action');
                $element->removeAttribute('method');
            }
            if (in_array($tag, ['input', 'select', 'textarea', 'button'], true)) $element->setAttribute('disabled', 'disabled');
            if ($tag === 'a' && strtolower($element->getAttribute('target')) === '_blank') {
                $rel = preg_split('/\s+/', trim($element->getAttribute('rel'))) ?: [];
                $element->setAttribute('rel', trim(implode(' ', array_unique([...$rel, 'noopener']))));
            }
        }
        $output = '';
        foreach (iterator_to_array($root->childNodes) as $child) $output .= $dom->saveHTML($child);
        return trim($output);
    }

    private function safe_url(string $url): string {
        $url = trim(html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($url === '' || preg_match('/[\x00-\x20\x7f\\\\]/', $url)) return '';
        if (str_starts_with($url, '#')) return $url;
        if (preg_match('~^(?:mailto|tel):~i', $url)) return $url;
        if (preg_match('~^https?://~i', $url)) return parse_url($url, PHP_URL_HOST) ? $url : '';
        if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $url)) return '';
        $base = parse_url($this->source_url);
        if (str_starts_with($url, '//')) {
            return (is_array($base) && ($base['scheme'] ?? '') === 'http' ? 'http:' : 'https:') . $url;
        }
        if (!is_array($base) || empty($base['host']) || !in_array($base['scheme'] ?? '', ['http', 'https'], true)) return $url;
        $origin = $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '');
        $path = (string) ($base['path'] ?? '/');
        if (str_starts_with($url, '?')) return $origin . $path . $url;
        if (!str_starts_with($url, '/')) $url = substr($path, 0, (int) strrpos($path, '/') + 1) . $url;
        $parts = preg_split('/(?=[?#])/', $url, 2) ?: [$url];
        $segments = [];
        foreach (explode('/', $parts[0]) as $segment) {
            if ($segment === '..') array_pop($segments);
            elseif ($segment !== '.') $segments[] = $segment;
        }
        return $origin . '/' . ltrim(implode('/', $segments), '/') . ($parts[1] ?? '');
    }

    private function escape(string $value): string {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }
}
