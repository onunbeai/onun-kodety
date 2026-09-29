<?php

define('ABSPATH', __DIR__ . '/');
require dirname(__DIR__) . '/kodety/includes/class-kodety-publication-optimizer.php';
$checks = 0;
function optimization_v2_assert(bool $condition, string $message): void {
    global $checks;
    $checks++;
    if (!$condition) throw new RuntimeException($message);
}
$settings = Kodety_Publication_Optimizer::defaults();
optimization_v2_assert($settings['version'] === 2 && $settings['enabled'], 'New installations receive the versioned configuration.');
$disabled = Kodety_Publication_Optimizer::from_saved(['minifyHtml'=>true,'deferScripts'=>true]);
optimization_v2_assert(!$disabled['enabled'] && !isset($disabled['deferScripts']), 'Legacy switches cannot reactivate unsafe transformations.');
foreach ([null, [], ['minifyHtml'=>false,'deferScripts'=>false]] as $legacyPreferences) {
    optimization_v2_assert(Kodety_Publication_Optimizer::from_preferences($legacyPreferences) === $settings, 'Missing and unversioned preferences adopt enabled v2 defaults.');
}
$optOut = array_replace($settings, ['enabled'=>false, 'optimizeImages'=>false, 'exclusions'=>['assets/vendor/*']]);
optimization_v2_assert(Kodety_Publication_Optimizer::from_preferences($optOut) === $optOut, 'Explicit saved v2 opt-outs and exclusions survive default adoption.');
optimization_v2_assert(!Kodety_Publication_Optimizer::from_preferences(['version'=>2, 'enabled'=>'invalid'])['enabled'], 'Malformed v2 choices must not silently enable transformations.');
foreach (array_keys(Kodety_Publication_Optimizer::options()) as $key) {
    $candidate=$settings;$candidate[$key]=false;
    optimization_v2_assert(Kodety_Publication_Optimizer::normalize($candidate)[$key] === false, 'Each preference remains independently disabled: '.$key);
}
foreach ([['version'=>1], array_replace($settings,['enabled'=>'false']), array_replace($settings,['exclusions'=>['../private']]), array_replace($settings,['exclusions'=>[true]])] as $invalid) {
    $rejected=false;
    try { Kodety_Publication_Optimizer::normalize($invalid); } catch (InvalidArgumentException) { $rejected=true; }
    optimization_v2_assert($rejected, 'Invalid configuration must fail explicitly.');
}
$excluded=Kodety_Publication_Optimizer::normalize(array_replace($settings,['exclusions'=>['/assets/private/*','*.signed.js','assets/private/*']]));
optimization_v2_assert(count($excluded['exclusions'])===2 && Kodety_Publication_Optimizer::excluded('assets/private/file.png',$excluded), 'Exclusions are normalized and match project paths.');
optimization_v2_assert(!Kodety_Publication_Optimizer::excluded('assets/public/file.png',$excluded), 'Unrelated paths remain eligible.');
optimization_v2_assert(Kodety_Publication_Optimizer::revision($settings)!==Kodety_Publication_Optimizer::revision($disabled), 'Revision changes when preferences change.');

