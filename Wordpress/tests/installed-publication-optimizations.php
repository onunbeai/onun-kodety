<?php
/** Run with wp --path=<fresh disposable fixture> --user=1 eval-file <this file>. */
if (!defined('WP_CLI') || !WP_CLI) { http_response_code(404); exit; }
if (!str_starts_with(basename(rtrim(ABSPATH,'/')), 'kodety-optimizations-wp-')
    || !str_starts_with(DB_NAME,'kodety_optimizations_')
    || wp_parse_url(home_url(),PHP_URL_HOST)!=='127.0.0.1'
    || ((string)get_option('kodety_current_release','')!=='' && (string)get_option('kodety_workspace_project_id','')!=='optimization-disposable-project')) throw new RuntimeException('A fresh or test-owned isolated optimization fixture is required.');
$GLOBALS['optimization_installed_checks']=[];
function installed_optimization_assert(bool $condition,string $message): void {
    if(!$condition)throw new RuntimeException($message);
    $GLOBALS['optimization_installed_checks'][]=$message;
}
function installed_optimization_request(array $payload): WP_REST_Response {
    $request=new WP_REST_Request('POST','/kodety/v1/optimizations');
    $request->set_header('Content-Type','application/json');$request->set_body(wp_json_encode($payload));
    return rest_do_request($request);
}
function installed_optimization_files(string $root): array {
    $hashes=[];$iterator=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS));
    foreach($iterator as $file)if($file->isFile())$hashes[substr($file->getPathname(),strlen($root)+1)]=hash_file('sha256',$file->getPathname());
    ksort($hashes);return $hashes;
}
wp_set_current_user(1);
update_option('kodety_onboarding_status','complete',false);
update_option('kodety_admin_ui_locale','pt-BR',false);
$plugin=Kodety_Plugin::instance();
installed_optimization_assert($plugin->can_publish(),'Fixture administrator may publish.');
$settings=Kodety_Publication_Optimizer::defaults();
$source=ABSPATH.'optimization-test-source';wp_mkdir_p($source.'/assets');wp_mkdir_p($source.'/.incode');
$project=['version'=>1,'projectId'=>'optimization-disposable-project','name'=>'Otimizações — teste isolado','mainHtmlPath'=>'index.html','homeHtmlPath'=>'index.html','rootPath'=>'','breakpointSchemaVersion'=>2,'primaryBreakpoint'=>['id'=>'base','label'=>'Primary','mode'=>'max-width','width'=>1440],'breakpoints'=>[['id'=>'mobile','label'=>'Mobile','mode'=>'max-width','width'=>480]]];
file_put_contents($source.'/.incode/project.json',wp_json_encode($project));
$html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publicação de teste</title><link rel="stylesheet" href="assets/site.css"><script type="module" src="assets/app.mjs"></script></head><body><main><p class="eyebrow">PUBLICAÇÃO DE TESTE</p><h1>Projeto publicado original</h1><p><span>Texto</span> <span>preservado</span></p><img src="assets/photo.png" alt="Imagem local de teste"><button type="button" id="counter">Clique para testar: 0</button><p id="result" role="status">Pronto</p>'.str_repeat('<!-- Authored whitespace and comments preserved -->',100).'</main></body></html>';
$css='body{margin:0;background:#161616;color:#f5f5f5;font:16px system-ui}main{max-width:900px;margin:auto;padding:64px 24px}.eyebrow{font-size:12px;color:#aaa;letter-spacing:.15em}h1{font-size:42px;letter-spacing:-.04em}img{display:block;width:100%;max-width:640px;height:auto;border-radius:12px;margin:24px 0}button{padding:12px 20px;border:0;border-radius:8px;background:#9393ff;color:#111;font:inherit;cursor:pointer}#result{color:#aaa}'.str_repeat('/* exact authored CSS */',100);
$script='let count=0;document.querySelector("#counter").addEventListener("click",()=>{document.querySelector("#counter").textContent="Clique para testar: "+(++count);document.querySelector("#result").textContent="Interação preservada";});'.str_repeat('/* exact authored JS */',100);
file_put_contents($source.'/index.html',$html);file_put_contents($source.'/assets/site.css',$css);file_put_contents($source.'/assets/app.mjs',$script);
$bitmap=imagecreatetruecolor(640,360);imagefill($bitmap,0,0,imagecolorallocate($bitmap,89,78,171));imagepng($bitmap,$source.'/assets/photo.png');imagedestroy($bitmap);
$package=new ReflectionMethod($plugin,'package_directory_as_zip');$install=new ReflectionMethod($plugin,'install_zip');
$zip=$package->invoke($plugin,$source,'kodety-optimization-fixture-');
try{$first_release=$install->invoke($plugin,$zip,'optimization-fixture.zip',$settings);}finally{unlink($zip);}
$theme=get_theme_root().'/kodety-generated';$public=$theme.'/site';
$workspace=(new ReflectionMethod($plugin,'workspace_dir'))->invoke($plugin);
installed_optimization_assert(file_get_contents($workspace.'/index.html')===$html,'Publication preserves original editable HTML.');
installed_optimization_assert(file_get_contents($public.'/assets/site.css')===$css && file_get_contents($public.'/assets/app.mjs')===$script,'The activated theme retains authored CSS and JavaScript bytes.');
installed_optimization_assert(str_contains(file_get_contents($public.'/index.html'),'kodety-optimized-assets-v2'),'The activated publication uses a verified smaller image.');
installed_optimization_assert(gzdecode(file_get_contents($public.'/assets/site.css.gz'))===$css,'The activated compressed CSS restores the exact authored source.');
installed_optimization_assert(is_file($theme.'/performance.php') && json_decode(file_get_contents($theme.'/performance-config.json'),true)['enabled']===true,'Each release carries its runtime delivery configuration.');

