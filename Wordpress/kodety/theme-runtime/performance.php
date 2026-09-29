<?php
/** Transfer-only delivery helpers for an immutable Onun Kodety release. */
defined('ABSPATH') || exit;

function kodety_performance_accepts_gzip(string $accept_encoding): bool {
    $gzip=null;$wildcard=null;
    foreach (explode(',',strtolower($accept_encoding)) as $entry) {
        $parts=array_map('trim',explode(';',$entry));$coding=array_shift($parts);$quality=1.0;$quality_seen=false;
        foreach($parts as $parameter) {
            if(!str_starts_with($parameter,'q='))continue;
            if($quality_seen){$quality=0;break;}$quality_seen=true;
            $q=substr($parameter,2);
            if(!preg_match('/^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/D',$q))$quality=0;
            else $quality=(float)$q;
        }
        if($coding==='gzip')$gzip=$gzip===null?$quality:min($gzip,$quality);
        if($coding==='*')$wildcard=$wildcard===null?$quality:min($wildcard,$quality);
    }
    return ($gzip ?? $wildcard ?? 0)>0;
}

/** Returns encoded bytes only after checking ownership of the delivery layer. */
function kodety_compressed_html_bytes(string $html, string $runtime_directory, bool $owns_buffer = false): ?string {
    if(strlen($html)<1024 || strlen($html)>16*1024*1024 || !function_exists('gzencode') || headers_sent())return null;
    if(($_SERVER['REQUEST_METHOD']??'GET')!=='GET' || !kodety_performance_accepts_gzip((string)($_SERVER['HTTP_ACCEPT_ENCODING']??'')))return null;
    if(function_exists('is_user_logged_in') && is_user_logged_in())return null;
    $zlib_setting=strtolower(trim((string)ini_get('zlib.output_compression')));
    if(!in_array($zlib_setting,['','0','off','false'],true))return null;
    $limit=trim((string)ini_get('memory_limit'));
    $limit_bytes=(int)$limit * match(strtolower(substr($limit,-1))){'g'=>1024**3,'m'=>1024**2,'k'=>1024,default=>1};
    if($limit_bytes>0 && memory_get_usage(true)+strlen($html)*3+8*1024*1024>=$limit_bytes)return null;
    foreach(ob_list_handlers() as $handler)if(strtolower($handler)!=='default output handler' && !($owns_buffer && $handler===Kodety_Public_HTML_Compression::class.'::finish'))return null;
    foreach(headers_list() as $header){
        if(stripos($header,'Content-Encoding:')===0)return null;
        if(stripos($header,'Content-Type:')===0 && stripos($header,'text/html')===false)return null;
    }
    $path=rtrim($runtime_directory,'/\\').'/performance-config.json';
    if(!is_file($path) || filesize($path)>1024)return null;
    $config=json_decode((string)file_get_contents($path),true);
    if(!is_array($config) || ($config['version']??null)!==2 || ($config['enabled']??false)!==true || ($config['compressHtml']??false)!==true)return null;
    $compressed=gzencode($html,6);
    if(!is_string($compressed) || strlen($compressed)>=strlen($html))return null;
    header_remove('Content-Length');
    header('Vary: Accept-Encoding',false);
    header('Content-Encoding: gzip');
    return $compressed;
}

/** An outer bounded buffer lets WordPress and plugins finish processing HTML
 * before encoding it. Unknown pre-existing output handlers retain ownership.
 * Early flushes and large streaming pages pass through without compression. */
final class Kodety_Public_HTML_Compression {
    private static ?string $directory = null;
    private static bool $streamed = false;
    public static bool $rendered = false;

    public static function start(string $template): string {
        if(self::$directory!==null || headers_sent() || is_user_logged_in() || ($_SERVER['REQUEST_METHOD']??'GET')!=='GET')return $template;
        $directory=kodety_runtime_directory();
        if(realpath($template)!==realpath($directory.'/index.php'))return $template;
        foreach(ob_list_handlers() as $handler)if(strtolower($handler)!=='default output handler')return $template;
        $path=$directory.'/performance-config.json';
        if(!is_file($path)||filesize($path)>1024)return $template;
        $config=json_decode((string)file_get_contents($path),true);
        if(($config['version']??null)!==2||($config['enabled']??false)!==true||($config['compressHtml']??false)!==true)return $template;
        header('Vary: Accept-Encoding',false);
        if(!kodety_performance_accepts_gzip((string)($_SERVER['HTTP_ACCEPT_ENCODING']??'')))return $template;
        if(ob_start([self::class,'finish'],1024*1024))self::$directory=$directory;
        return $template;
    }

    public static function finish(string $output, int $phase): string {
        if(!($phase & PHP_OUTPUT_HANDLER_FINAL) || ($phase & PHP_OUTPUT_HANDLER_CLEAN))self::$streamed=true;
        if(self::$streamed || !self::$rendered || self::$directory===null || !did_action('shutdown'))return $output;
        return kodety_compressed_html_bytes($output,self::$directory,true) ?? $output;
    }

    public static function active(): bool { return self::$directory!==null; }
}

/** Legacy templates without an outer processing pipeline may send directly. */
function kodety_output_compressed_html(string $html, string $runtime_directory): bool {
    Kodety_Public_HTML_Compression::$rendered=true;
    if(Kodety_Public_HTML_Compression::active())return false;
    $compressed=kodety_compressed_html_bytes($html,$runtime_directory);
    if($compressed===null)return false;
    echo $compressed;
    return true;
}