$source=<<<'HTML'
<!doctype html><html><head>
<style>.hero::after{content:"<img src='fake.png'>"} [style*="width: 90vw"] { --label: "a  b"; }</style>
<script>const markup = `<img src="fake.png">`; window.x = "ação &amp; café";</script>
<!-- <img src="comment.png"> -->
<!-- kodety-custom-code:start head --><img src="custom.png"><script src="custom.js"></script><!-- kodety-custom-code:end head -->
</head><body><span>Iniciar</span> <span>um projeto</span>
<template><template></template><img src="template.png"></template>
<svg><foreignObject><img src="foreign.png"></foreignObject></svg>
<textarea><img src="textarea.png"></textarea><noscript><img src="noscript.png"></noscript>
<img alt="a > b &amp; c" src='assets/real.png' width=640 height=480>
<!--$--><p>Framework</p><!--/$--></body></html>
HTML;
$tokens=Kodety_Publication_Optimizer::tokens($source);
optimization_v2_assert(is_array($tokens), 'Complete document can be inspected without serialization.');
$images=array_values(array_filter($tokens,fn($token)=>$token['name']==='img'));
optimization_v2_assert(count($images)===1 && $images[0]['attrs']['src']['value']==='assets/real.png', 'Only the active image is eligible; inert and authored custom content stay opaque.');
optimization_v2_assert($images[0]['attrs']['alt']['value']==='a > b & c', 'Quoted delimiters and entities are parsed correctly.');
foreach ($tokens as $token) optimization_v2_assert(substr($source,$token['offset'],$token['length'])===$token['tag'], 'Every token span addresses the original bytes.');
$method=(new ReflectionClass(Kodety_Publication_Optimizer::class))->getMethod('set_attribute');
$updated=$method->invoke(null,$images[0],'src','assets/real.webp?x=1&y=2');
optimization_v2_assert($updated==='<img alt="a > b &amp; c" src="assets/real.webp?x=1&amp;y=2" width=640 height=480>', 'Attribute replacement leaves unrelated spacing, attributes and text intact.');
$modified=substr_replace($source,$updated,$images[0]['offset'],$images[0]['length']);
optimization_v2_assert(str_replace($updated,$images[0]['tag'],$modified)===$source,'Undoing the one selected patch restores every authored byte.');
foreach (['<img src="unfinished>', '<img src=a src=b>', '<template/><img src="inert.png">', '<svg><img src=x>', '<!-- unclosed', '<!DOCTYPE html PUBLIC "<img src=x>">', '<script><!--<script></script><img src=x></script>', '<!-- kodety-custom-code:start x --><img src=x>'] as $ambiguous) {
    optimization_v2_assert(Kodety_Publication_Optimizer::tokens($ambiguous)===null,'Ambiguous or incomplete HTML must pass through: '.$ambiguous);
}
$no_script=Kodety_Publication_Optimizer::tokens('<p>hello < 3</p><img src="actual.png"/>');
optimization_v2_assert(is_array($no_script) && count(array_filter($no_script,fn($token)=>$token['name']==='img'))===1,'Literal less-than text does not swallow the next real tag.');
echo "Publication optimizer v2 foundation passed ($checks checks).\n";

