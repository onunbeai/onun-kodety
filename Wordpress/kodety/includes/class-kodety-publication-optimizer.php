<?php

defined('ABSPATH') || exit;

/** Publication-only transformations, invoked on disposable staging by the publisher. */
final class Kodety_Publication_Optimizer {
    public const VERSION = 2;
    public const MAX_HTML_BYTES = 8 * 1024 * 1024;
    public const MAX_TEXT_BYTES = 8 * 1024 * 1024;
    public const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    public const MAX_IMAGE_PIXELS = 12 * 1000 * 1000;
    public const MAX_WORK_BYTES = 128 * 1024 * 1024;

    /** Names are shared by REST, wp-admin, Publish and each release receipt. */
    public static function options(): array {
        return [
            'compressHtml' => ['label' => 'Comprimir HTML', 'description' => 'Reduz a transferência sem remover espaços, comentários ou código.', 'icon' => 'file'],
            'compressAssets' => ['label' => 'Comprimir CSS e JavaScript', 'description' => 'Entrega arquivos menores quando a hospedagem aceita compressão, mantendo o conteúdo original.', 'icon' => 'code'],
            'optimizeImages' => ['label' => 'Otimizar imagens locais', 'description' => 'Cria versões WebP de alta qualidade quando ficam menores, preservando o arquivo original.', 'icon' => 'image'],
            'imageDimensions' => ['label' => 'Estabilizar imagens', 'description' => 'Reserva o espaço de imagens com dimensões conhecidas, sem adiar a imagem principal.', 'icon' => 'image'],
            'preloadFonts' => ['label' => 'Antecipar fontes essenciais', 'description' => 'Prioriza fontes locais usadas no texto principal, sem carregar toda a biblioteca.', 'icon' => 'text'],
            'preloadModules' => ['label' => 'Antecipar módulos JavaScript', 'description' => 'Antecipa recursos locais sem mudar a ordem ou o momento de execução dos scripts.', 'icon' => 'code'],
            'preconnect' => ['label' => 'Preparar conexões externas', 'description' => 'Antecipa a conexão com origens já usadas por recursos essenciais da página.', 'icon' => 'link'],
        ];
    }

    public static function defaults(bool $enabled = true): array {
        return ['version' => self::VERSION, 'enabled' => $enabled]
            + array_fill_keys(array_keys(self::options()), true)
            + ['exclusions' => []];
    }

    /** Old, permanently disabled switches must never reactivate the old engine. */
    public static function from_saved(mixed $value): array {
        if (!is_array($value) || ($value['version'] ?? null) !== self::VERSION) return self::defaults(false);
        try { return self::normalize($value); } catch (InvalidArgumentException) { return self::defaults(false); }
    }

    /** Preferences adopt current defaults; explicit v2 choices always survive. */
    public static function from_preferences(mixed $value): array {
        if (!is_array($value) || !isset($value['version'])) return self::defaults();
        return self::from_saved($value);
    }

    /** Reject malformed input instead of silently turning a feature on or off. */
    public static function normalize(array $value): array {
        if (($value['version'] ?? null) !== self::VERSION) throw new InvalidArgumentException('Atualize o Onun Kodety para salvar as otimizações desta versão.');
        $settings = self::defaults();
        foreach (array_merge(['enabled'], array_keys(self::options())) as $key) {
            if (!array_key_exists($key, $value) || !is_bool($value[$key])) throw new InvalidArgumentException('Preferência de otimização inválida: ' . $key . '.');
            $settings[$key] = $value[$key];
        }
        $exclusions = $value['exclusions'] ?? [];
        if (!is_array($exclusions) || count($exclusions) > 100) throw new InvalidArgumentException('Use até 100 exclusões de arquivos.');
        $settings['exclusions'] = [];
        foreach ($exclusions as $exclusion) {
            if (!is_string($exclusion)) throw new InvalidArgumentException('Cada exclusão precisa ser um caminho de arquivo.');
            $exclusion = ltrim(trim($exclusion), '/');
            if ($exclusion === '') continue;
            if (strlen($exclusion) > 240 || preg_match('~[\x00-\x1f\x7f\\\\]|(?:^|/)\.\.(?:/|$)|://~', $exclusion)) {
                throw new InvalidArgumentException('Caminho de exclusão inválido. Use caminhos relativos ao projeto.');
            }
            $settings['exclusions'][] = $exclusion;
        }
        $settings['exclusions'] = array_values(array_unique($settings['exclusions']));
        return $settings;
    }