// A newer draft must remain separate from the immutable published source.
$draft=str_replace('Projeto publicado original','Rascunho ainda não publicado',$html);
file_put_contents($source.'/index.html',$draft);$zip=$package->invoke($plugin,$source,'kodety-optimization-draft-');
try{(new ReflectionMethod($plugin,'stage_builder_import'))->invoke($plugin,$zip,'optimization-fixture.zip',true);}finally{unlink($zip);}
$draft_hashes=installed_optimization_files($workspace);$draft_revision=(int)get_option('kodety_workspace_revision');
$status=$plugin->optimization_status()->get_data();
$disabled=$status['settings'];$disabled['enabled']=false;
$payload=['settings'=>$disabled,'expectedRevision'=>$status['revision'],'expectedRelease'=>$status['release'],'applyPublished'=>false];
$response=installed_optimization_request($payload);
installed_optimization_assert($response->get_status()===200 && $response->get_data()['settings']===$disabled,'REST saves the master preference shared with wp-admin.');
installed_optimization_assert(get_option('kodety_current_release')===$first_release && str_contains(file_get_contents($public.'/index.html'),'kodety-optimized-assets-v2'),'Saving preferences alone does not change the published site.');
$payload['applyPublished']=true;$payload['expectedRevision']=$response->get_data()['revision'];
$response=installed_optimization_request($payload);$body=$response->get_data();
installed_optimization_assert($response->get_status()<300 && !empty($body['appliedToPublished']), 'REST reapplies the master switch to the published release.');
installed_optimization_assert(installed_optimization_files($workspace)===$draft_hashes && (int)get_option('kodety_workspace_revision')===$draft_revision,'Reapplying preserves every draft file and its revision. Changed paths: '.implode(', ',array_keys(array_diff_assoc(installed_optimization_files($workspace),$draft_hashes))));
$off_html=file_get_contents($public.'/index.html');
installed_optimization_assert(str_contains($off_html,'Projeto publicado original') && !str_contains($off_html,'Rascunho ainda não publicado') && !str_contains($off_html,'kodety-optimized-assets-v2'),'Disable-all rebuilds from published source, never from the newer draft.');
installed_optimization_assert(!is_file($public.'/assets/site.css.gz') && !is_dir($public.'/kodety-optimized-assets-v2') && json_decode(file_get_contents($theme.'/performance-config.json'),true)['enabled']===false,'Disable-all removes generated derivatives and disables delivery.');
$retry=installed_optimization_request($payload)->get_data();
installed_optimization_assert(!empty($retry['replayed']) && $retry['release']===$body['release'],'A lost-response retry reuses the committed receipt without another release.');