$temporary=sys_get_temp_dir().'/kodety-optimizer-v2-'.bin2hex(random_bytes(6));
mkdir($temporary.'/assets',0755,true);
$project_html=<<<'HTML'
<!doctype html><html><head><link rel="stylesheet" href="assets/site.css"><script type="module" src="assets/app.mjs"></script></head><body><span>A</span> <span>B</span><!-- authored --><img src="assets/photo.png" alt="Photo"><img src="https://example.test/signed.png?sig=secret"><img src="assets/photo.png" srcset="assets/photo.png 1x"><script>window.__authored = " <img> &amp; café ";</script></body></html>
HTML;
$project_css='@font-face {font-family:"Visual Sans";src:url("visual.woff2") format("woff2");font-style:normal;font-weight:400;} body{font-family:"Visual Sans",sans-serif} .title:after{content:"a  b"} '.str_repeat('.repeated { display: block; padding: 4px 8px; } ',100);
$project_js='export const authored = "a  b"; // spaces and comments\n'.str_repeat('/* preserved */',200);
file_put_contents($temporary.'/index.html',$project_html);
file_put_contents($temporary.'/assets/site.css',$project_css);
file_put_contents($temporary.'/assets/app.mjs',$project_js);
file_put_contents($temporary.'/assets/visual.woff2','wOF2'.str_repeat('x',100));
$png=imagecreatetruecolor(640,480);imagefill($png,0,0,imagecolorallocate($png,36,50,62));imagepng($png,$temporary.'/assets/photo.png');imagedestroy($png);
$original_image=file_get_contents($temporary.'/assets/photo.png');
$run=new Kodety_Publication_Optimizer();
$report=$run->run($temporary,$settings,'test-release');
$optimized=file_get_contents($temporary.'/index.html');
optimization_v2_assert(file_get_contents($temporary.'/assets/site.css')===$project_css && file_get_contents($temporary.'/assets/app.mjs')===$project_js,'CSS/JS originals are never minified or reordered.');
optimization_v2_assert(gzdecode(file_get_contents($temporary.'/assets/site.css.gz'))===$project_css && gzdecode(file_get_contents($temporary.'/assets/app.mjs.gz'))===$project_js,'Every generated compressed asset round-trips to its original bytes.');
optimization_v2_assert(file_get_contents($temporary.'/assets/photo.png')===$original_image,'The original image survives optimization.');
optimization_v2_assert(str_contains($optimized,'width="640" height="480"') && !str_contains($optimized,'loading="lazy"'),'Dimensions reserve known image space without delaying the LCP image.');
optimization_v2_assert(str_contains($optimized,'<img src="https://example.test/signed.png?sig=secret">') && str_contains($optimized,'<img src="assets/photo.png" srcset="assets/photo.png 1x">'),'Remote/signed and responsive sources remain unchanged.');
optimization_v2_assert(str_contains($optimized,'<span>A</span> <span>B</span><!-- authored -->') && str_contains($optimized,'<script>window.__authored = " <img> &amp; café ";</script>'),'Semantic text and authored inline script bytes survive enabled optimization.');
optimization_v2_assert(str_contains($optimized,'rel="modulepreload" href="assets/app.mjs"') && str_contains($optimized,'<script type="module" src="assets/app.mjs"></script>'),'Module hints do not alter the script node or execution mode.');
optimization_v2_assert(str_contains($optimized,'as="font" href="/assets/visual.woff2"') && ($report['fonts']??0)===1,'Only the explicitly used body font is preloaded.');
optimization_v2_assert(($report['compressionBytesSaved']??0)>0 && ($report['applied']['imageDimensions']??0)===1,'Report distinguishes transfer savings and dimensional changes.');
if(defined('IMG_WEBP_LOSSLESS')) optimization_v2_assert(($report['images']??0)===1 && ($report['bytesSaved']??0)>0,'A smaller valid lossless PNG derivative is used.');
$run->run($temporary,$settings,'test-release');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$optimized,'Repeated optimization does not accumulate attributes or hints.');
file_put_contents($temporary.'/index.html',$project_html);
$off=$settings;$off['enabled']=false;
$off_report=$run->run($temporary,$off,'disabled');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$project_html && $off_report['applied']===[],'The master control performs no content transforms.');
$excluded_settings=$settings;$excluded_settings['exclusions']=['index.html','assets/*'];
$excluded_report=$run->run($temporary,$excluded_settings,'excluded');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$project_html && $excluded_report['applied']===[],'Page and asset exclusions bypass transformation.');

// HTML/CSS ownership and inference regressions use the same valid local image.
$image_only=$settings;
foreach(array_keys(Kodety_Publication_Optimizer::options()) as $key)$image_only[$key]=in_array($key,['optimizeImages','imageDimensions'],true);
foreach([
    '<picture><source srcset="assets/photo.png"><img src="assets/photo.png"></picture>',
    '<img src="assets/photo.png" onload="ready(this)">',
    '<img src="assets/photo.png" data-loader="custom">',
    '<style>img[width]{display:none}</style><img src="assets/photo.png">',
    '<div data-reactroot><img src="assets/photo.png"></div>',
    '<template><img src="assets/photo.png"></template>',
] as $owned) {
    $owned_html='<!doctype html><html><head></head><body>'.$owned.'</body></html>';
    file_put_contents($temporary.'/index.html',$owned_html);$run->run($temporary,$image_only,'owned');
    optimization_v2_assert(file_get_contents($temporary.'/index.html')===$owned_html,'Image ownership remains unchanged: '.$owned);
}
$jpeg=imagecreatetruecolor(40,80);imagejpeg($jpeg,$temporary.'/assets/rotated.jpg');imagedestroy($jpeg);
$jpeg_bytes=file_get_contents($temporary.'/assets/rotated.jpg');
$exif="Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
file_put_contents($temporary.'/assets/rotated.jpg',substr($jpeg_bytes,0,2)."\xff\xe1".pack('n',strlen($exif)+2).$exif.substr($jpeg_bytes,2));
$rotated='<html><head></head><body><img src="assets/rotated.jpg"></body></html>';
file_put_contents($temporary.'/index.html',$rotated);$image_only['optimizeImages']=false;
$rotated_report=$run->run($temporary,$image_only,'orientation');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$rotated && isset($rotated_report['skipped']['images:orientation_unknown_or_rotated']),'Dimensions-only respects EXIF rotation too.');

