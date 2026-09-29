import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const repository=fileURLToPath(new URL('../', import.meta.url));
const require=createRequire(repository+'/package.json');
const {request}=require('playwright');
const JSZip=require('jszip');
const args=process.argv.slice(2);
const argument=name=>args.includes(name)?args[args.indexOf(name)+1]:'';
const environmentFile=argument('--environment')||process.env.KODETY_STABILITY_ENV;
assert.ok(environmentFile,'Pass --environment for a disposable loopback installation.');
const environment=JSON.parse(await readFile(environmentFile,'utf8'));
const root=environment.KODETY_STABILITY_WP_ROOT;
const site=new URL(environment.KODETY_E2E_BASE_URL);
assert.match(path.basename(root),/^kodety-stability-wp-/);
assert.equal(site.hostname,'127.0.0.1');
const relativeEnvironment=path.relative(path.resolve(root),path.resolve(environmentFile));
assert.ok(relativeEnvironment.startsWith('..'+path.sep)||path.isAbsolute(relativeEnvironment),'Credentials must remain outside the WordPress webroot');
const wp=(...command)=>execFileSync('wp',[`--path=${root}`,...command],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(wp('option','get','home'),site.origin);
assert.match(wp('config','get','DB_NAME'),/^kodety_stability_/);
let candidate;
if(argument('--plugin-zip')){
 const expected=argument('--expected-sha256');assert.match(expected,/^[a-f0-9]{64}$/);
 const zipPath=path.resolve(argument('--plugin-zip'));const actual=createHash('sha256').update(await readFile(zipPath)).digest('hex');
 assert.equal(actual,expected,'Only the exact identified candidate may be installed');
 wp('plugin','install',zipPath,'--force','--activate');candidate={file:path.basename(zipPath),sha256:actual};
}
const report={candidate,startedAt:new Date().toISOString(),wordpress:wp('core','version'),plugin:wp('plugin','get','kodety','--field=version'),origin:site.origin,checks:[]};
// A fresh install opens onboarding until it has a workspace. Seed the same
// tracked small fixture as the UI journey before exercising real HTTP publish.
wp('--user='+environment.KODETY_E2E_USER,'eval-file',path.join(repository,'scripts/fixtures/stability-stage-project.php'));
const anonymous=await request.newContext();
const authenticated=await request.newContext();
const output=argument('--output')||path.dirname(environmentFile);await mkdir(output,{recursive:true});
const artifact=path.join(output,'sitemap-installed-report.json');
let lockContext;
const parseXml=xml=>JSON.parse(execFileSync('php',['-r',`$d=new DOMDocument();if(!$d->loadXML(file_get_contents('php://stdin'),LIBXML_NONET))exit(2);$out=[];foreach($d->getElementsByTagName('url') as $u){$out[]=['loc'=>$u->getElementsByTagName('loc')->item(0)->textContent,'lastmod'=>$u->getElementsByTagName('lastmod')->item(0)?->textContent];}echo json_encode(['namespace'=>$d->documentElement->namespaceURI,'root'=>$d->documentElement->localName,'entries'=>$out]);`],{input:xml,encoding:'utf8'}));
const fixture=async version=>{
 const zip=new JSZip();
 const markup=(title,head='')=>`<!doctype html><html><head><title>${title}</title>${head}<link rel="stylesheet" href="styles.css"></head><body><main>${title}</main></body></html>`;
 const files={
  'index.html':markup('Sitemap fixture home'),
  'about.html':markup('About fixture'),
  'noindex.html':markup('Not indexable','<meta name="robots" content="noindex,follow">'),
  'unlisted.html':markup('Explicit sitemap exclusion'),
  'alternate.html':markup('Alternate canonical','<link rel="canonical" href="'+site.origin+'/about/">'),
  'draft.html':markup('Private draft'),
  'styles.css':'main { color: #123456; font-family: sans-serif; }',
 };
 if(version===2)files['new-page.html']=markup('Second release page');
 for(const [name,body] of Object.entries(files))zip.file(name,body);
 zip.file('.incode/project.json',JSON.stringify({version:1,projectId:'kst-sitemap-installed',name:'Sitemap installed smoke',mainHtmlPath:'index.html',homeHtmlPath:'index.html',rootPath:'',siteSettings:{sitemapEnabled:true},pageStatuses:{'draft.html':'draft'},pageSettings:{'unlisted.html':{includeInSitemap:false}}}));
 return zip.generateAsync({type:'nodebuffer'});
};
try {
 const loginUrl=new URL(environment.KODETY_E2E_LOGIN_URL||wp('eval','echo wp_login_url();'),site);
 assert.equal(loginUrl.origin,site.origin);
 await authenticated.get(loginUrl.href);
 const login=await authenticated.post(loginUrl.href,{maxRedirects:0,form:{log:environment.KODETY_E2E_USER,pwd:environment.KODETY_E2E_PASSWORD,'wp-submit':'Log In',redirect_to:site.origin+'/kodety/editor/',testcookie:'1'}});
 assert.ok([302,303].includes(login.status()),'Test account login must issue a successful redirect: HTTP '+login.status());
 const shell=await authenticated.get(site.origin+'/kodety/editor/');
 const shellHtml=await shell.text();
 const bootstrap=shellHtml.match(/window\.kodetyWordPress=(\{.*?\});window\.kodetyAdminI18n/s);
 assert.ok(bootstrap,'Authenticated editor bootstrap is required (HTTP '+shell.status()+', path '+new URL(shell.url()).pathname+', loginForm '+shellHtml.includes('user_login')+', configKey '+shellHtml.includes('kodetyWordPress')+')');
 const config=JSON.parse(bootstrap[1]);
 assert.ok(config.nonce&&config.sitemapUrl);
 assert.equal(wp('option','get','blog_public'),'1','Disposable fixture site must allow crawler access');
 const sessionId=randomUUID(),leaseId=randomUUID();
 const authorizationHeaders={'X-WP-Nonce':config.nonce,'X-Kodety-Editor-Session':sessionId,'X-Kodety-Editor-Lease':leaseId};
 lockContext={url:config.editorLockUrl,headers:authorizationHeaders,data:{sessionId,leaseId}};
 const heartbeat=async()=>{const response=await authenticated.post(lockContext.url,{headers:authorizationHeaders,data:lockContext.data});assert.equal(response.status(),200);assert.equal((await response.json()).mode,'edit','Publish must hold the actual editor lease');};
 const headers={...authorizationHeaders,'content-type':'application/zip'};
 const publish=async version=>{
  await heartbeat();
  const response=await authenticated.post(site.origin+'/wp-json/kodety/v1/publish',{headers,data:await fixture(version),timeout:120000});
  const payload=await response.json();
  assert.ok([200,202].includes(response.status()),'Publish HTTP '+response.status()+': '+(payload.message||''));
  assert.equal(payload.success,true);assert.equal(payload.releaseOnline,true);assert.ok(payload.release);
  report.checks.push({name:'publish-'+version,status:response.status(),release:payload.release,syncPending:payload.syncPending});
  return payload;
 };
 const inspect=async (release,count)=>{
  const response=await anonymous.get(site.origin+'/sitemap.xml',{maxRedirects:0});
  assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/application\/xml/);
  const body=await response.text();const xml=parseXml(body);
  assert.equal(xml.namespace,'http://www.sitemaps.org/schemas/sitemap/0.9');assert.equal(xml.root,'urlset');assert.equal(xml.entries.length,count);
  assert.deepEqual(xml.entries.map(entry=>entry.loc).sort(),[site.origin+'/',site.origin+'/about/',...(count===3?[site.origin+'/new-page/']:[])].sort());
  const head=await anonymous.head(site.origin+'/sitemap.xml',{maxRedirects:0});
  assert.equal(head.status(),200);assert.equal((await head.body()).length,0);assert.equal(head.headers()['content-type'],response.headers()['content-type']);
  const robots=await anonymous.get(site.origin+'/robots.txt',{maxRedirects:0});assert.equal(robots.status(),200);
  const robotsBody=await robots.text();assert.equal(robotsBody.split('\n').filter(line=>line.trim()==='Sitemap: '+site.origin+'/sitemap.xml').length,1);
  const denied=await anonymous.get(config.sitemapUrl);assert.ok([401,403].includes(denied.status()));
  const diagnosticResponse=await authenticated.get(config.sitemapUrl,{headers:{'X-WP-Nonce':config.nonce}});
  assert.equal(diagnosticResponse.status(),200);assert.match(diagnosticResponse.headers()['cache-control'],/no-store/);
  const diagnostic=await diagnosticResponse.json();assert.equal(diagnostic.release,release);assert.equal(diagnostic.urlCount,count);assert.equal(diagnostic.enabled,true);assert.deepEqual(diagnostic.validationErrors,[]);assert.equal(diagnostic.googleProcessingStatus,'unverified');
  for(const entry of xml.entries){const page=await anonymous.get(entry.loc,{maxRedirects:0});assert.equal(page.status(),200,'Listed URL must be public: '+entry.loc);}
  report.checks.push({name:'public-sitemap-'+release,status:response.status(),head:head.status(),urlCount:count,xml:xml.entries,robots:robotsBody,diagnostic,anonymousDiagnostic:denied.status()});
  return xml;
 };
 const first=await publish(1);const firstXml=await inspect(first.release,2);
 const draft=await anonymous.get(site.origin+'/draft/',{maxRedirects:0});assert.equal(draft.status(),404,'Draft must remain absent from the public route tree');
 const inventory=await anonymous.get(site.origin+'/wp-content/themes/kodety-generated/sitemap-manifest.php');assert.equal((await inventory.text()).trim(),'','Guarded inventory must not disclose project metadata');
 const invalidMethod=await anonymous.post(site.origin+'/sitemap.xml',{maxRedirects:0});assert.equal(invalidMethod.status(),405);
 const missingPart=await anonymous.get(site.origin+'/kodety-sitemap-99.xml',{maxRedirects:0});assert.equal(missingPart.status(),404);
 await new Promise(resolve=>setTimeout(resolve,1100));
 const second=await publish(2);const secondXml=await inspect(second.release,3);
 for(const previous of firstXml.entries)assert.equal(secondXml.entries.find(entry=>entry.loc===previous.loc)?.lastmod,previous.lastmod,'Unchanged content must preserve lastmod across publication');
 await heartbeat();
 const rollback=await authenticated.post(site.origin+'/wp-json/kodety/v1/rollback/'+first.release,{headers:authorizationHeaders,data:{expectedWorkspaceRevision:second.workspaceRevision},timeout:120000});
 assert.ok([200,202].includes(rollback.status()));const restored=await rollback.json();assert.equal(restored.success,true);assert.equal(restored.rolledBackFrom,first.release);
 const restoredXml=await inspect(restored.release,2);
 assert.deepEqual(restoredXml.entries,firstXml.entries,'Rollback must restore exactly the original URL inventory and lastmod');
 report.checks.push({name:'rollback',status:rollback.status(),source:first.release,release:restored.release});
 wp('option','update','blog_public','0');
 try {
  const privateSitemap=await anonymous.get(site.origin+'/sitemap.xml',{maxRedirects:0});assert.equal(privateSitemap.status(),404);
  const privateRobots=await anonymous.get(site.origin+'/robots.txt');assert.ok(!(await privateRobots.text()).includes('Sitemap: '+site.origin+'/sitemap.xml'));
  report.checks.push({name:'private-site',status:privateSitemap.status(),ownSitemapDiscovered:false});
 } finally { wp('option','update','blog_public','1'); }
 report.result='passed';
 console.log('Installed sitemap smoke passed: two HTTP publications, anonymous GET/HEAD, XML eligibility, robots, permissions, significant lastmod,405/404 and rollback.');
} catch(error) {
 report.result='failed';report.failure=String(error.message).split(environment.KODETY_E2E_PASSWORD).join('[REDACTED]');
 console.error(report.failure);process.exitCode=1;
} finally {
 if(lockContext)await authenticated.delete(lockContext.url,{headers:lockContext.headers,data:lockContext.data}).catch(()=>{});
 report.finishedAt=new Date().toISOString();await writeFile(artifact,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 await anonymous.dispose();await authenticated.dispose();
 console.log('Report: '+artifact);
}