$status=$plugin->optimization_status()->get_data();$one=$settings;
foreach(array_keys(Kodety_Publication_Optimizer::options()) as $key)$one[$key]=$key==='imageDimensions';
$payload=['settings'=>$one,'expectedRevision'=>$status['revision'],'expectedRelease'=>$status['release'],'applyPublished'=>true];
$response=installed_optimization_request($payload);$body=$response->get_data();
installed_optimization_assert($response->get_status()<300 && str_contains(file_get_contents($public.'/index.html'),'width="640" height="360"') && !is_dir($public.'/kodety-optimized-assets-v2') && !is_file($public.'/assets/site.css.gz'),'An individual dimension-only release applies only the selected feature.');
$stale=installed_optimization_request(['settings'=>$disabled,'expectedRevision'=>str_repeat('0',64),'applyPublished'=>false]);
installed_optimization_assert($stale->get_status()===409 && get_option('kodety_optimization_settings')===$one,'A stale writer cannot replace newer preferences.');
$malformed=installed_optimization_request(['settings'=>array_replace($one,['enabled'=>'yes']),'expectedRevision'=>$body['revision']]);
installed_optimization_assert($malformed->get_status()===400,'Malformed switches are rejected without silent coercion.');

// Simulate an option-store failure between filesystem activation and its ACK.
$before_failure=installed_optimization_files($theme);$before_status=$plugin->optimization_status()->get_data();
$fail=static fn($new,$old)=>$old;add_filter('pre_update_option_kodety_optimization_report',$fail,10,2);
try{$failed=installed_optimization_request(['settings'=>$settings,'expectedRevision'=>$before_status['revision'],'expectedRelease'=>$before_status['release'],'applyPublished'=>true]);}finally{remove_filter('pre_update_option_kodety_optimization_report',$fail,10);}
installed_optimization_assert($failed->get_status()===500 && installed_optimization_files($theme)===$before_failure,'A failed optimization receipt rolls the public theme back exactly.');
installed_optimization_assert($plugin->optimization_status()->get_data()===$before_status && installed_optimization_files($workspace)===$draft_hashes,'Failed activation restores preferences, report, release and all draft files.');
$visitor=wp_insert_user(['user_login'=>'optimization_fixture_viewer','user_pass'=>wp_generate_password(32,true),'role'=>'subscriber']);wp_set_current_user($visitor);
$denied=installed_optimization_request(['settings'=>$settings]);installed_optimization_assert($denied->get_status()===403,'A user without publication capability cannot save or apply settings.');
wp_set_current_user(1);require_once ABSPATH.'wp-admin/includes/user.php';wp_delete_user($visitor);

// Leave a compact enabled release for real wp-admin / Publish / public-page QA.
$status=$plugin->optimization_status()->get_data();$final=installed_optimization_request(['settings'=>$settings,'expectedRevision'=>$status['revision'],'expectedRelease'=>$status['release'],'applyPublished'=>true]);
installed_optimization_assert($final->get_status()<300,'The feature remains usable after a rejected transaction.');
file_put_contents(ABSPATH.'optimization-test-result.json',wp_json_encode(['checks'=>$GLOBALS['optimization_installed_checks'],'report'=>$final->get_data()['report'],'release'=>$final->get_data()['release'],'draftRevision'=>$draft_revision],JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
WP_CLI::success('Installed publication optimizations passed ('.count($GLOBALS['optimization_installed_checks']).' checks).');