$hint_html='<html><head><link rel="modulepreload" href="/assets/app.mjs"><link rel="preload" as="font" href="assets/visual.woff2"><link rel="stylesheet" href="assets/site.css"><script type="module" src="assets/app.mjs"></script></head><body></body></html>';
file_put_contents($temporary.'/index.html',$hint_html);$hint_report=$run->run($temporary,$settings,'hints');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$hint_html && empty($hint_report['applied']['preloadModules']) && empty($hint_report['applied']['preloadFonts']),'Equivalent root-relative and relative authored hints are deduplicated.');
$mapped='<html><head></head><body><script type="importmap">{"imports":{"app":"./assets/app.mjs"}}</script><script type="module" src="assets/app.mjs"></script></body></html>';
file_put_contents($temporary.'/index.html',$mapped);$mapped_report=$run->run($temporary,$settings,'mapped');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$mapped && empty($mapped_report['scripts']),'A body import map is not bypassed by an earlier module preload.');
$csp='<html><head><meta http-equiv="Content-Security-Policy" content="img-src /assets/"></head><body><img src="assets/photo.png"></body></html>';
file_put_contents($temporary.'/index.html',$csp);$run->run($temporary,$settings,'csp');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$csp,'An authored CSP keeps control of resource URLs.');
file_put_contents($temporary.'/assets/site.css','@font-face{font-family:"Visual Sans";src:url("visual.woff2")} body{content:"fake; font-family:Visual Sans;";font-family:system-ui}');
$fake_font='<html><head><link rel="stylesheet" href="assets/site.css"></head><body>Safe</body></html>';
file_put_contents($temporary.'/index.html',$fake_font);$fake_report=$run->run($temporary,$settings,'font-strings');
optimization_v2_assert(file_get_contents($temporary.'/index.html')===$fake_font && empty($fake_report['fonts']),'CSS string content cannot impersonate a font declaration.');

foreach(array_keys(Kodety_Publication_Optimizer::options()) as $disabled_key) {
    $individual=$settings;$individual[$disabled_key]=false;
    file_put_contents($temporary.'/index.html',$project_html);
    $individual_report=$run->run($temporary,$individual,'individual');
    optimization_v2_assert(empty($individual_report['applied'][$disabled_key]),'No artifact can be attributed to a disabled feature: '.$disabled_key);
}
file_put_contents($temporary.'/assets/large.js',str_repeat('/* large local code */',14000));
file_put_contents($temporary.'/index.html','<html><head><script src="https://example.test/runtime.js"></script></head><body>External</body></html>');
$findings=$run->run($temporary,$settings,'findings')['findings'];
optimization_v2_assert(in_array('large_code_asset',array_column($findings,'code'),true) && in_array('external_critical_resources',array_column($findings,'code'),true),'Report identifies code weight and external dependencies without editing their behavior.');
$iterator=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($temporary,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
foreach($iterator as $file){if($file->isDir())rmdir($file->getPathname());else unlink($file->getPathname());}rmdir($temporary);
echo "Publication optimizer v2 artifact checks passed ($checks checks).\n";
