<?php
declare(strict_types=1);
define('ABSPATH', __DIR__.'/');
require dirname(__DIR__).'/kodety/theme-runtime/performance.php';
$checks=0;$logged_in=false;
function is_user_logged_in(): bool { return $GLOBALS['logged_in']; }
function delivery_assert(bool $condition,string $message): void { $GLOBALS['checks']++;if(!$condition)throw new RuntimeException($message); }
foreach([
    ''=>false,'br'=>false,'gzip'=>true,'gzip;q=0'=>false,'gzip;q=0.2'=>true,
    '*;q=1'=>true,'*;q=1, gzip;q=0'=>false,'gzip;q=1, gzip;q=0'=>false,
    'gzip;q=0;q=1'=>false,
    'GZIP;Q=0.8, br'=>true,'gzip;q=2'=>false,'gzip;q=bogus'=>false,
    'gzip;q=0.000'=>false,'identity;q=1, br;q=1, gzip;q=0.5'=>true,
] as $header=>$expected)delivery_assert(kodety_performance_accepts_gzip($header)===$expected,'Encoding negotiation: '.$header);
$directory=sys_get_temp_dir().'/kodety-performance-delivery-'.bin2hex(random_bytes(5));mkdir($directory);
$html='<!doctype html><html><body>'.str_repeat('<span>A</span> <span>B</span><!-- authored -->',500).'</body></html>';
$_SERVER['REQUEST_METHOD']='GET';$_SERVER['HTTP_ACCEPT_ENCODING']='gzip';
$config=['version'=>2,'enabled'=>true,'compressHtml'=>true];
$capture=static function()use($html,$directory):array{ob_start();$sent=kodety_output_compressed_html($html,$directory);$output=ob_get_clean();return[$sent,$output];};
try {
    file_put_contents($directory.'/performance-config.json',json_encode($config));
    [$sent,$output]=$capture();delivery_assert($sent && gzdecode($output)===$html,'Transfer compression restores all original HTML bytes.');
    foreach(['enabled','compressHtml'] as $key){$off=$config;$off[$key]=false;file_put_contents($directory.'/performance-config.json',json_encode($off));[$sent,$output]=$capture();delivery_assert(!$sent&&$output==='','Disabled delivery emits nothing: '.$key);}
    file_put_contents($directory.'/performance-config.json',json_encode($config));
    $_SERVER['HTTP_ACCEPT_ENCODING']='gzip;q=0';[$sent,$output]=$capture();delivery_assert(!$sent&&$output==='','Explicit gzip refusal remains uncompressed.');
    $_SERVER['HTTP_ACCEPT_ENCODING']='gzip';$logged_in=true;[$sent,$output]=$capture();delivery_assert(!$sent&&$output==='','Authenticated responses are left to the existing server pipeline.');$logged_in=false;
    $_SERVER['REQUEST_METHOD']='POST';[$sent,$output]=$capture();delivery_assert(!$sent&&$output==='','Non-GET response is unchanged.');$_SERVER['REQUEST_METHOD']='GET';
    ob_start(static fn($text)=>$text);$sent=kodety_output_compressed_html($html,$directory);$output=ob_get_clean();delivery_assert(!$sent&&$output==='','An existing output handler retains ownership.');
    file_put_contents($directory.'/performance-config.json','{"version":2,"enabled":"true","compressHtml":true}');[$sent,$output]=$capture();delivery_assert(!$sent&&$output==='','Malformed persisted configuration fails closed.');
    file_put_contents($directory.'/performance-config.json',json_encode($config));
    file_put_contents($directory.'/index.php','<?php');
    $worker=<<<'PHP'
<?php
define('ABSPATH',__DIR__.'/');
require $argv[1];
$mode=$argv[2];$shutdown=false;
function is_user_logged_in(): bool { return false; }
function kodety_runtime_directory(): string { return __DIR__; }
function did_action(string $name): int { return $name==='shutdown' && $GLOBALS['shutdown'] ? 1 : 0; }
$_SERVER['REQUEST_METHOD']='GET';$_SERVER['HTTP_ACCEPT_ENCODING']='gzip';
if($mode==='foreign')ob_start(static fn($html)=>$html);
Kodety_Public_HTML_Compression::start(__DIR__.'/index.php');
// Represents WordPress processing the template inside our transfer buffer.
ob_start(static fn($html)=>str_replace('Before','After',$html));
$html='<html><body>'.str_repeat('Before ', $mode==='large'?200000:500).'</body></html>';
if(!kodety_output_compressed_html($html,__DIR__))echo $html;
ob_end_flush();
$shutdown=$mode!=='early';
while(ob_get_level()>0)ob_end_flush();
PHP;
    file_put_contents($directory.'/worker.php',$worker);
    foreach(['normal','early','large','foreign'] as $mode) {
        $process=proc_open([PHP_BINARY,$directory.'/worker.php',realpath(dirname(__DIR__).'/kodety/theme-runtime/performance.php'),$mode],[1=>['pipe','w'],2=>['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Unable to start output pipeline fixture.');
        $output=stream_get_contents($pipes[1]);$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$exit=proc_close($process);
        delivery_assert($exit===0 && $errors==='','Output pipeline completes without warnings: '.$mode);
        $expected='<html><body>'.str_repeat('After ',$mode==='large'?200000:500).'</body></html>';
        delivery_assert(($mode==='normal'?gzdecode($output):$output)===$expected,'Compression follows template processing; early, large and foreign-owned output stays plain: '.$mode);
    }
} finally { foreach(['performance-config.json','index.php','worker.php'] as $file)if(is_file($directory.'/'.$file))unlink($directory.'/'.$file);rmdir($directory); }
echo "Performance delivery passed ($checks checks).\n";