    public static function revision(array $settings): string {
        return hash('sha256', (string) json_encode(self::from_saved($settings), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    public static function excluded(string $path, array $settings): bool {
        $path = ltrim(str_replace('\\', '/', $path), '/');
        foreach ($settings['exclusions'] ?? [] as $pattern) {
            $expression = '~^' . str_replace(['\\*', '\\?'], ['.*', '.'], preg_quote($pattern, '~')) . '$~D';
            // An exhausted matcher must preserve the file, never silently
            // bypass an explicit exclusion.
            if (preg_match($expression, $path) !== 0) return true;
        }
        return false;
    }

    /**
     * Read-only token spans. An ambiguous/incomplete document is a pass-through.
     * Text nodes, raw-text content, comments, templates and foreign trees are
     * never serialized. Attribute patches later touch only the selected bytes.
     * @return list<array{name:string,offset:int,length:int,tag:string,attrs:array,closing:bool}>|null
     */
    public static function tokens(string $html): ?array {
        if (strlen($html) > self::MAX_HTML_BYTES || !self::memory_available(strlen($html)*3+16*1024*1024)) return null;
        $tokens = [];
        $length = strlen($html);
        $cursor = 0;
        $inert = [];
        $raw = ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'];
        while (($start = strpos($html, '<', $cursor)) !== false) {
            if (substr($html, $start, 4) === '<!--') {
                $end = strpos($html, '-->', $start + 4);
                if ($end === false) return null;
                $comment = substr($html, $start, $end + 3 - $start);
                if (preg_match('~^<!--\s*kodety-custom-code:start\s+(\S+)\s*-->$~', $comment, $custom)) {
                    $closing = '~<!--\s*kodety-custom-code:end\s+' . preg_quote($custom[1], '~') . '\s*-->~';
                    if (!preg_match($closing, $html, $close, PREG_OFFSET_CAPTURE, $end + 3)) return null;
                    $cursor = $close[0][1] + strlen($close[0][0]);
                } else { $cursor = $end + 3; }
                continue;
            }
            // CDATA/declarations in foreign content stay opaque as one token.
            if (substr($html, $start, 9) === '<![CDATA[') {
                $end = strpos($html, ']]>', $start + 9);
                if ($end === false) return null;
                $cursor = $end + 3;
                continue;
            }
            // A normal HTML doctype has no executable tags. Exotic declarations
            // or processing instructions make this document a pass-through.
            if (substr($html, $start, 2) === '<!' || substr($html, $start, 2) === '<?') {
                if (!preg_match('~\G<!doctype[\x20\t\r\n\f]+html[\x20\t\r\n\f]*>~i', $html, $doctype, 0, $start)) return null;
                $cursor = $start + strlen($doctype[0]);
                continue;
            }
            if (!preg_match('~\G<(/?)([a-zA-Z][a-zA-Z0-9:-]*)(?=[\x20\t\r\n\f/>])~', $html, $match, 0, $start)) {
                $cursor = $start + 1;
                continue;
            }
            $quote = null;
            $end = $start + strlen($match[0]);
            for (; $end < $length; $end++) {
                $char = $html[$end];
                if ($quote !== null) { if ($char === $quote) $quote = null; }
                elseif ($char === '"' || $char === "'") $quote = $char;
                elseif ($char === '>') break;
                elseif ($char === '<') return null;
            }
            if ($end >= $length || $quote !== null) return null;
            $name = strtolower($match[2]);
            $closing = $match[1] === '/';
            $tag = substr($html, $start, $end - $start + 1);
            $attrs = self::attributes($tag);
            if ($attrs === null) return null;
            $cursor = $end + 1;
            if ($name === 'plaintext') return null;
            if (!$closing && in_array($name, $raw, true)) {
                if (!preg_match('~</' . $name . '(?=[\x20\t\r\n\f/>])[^>]*>~i', $html, $close, PREG_OFFSET_CAPTURE, $cursor)) return null;
                $payload = substr($html, $cursor, $close[0][1] - $cursor);
                // Script double-escaped states need the browser tokenizer. Keep
                // the complete document unchanged instead of guessing at them.
                if ($name === 'script' && str_contains($payload, '<!--') && stripos($payload, '<script') !== false) return null;
                if (!$inert && in_array($name, ['script', 'style'], true)) {
                    $tokens[] = ['name'=>$name,'offset'=>$start,'length'=>strlen($tag),'tag'=>$tag,'attrs'=>$attrs,'closing'=>false,'content'=>$payload];
                }
                $cursor = $close[0][1] + strlen($close[0][0]);
                continue;
            }
            if (in_array($name, ['template', 'svg', 'math'], true)) {
                if ($closing) {
                    if (end($inert) !== $name) return null;
                    array_pop($inert);
                } elseif ($name === 'template' || !str_ends_with(rtrim($tag), '/>')) { $inert[] = $name; }
                continue;
            }
            if (!$inert) $tokens[] = ['name'=>$name,'offset'=>$start,'length'=>strlen($tag),'tag'=>$tag,'attrs'=>$attrs,'closing'=>$closing];
            if (count($tokens) > 20000 || (count($tokens)%256===0 && !self::memory_available(16*1024*1024))) return null;
        }
        return $inert ? null : $tokens;
    }

    private static function memory_available(int $bytes): bool {
        $limit=trim((string)ini_get('memory_limit'));
        $limit_bytes=(int)$limit * match(strtolower(substr($limit,-1))){'g'=>1024**3,'m'=>1024**2,'k'=>1024,default=>1};
        return $limit_bytes<=0 || memory_get_usage(true)+$bytes<$limit_bytes;
    }

    private string $root = '';
    private string $web_root = '';
    private array $settings = [];
    private array $report = [];
    private array $images = [];
    private int $work_bytes = 0;
    private float $deadline = 0;
    private bool $image_directory_available = false;

    /** Run only against the disposable public tree before its atomic activation. */
    public function run(string $site_root, array $settings, string $release, string $web_root = ''): array {
        $this->root = realpath($site_root) ?: '';
        if ($this->root === '' || !is_dir($this->root) || is_link($site_root)) throw new RuntimeException('A árvore de publicação não está disponível.');
        $this->settings = self::from_saved($settings);
        $this->web_root = trim(str_replace('\\', '/', $web_root), '/');
        if (str_contains($this->web_root, '..') || str_contains($this->web_root, "\0")) throw new RuntimeException('Raiz pública inválida.');
        $execution_limit = (int) ini_get('max_execution_time');
        $request_started = (float) ($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true));
        $this->deadline = min(microtime(true) + 20, $execution_limit > 0 ? $request_started + max(0, $execution_limit - 10) : INF);
        $this->work_bytes = 0;
        $this->images = [];
        $this->report = [
            'version'=>self::VERSION, 'release'=>$release, 'settings'=>$this->settings,
            'html'=>0, 'css'=>0, 'images'=>0, 'fonts'=>0, 'scripts'=>0,
            'bytesSaved'=>0, 'compressionBytesSaved'=>0, 'filesInspected'=>0,
            'applied'=>[], 'skipped'=>[], 'findings'=>[],
            'delivery'=>['html'=>'disabled','assets'=>'disabled'],
        ];
        if (!$this->settings['enabled']) return $this->report;
        $this->image_directory_available = !file_exists($this->asset_directory());
        if (!$this->image_directory_available) $this->skip('optimizeImages','reserved_directory_exists');
        $paths = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($this->root, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($this->budget_exhausted()) { $this->skip('pipeline','work_limit'); break; }
            if (!$file->isFile() || $file->isLink()) continue;
            $relative = substr($file->getPathname(), strlen($this->root) + 1);
            if (preg_match('~(?:^|/)[.]|(?:^|/)kodety-optimized-assets-v2/|[.]gz$~', $relative)) continue;
            if (count($paths) >= 10000) { $this->skip('pipeline','file_limit'); break; }
            $paths[] = $file->getPathname();
        }
        sort($paths, SORT_STRING);
        foreach ($paths as $path) {
            $relative = substr($path, strlen($this->root) + 1);
            if (self::excluded($relative, $this->settings)) { $this->skip('pipeline','excluded'); continue; }
            if ($this->budget_exhausted()) { $this->skip('pipeline','work_limit'); break; }
            $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
            $size = filesize($path);
            if ($size === false || $size > self::MAX_TEXT_BYTES) { $this->skip('pipeline','file_size_limit'); continue; }
            if (!in_array($extension, ['html','htm','css','js','mjs','cjs','json','svg','txt','xml'], true)) continue;
            if (in_array($extension, ['js','mjs','cjs','css'], true) && $size > 256 * 1024) {
                $this->finding('large_code_asset', $relative, 'Arquivo de código acima de 256 KB. A compressão reduz a transferência; dividir ou remover código exige uma revisão do projeto.');
            }
            if (!self::memory_available($size * 4 + 16 * 1024 * 1024)) { $this->skip('pipeline','memory_limit'); continue; }
            $this->report['filesInspected']++;
            $content = file_get_contents($path);
            if (!is_string($content)) { $this->skip('pipeline','unreadable'); continue; }
            $this->work_bytes += strlen($content);
            if (in_array($extension,['html','htm'],true)) {
                $optimized = $this->document($content, $path);
                if ($optimized !== $content) {
                    self::write_atomic($path,$optimized);
                    $this->report['html']++;
                }
            } elseif ($this->settings['compressAssets'] && strlen($content) >= 1024) {
                $this->compress_asset($path,$content);
            }
        }
        if ($this->settings['compressHtml']) {
            $this->report['delivery']['html'] = function_exists('gzencode') ? 'negotiated' : 'unavailable';
            if (!function_exists('gzencode')) $this->skip('compressHtml','zlib_unavailable');
        }
        if ($this->settings['compressAssets']) $this->report['delivery']['assets'] = 'requires_host_support';
        return $this->report;
    }

    private function skip(string $feature, string $reason): void {
        $key = $feature . ':' . $reason;
        $this->report['skipped'][$key] = ($this->report['skipped'][$key] ?? 0) + 1;
    }

    private function applied(string $feature, int $amount = 1): void {
        $this->report['applied'][$feature] = ($this->report['applied'][$feature] ?? 0) + $amount;
    }

    private function finding(string $code, string $path, string $message): void {
        if (count($this->report['findings']) >= 30) return;
        $finding = ['code'=>$code, 'path'=>$path, 'message'=>$message];
        if (!in_array($finding, $this->report['findings'], true)) $this->report['findings'][] = $finding;
    }

    private function hint_key(string $url, string $owner): string {
        $local = $this->local_path($url, $owner);
        return $local ? $local . substr($url, strcspn($url, '?#')) : rtrim($url, '/');
    }

    private function budget_exhausted(): bool {
        return $this->work_bytes >= self::MAX_WORK_BYTES || microtime(true) >= $this->deadline;
    }

    private function asset_directory(): string {
        return $this->root . ($this->web_root !== '' ? '/' . $this->web_root : '') . '/kodety-optimized-assets-v2';
    }

    private function local_path(string $url, string $owner): ?string {
        if ($url === '' || preg_match('~[\x00-\x20\x7f\\\\]|^[a-z][a-z0-9+.-]*:|^//|^[#?]~i', $url)) return null;
        $path = rawurldecode(explode('#',explode('?', $url,2)[0],2)[0]);
        if (preg_match('~[\x00-\x1f\x7f\\\\]~', $path)) return null;
        $candidate = str_starts_with($path, '/')
            ? $this->root . ($this->web_root !== '' ? '/' . $this->web_root : '') . $path
            : dirname($owner) . '/' . $path;
        $resolved = realpath($candidate);
        if (!$resolved || !str_starts_with($resolved,$this->root . DIRECTORY_SEPARATOR) || !is_file($resolved) || is_link($candidate)) return null;
        $relative = substr($resolved,strlen($this->root)+1);
        if (preg_match('~(?:^|/)[.]~',$relative) || self::excluded($relative,$this->settings)) return null;
        return $resolved;
    }

    private function compress_asset(string $path, string $content): void {
        if (!function_exists('gzencode')) { $this->skip('compressAssets','zlib_unavailable'); return; }
        // Never overwrite an authored sidecar or require compression to serve a file.
        if (file_exists($path . '.gz')) { $this->skip('compressAssets','authored_sidecar'); return; }
        $compressed = gzencode($content,6);
        if (!is_string($compressed) || strlen($compressed) >= strlen($content) * .95 || gzdecode($compressed) !== $content) { $this->skip('compressAssets','no_verified_saving'); return; }
        try { self::write_atomic($path . '.gz',$compressed); }
        catch (Throwable) { $this->skip('compressAssets','write_failed'); return; }
        $this->report['compressionBytesSaved'] += strlen($content)-strlen($compressed);
        $this->applied('compressAssets');
    }

    private static function write_atomic(string $path, string $content): void {
        $temporary = $path . '.kodety-next-' . bin2hex(random_bytes(6));
        try {
            if (file_put_contents($temporary,$content,LOCK_EX) !== strlen($content)
                || !hash_equals(hash('sha256',$content),(string)hash_file('sha256',$temporary))
                || !rename($temporary,$path)) throw new RuntimeException('Não foi possível gravar um artefato completo da publicação.');
        } finally { if (is_file($temporary)) @unlink($temporary); }
    }

    private function image(string $path): ?array {
        if (array_key_exists($path,$this->images)) return $this->images[$path];
        $this->images[$path] = null;
        $size = filesize($path);
        if ($size === false || $size > self::MAX_IMAGE_BYTES || $this->budget_exhausted() || !self::memory_available($size * 3 + 16 * 1024 * 1024)) {
            $this->skip('images','size_or_work_limit');return null;
        }
        $info = @getimagesize($path);
        if (!$info || !in_array($info[2],[IMAGETYPE_JPEG,IMAGETYPE_PNG,IMAGETYPE_WEBP],true)
            || $info[0]<1 || $info[1]<1 || $info[0]*$info[1]>self::MAX_IMAGE_PIXELS
            || $size===false || $size>self::MAX_IMAGE_BYTES || $this->budget_exhausted()) {
            $this->skip('images','unsupported_or_size_limit');return null;
        }
        $result=['width'=>$info[0],'height'=>$info[1],'url'=>null];
        // Orientation applies to dimensions too, even when conversion is off.
        $bytes=file_get_contents($path);
        if (!is_string($bytes)) return null;
        $this->work_bytes+=strlen($bytes);
        if ($info[2]===IMAGETYPE_JPEG && str_contains($bytes,"Exif\0\0")) {
            $exif=function_exists('exif_read_data') ? @exif_read_data($path) : false;
            if (!is_array($exif) || (int)($exif['Orientation']??1)!==1) {
                $this->skip('images','orientation_unknown_or_rotated');return null;
            }
        }
        if (($info[2]===IMAGETYPE_PNG && str_contains($bytes,'eXIf')) || ($info[2]===IMAGETYPE_WEBP && str_contains($bytes,'EXIF'))) {
            $this->skip('images','orientation_metadata');return null;
        }
        $this->images[$path]=$result;
        if (!$this->settings['optimizeImages'] || !$this->image_directory_available || $info[2]===IMAGETYPE_WEBP) return $result;
        if (!function_exists('imagewebp') || !function_exists('imagecreatefromstring')) { $this->skip('optimizeImages','encoder_unavailable');return $result; }
        $limit=trim((string)ini_get('memory_limit'));
        $limit_bytes=(int)$limit * match(strtolower(substr($limit,-1))){'g'=>1024**3,'m'=>1024**2,'k'=>1024,default=>1};
        if ($limit_bytes>0 && memory_get_usage(true)+$info[0]*$info[1]*20+$size*3+16*1024*1024>$limit_bytes) { $this->skip('optimizeImages','memory_limit');return $result; }
        // GD does not retain arbitrary color profiles or animated PNG frames.
        if (str_contains($bytes,'ICC_PROFILE') || str_contains($bytes,'iCCP') || str_contains($bytes,'acTL') || ($info['channels']??3)===4) { $this->skip('optimizeImages','color_profile_or_animation');return $result; }
        if ($info[2]===IMAGETYPE_PNG && (strlen($bytes)<26 || ord($bytes[24])>8 || str_contains($bytes,'gAMA') || str_contains($bytes,'cHRM') || str_contains($bytes,'eXIf'))) {
            $this->skip('optimizeImages','png_color_or_metadata');return $result;
        }
        if ($this->budget_exhausted()) { $this->skip('optimizeImages','work_limit');return $result; }
        if ($info[2]===IMAGETYPE_PNG && !defined('IMG_WEBP_LOSSLESS')) { $this->skip('optimizeImages','lossless_encoder_unavailable');return $result; }
        $quality=$info[2]===IMAGETYPE_PNG ? IMG_WEBP_LOSSLESS : 90;
        $digest=hash('sha256','kodety-v2-webp-'.$quality.'-'.$bytes);
        $directory=$this->asset_directory();
        $target=$directory.'/'.$digest.'.webp';
        $temporary=$target.'.next';
        $decoded=null;
        try {
            if (!is_dir($directory) && !mkdir($directory,0755,true) && !is_dir($directory)) throw new RuntimeException('Image directory unavailable.');
            $decoded=@imagecreatefromstring($bytes);
            if (!$decoded) throw new RuntimeException('Image decoding failed.');
            if (!imageistruecolor($decoded)) imagepalettetotruecolor($decoded);
            imagealphablending($decoded,false);imagesavealpha($decoded,true);
            if (!@imagewebp($decoded,$temporary,$quality)) throw new RuntimeException('WebP encoding failed.');
            $encoded=@getimagesize($temporary);$encoded_size=filesize($temporary);
            if (!$encoded || $encoded[0]!==$info[0] || $encoded[1]!==$info[1] || $encoded[2]!==IMAGETYPE_WEBP || !$encoded_size || $encoded_size>=$size*.9) {
                $this->skip('optimizeImages','no_verified_saving');return $result;
            }
            if (!rename($temporary,$target)) throw new RuntimeException('WebP activation failed.');
            $result['url']='/kodety-optimized-assets-v2/'.$digest.'.webp';
            $this->report['images']++;$this->report['bytesSaved']+=$size-$encoded_size;$this->applied('optimizeImages');
        } catch (Throwable) { $this->skip('optimizeImages','encoding_failed'); }
        finally { if ($decoded) imagedestroy($decoded);if(is_file($temporary))@unlink($temporary); }
        return $this->images[$path]=$result;
    }

    private function document(string $html, string $path): string {
        $tokens=self::tokens($html);
        if ($tokens===null) { $this->skip('html','ambiguous_document');return $html; }
        // Hydrated documents assert the exact server markup. Never mutate their
        // nodes, Custom Code, or explicit page/element exclusions.
        if (preg_match('~data-kodety-no-optimize|data-reactroot|id=["\'](?:__next|__nuxt|__NEXT_DATA__)["\']|<!--/?\$~i',$html)) {
            $this->skip('html','authored_or_hydrated_document');return $html;
        }
        foreach ($tokens as $token) if ($token['name']==='base' && !$token['closing']) { $this->skip('html','authored_base_url');return $html; }
        if (preg_match('~http-equiv\s*=\s*["\']?Content-Security-Policy\b~i',$html)) {
            $this->skip('html','authored_content_security_policy');return $html;
        }
        // Starting a module fetch before a later import map can freeze the
        // wrong resolution. Authored maps keep full ownership of module loading.
        $import_map_owned=preg_match('~\btype\s*=\s*["\']?importmap\b~i',$html)===1;
        if($import_map_owned && $this->settings['preloadModules'])$this->skip('preloadModules','authored_import_map');
        $patches=[];$head_end=null;$in_head=false;$in_picture=0;$existing=[];$hints=[];$styles=[];$origins=[];$modules=0;
        // Attribute selectors can make even an additive dimension change alter
        // the page. Preserve the image nodes on pages with those dependencies.
        $image_attribute_dependency = preg_match('~\[\s*(?:src|width|height)\b|attr\(\s*(?:src|width|height)\b~i', $html) === 1;
        foreach ($tokens as $token) {
            if ($token['name'] !== 'link' || $token['closing']) continue;
            $href=self::attribute($token,'href');$rel=strtolower((string)self::attribute($token,'rel'));
            if (is_string($href) && preg_match('~(?:^|\s)(preload|modulepreload|preconnect)(?:\s|$)~',$rel)) $existing[$this->hint_key($href,$path)]=true;
            if (!is_string($href) || !preg_match('~(?:^|\s)stylesheet(?:\s|$)~',$rel)) continue;
            $css_path=$this->local_path($href,$path);
            if (!$css_path || filesize($css_path)>2*1024*1024 || $this->budget_exhausted()) { $image_attribute_dependency=true;continue; }
            $css=file_get_contents($css_path);
            if (!is_string($css)) { $image_attribute_dependency=true;continue; }
            $this->work_bytes+=strlen($css);
            if (preg_match('~\[\s*(?:src|width|height)\b|attr\(\s*(?:src|width|height)\b|@import\b~i',$css)) $image_attribute_dependency=true;
        }
        foreach ($tokens as $token) {
            $name=$token['name'];
            if ($name==='head') { $in_head=!$token['closing'];if($token['closing'])$head_end=$token['offset'];continue; }
            if ($name==='picture') { $in_picture=max(0,$in_picture+($token['closing']?-1:1));continue; }
            if ($token['closing']) continue;
            if ($name==='link') {
                $href=self::attribute($token,'href');$rel=strtolower((string)self::attribute($token,'rel'));
                if ($in_head && is_string($href) && preg_match('~(?:^|\s)stylesheet(?:\s|$)~',$rel)
                    && !isset($token['attrs']['disabled']) && in_array(self::attribute($token,'media'),[null,'','all','screen'],true)) {
                    $css_path=$this->local_path($href,$path);
                    if ($css_path && filesize($css_path)<=2*1024*1024 && count($styles)<8 && !$this->budget_exhausted()) {
                        $css=file_get_contents($css_path);
                        if(is_string($css)){ $styles[]=[$css,$css_path];$this->work_bytes+=strlen($css); }
                    }
                    $this->hint_origin($href,$origins);
                }
            }
            if ($name==='style' && $in_head && strlen($token['content']??'')<=2*1024*1024 && count($styles)<8) $styles[]=[$token['content'],$path];
            if ($name==='script' && $in_head) {
                $src=self::attribute($token,'src');
                if (is_string($src)) $this->hint_origin($src,$origins);
            }
            if ($name==='script' && !$import_map_owned && $this->settings['preloadModules'] && strtolower((string)self::attribute($token,'type'))==='module') {
                $src=self::attribute($token,'src');
                $local=is_string($src)?$this->local_path($src,$path):null;
                if ($local && filesize($local)<=512*1024 && $modules<2) {
                    $attributes=['rel'=>'modulepreload','href'=>$src];
                    foreach(['crossorigin','integrity','referrerpolicy'] as $attr) {
                        $value=self::attribute($token,$attr);if($value!==null)$attributes[$attr]=$value===true?'':$value;
                    }
                    $hints[$src]=['feature'=>'preloadModules','attributes'=>$attributes];$modules++;
                }
            }
            if ($name!=='img' || (!$this->settings['optimizeImages'] && !$this->settings['imageDimensions'])) continue;
            if ($in_picture>0 || $image_attribute_dependency) { $this->skip('images','responsive_or_css_owned');continue; }
            // Existing responsive candidates, loaders and event handlers own the
            // image lifecycle. Do not replace their URLs or dimensional policy.
            $owned=false;
            foreach(array_keys($token['attrs']) as $attr) if(str_starts_with($attr,'on') || str_starts_with($attr,'data-') || in_array($attr,['srcset','sizes','usemap','ismap'],true)){$owned=true;break;}
            if($owned){$this->skip('images','authored_loader');continue;}
            $src=self::attribute($token,'src');
            if(!is_string($src) || str_contains($src,'?') || str_contains($src,'#')){$this->skip('images','external_or_versioned');continue;}
            $local=$this->local_path($src,$path);
            if(!$local){$this->skip('images','external_or_missing');continue;}
            $image=$this->image($local);
            if(!$image)continue;
            $attributes=[];
            if($image['url']!==null)$attributes['src']=$image['url'];
            if($this->settings['imageDimensions'] && !isset($token['attrs']['width']) && !isset($token['attrs']['height'])) {
                $attributes['width']=(string)$image['width'];$attributes['height']=(string)$image['height'];
                $this->applied('imageDimensions');
            }
            if(!$attributes)continue;
            $tag=$token['tag'];
            foreach($attributes as $key=>$value){$current=$token;$current['tag']=$tag;$current['attrs']=self::attributes($tag)??[];$tag=self::set_attribute($current,$key,$value);}
            $patches[]=[$token['offset'],$token['length'],$tag];
        }
        if($head_end!==null) {
            if($this->settings['preloadFonts']) foreach($this->font_hints($styles,$path) as $href=>$attributes)$hints[$href]=['feature'=>'preloadFonts','attributes'=>$attributes];
            if($this->settings['preconnect']) foreach(array_slice(array_keys($origins),0,2) as $origin)$hints[$origin]=['feature'=>'preconnect','attributes'=>['rel'=>'preconnect','href'=>$origin]];
            $markup='';
            foreach($hints as $href=>$hint){
                $hint_key=$this->hint_key($href,$path);
                if(isset($existing[$hint_key])){$this->skip($hint['feature'],'already_authored');continue;}
                $existing[$hint_key]=true;
                $markup.='<link';
                foreach($hint['attributes'] as $key=>$value)$markup.=' '.$key.'="'.htmlspecialchars((string)$value,ENT_QUOTES|ENT_HTML5,'UTF-8').'"';
                $markup.=' data-kodety-optimization="'.$hint['feature'].'">';
                $this->applied($hint['feature']);
                if($hint['feature']==='preloadFonts')$this->report['fonts']++;
                if($hint['feature']==='preloadModules')$this->report['scripts']++;
            }
            if($markup!=='')$patches[]=[$head_end,0,$markup];
        }
        if (count($origins)>0) $this->finding('external_critical_resources',substr($path,strlen($this->root)+1),'Esta página depende de recursos externos. O tempo de resposta e o código desses serviços precisam ser avaliados no site publicado.');
        usort($patches,static fn($a,$b)=>$b[0]<=>$a[0]);
        foreach($patches as [$offset,$length,$replacement])$html=substr_replace($html,$replacement,$offset,$length);
        return $html;
    }

    private function hint_origin(string $url, array &$origins): void {
        if(!str_starts_with(strtolower($url),'https://'))return;
        $parts=parse_url($url);
        if(!$parts || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']))return;
        $host=strtolower($parts['host']);
        if(!preg_match('~^[a-z0-9.-]+$~',$host))return;
        $port=isset($parts['port'])?':'.(int)$parts['port']:'';
        $origins['https://'.$host.$port]=true;
    }

    /** Read top-level CSS rules only; conditional/dynamic font choices are skipped. */
    private static function css_rules(string $css): array {
        $rules=[];$start=0;$body_start=null;$depth=0;$quote=null;$paren=0;$length=strlen($css);
        for($i=0;$i<$length;$i++){
            $char=$css[$i];
            if($quote!==null){if($char==='\\'){$i++;continue;}if($char===$quote)$quote=null;continue;}
            if($char==='"'||$char==="'"){$quote=$char;continue;}
            if($char==='/'&&($css[$i+1]??'')==='*'){$end=strpos($css,'*/',$i+2);if($end===false)return[];if($depth===0 && trim(substr($css,$start,$i-$start))==='')$start=$end+2;$i=$end+1;continue;}
            if($char==='\\'){$i++;continue;}
            if($char==='('){$paren++;continue;}if($char===')'){$paren--;if($paren<0)return[];continue;}
            if($paren>0)continue;
            if($char==='{'){if($depth===0)$body_start=$i+1;$depth++;}
            elseif($char==='}'){
                if(--$depth<0)return[];
                if($depth===0 && $body_start!==null){$rules[]=[trim(substr($css,$start,$body_start-$start-1)),substr($css,$body_start,$i-$body_start)];$start=$i+1;$body_start=null;}
            }elseif($char===';'&&$depth===0)$start=$i+1;
        }
        return($depth!==0||$quote!==null||$paren!==0)?[]:$rules;
    }

    /** Split declarations at real separators, never at semicolons in strings. */
    private static function css_declarations(string $body): array {
        $segments=[];$start=0;$quote=null;$paren=0;$length=strlen($body);
        for($i=0;$i<$length;$i++) {
            $char=$body[$i];
            if($quote!==null){if($char==='\\'){$i++;continue;}if($char===$quote)$quote=null;continue;}
            if($char==='"'||$char==="'"){$quote=$char;continue;}
            if($char==='(')$paren++;
            elseif($char===')'){if(--$paren<0)return[];}
            elseif($char===';'&&$paren===0){$segments[]=substr($body,$start,$i-$start);$start=$i+1;}
        }
        if($quote!==null||$paren!==0)return[];
        $segments[]=substr($body,$start);$declarations=[];
        foreach($segments as $segment) {
            if(trim($segment)==='')continue;
            if(!preg_match('~^\s*([a-z-]+)\s*:\s*(.*?)\s*$~isD',$segment,$match))return[];
            $key=strtolower($match[1]);if(isset($declarations[$key]))return[];
            $declarations[$key]=$match[2];
        }
        return $declarations;
    }

    private function font_hints(array $styles, string $html_path): array {
        $faces=[];$body_family=null;
        foreach($styles as [$css,$owner])foreach(self::css_rules($css) as [$selector,$body]){
            // Keep CSS comments, escapes, custom properties and nested rules out
            // of inference; they remain completely untouched in the source.
            if(str_contains($body,'/*')||str_contains($body,'\\')||str_contains($body,'{')||str_contains($body,'var('))continue;
            $declarations=self::css_declarations($body);
            if(isset($declarations['font']) || !preg_match('~^(["\']?)([a-zA-Z0-9 _-]+)\1\s*(?:,|$)~i',$declarations['font-family']??'',$family))continue;
            $family_name=strtolower(trim($family[2]));
            if(in_array(strtolower($selector),['body','html','html, body','html,body'],true))$body_family=$family_name;
            if(strtolower($selector)!=='@font-face')continue;
            if(strtolower($declarations['font-style']??'normal')!=='normal' || isset($declarations['unicode-range']))continue;
            if(!in_array($declarations['font-weight']??'normal',['normal','400','100 900'],true))continue;
            if(!preg_match('~^url\(\s*(["\']?)([^"\'()\s]+[.]woff2(?:[?#][^"\'()\s]*)?)\1\s*\)(?:\s+format\(["\']woff2["\']\))?\s*$~iD',$declarations['src']??'',$source))continue;
            $file=$this->local_path($source[2],$owner);
            if(!$file||filesize($file)>256*1024||file_get_contents($file,false,null,0,4)!=='wOF2')continue;
            $relative=substr($file,strlen($this->root)+1);
            if($this->web_root!==''&&!str_starts_with($relative,$this->web_root.'/'))continue;
            if($this->web_root!=='')$relative=substr($relative,strlen($this->web_root)+1);
            $suffix=substr($source[2],strcspn($source[2],'?#'));
            $faces[$family_name][]='/'.$relative.$suffix;
        }
        if($body_family===null||count($faces[$body_family]??[])!==1){$this->skip('preloadFonts','font_use_not_proven');return[];}
        $href=$faces[$body_family][0];
        return[$href=>['rel'=>'preload','as'=>'font','href'=>$href,'type'=>'font/woff2','crossorigin'=>'anonymous']];
    }

    /** First/duplicate attributes must never be confused by a rewrite. */
    private static function attributes(string $tag): ?array {
        if (!preg_match('~^</?[a-zA-Z][a-zA-Z0-9:-]*~', $tag, $name)) return null;
        $cursor = strlen($name[0]);
        $attrs = [];
        $length = strlen($tag);
        while ($cursor < $length) {
            if (preg_match('~\G[\x20\t\r\n\f]*\/?>(?:$)~', $tag, $end, 0, $cursor)) return $attrs;
            if (!preg_match('~\G[\x20\t\r\n\f]+([^\x20\t\r\n\f/=>"\'`<]+)(?:[\x20\t\r\n\f]*=[\x20\t\r\n\f]*(?:"([^"]*)"|\'([^\']*)\'|([^\x20\t\r\n\f>"\'`=<]+)))?~', $tag, $match, PREG_OFFSET_CAPTURE | PREG_UNMATCHED_AS_NULL, $cursor)) return null;
            $key = strtolower($match[1][0]);
            if (array_key_exists($key, $attrs)) return null;
            $value = true;
            foreach ([2,3,4] as $index) if ($match[$index][0] !== null) { $value = html_entity_decode($match[$index][0], ENT_QUOTES | ENT_HTML5, 'UTF-8'); break; }
            $attrs[$key] = ['value'=>$value, 'offset'=>$match[1][1], 'length'=>strlen($match[0][0]) - ($match[1][1] - $cursor)];
            $cursor += strlen($match[0][0]);
        }
        return null;
    }

    private static function attribute(array $token, string $name): mixed {
        return $token['attrs'][$name]['value'] ?? null;
    }

    private static function set_attribute(array $token, string $name, string $value): string {
        $attribute = $name . '="' . htmlspecialchars($value, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '"';
        $existing = $token['attrs'][$name] ?? null;
        if ($existing) return substr_replace($token['tag'], $attribute, $existing['offset'], $existing['length']);
        $offset = strlen($token['tag']) - (str_ends_with($token['tag'], '/>') ? 2 : 1);
        return substr_replace($token['tag'], ' ' . $attribute, $offset, 0);
    }
}
