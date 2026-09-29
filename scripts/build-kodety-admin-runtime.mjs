import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = new URL('../Wordpress/kodety/admin/components/', import.meta.url);
for (const name of ['shell', 'native-workspace', 'native-tools']) {
  const entry = fileURLToPath(new URL(`${name}.js`, directory));
  const sourceHash = createHash('sha256').update(await readFile(entry)).digest('hex');
  const dependencies = name === 'shell' ? ['navigation-loading.js', 'native-select.js'] : [];
  const dependencyHashes = await Promise.all(dependencies.map(async dependency => {
    const hash = createHash('sha256').update(await readFile(new URL(dependency, directory))).digest('hex');
    return `; dependency-sha256: ${dependency}=${hash}`;
  }));
  const result = await build({
    entryPoints: [entry],
    outfile: fileURLToPath(new URL(`${name}.bundle.js`, directory)),
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome105', 'firefox102', 'safari15.6'],
    charset: 'utf8',
    legalComments: 'eof',
    metafile: true,
    banner: { js: `/*! Generated from ${name}.js; source-sha256: ${sourceHash}${dependencyHashes.join('')} */` },
  });
  if (Object.keys(result.metafile.inputs).some(input => input.includes('node_modules/'))) {
    throw new Error(`${name}: the native admin adapter must not include a framework or library.`);
  }
}
// CSS sources remain readable. The native route loads one audited variant,
// avoiding downloads for layouts that cannot appear on that screen.
for (const name of ['shell', 'design-system', 'dashboard', 'wp-admin-audit']) {
  const source = await readFile(new URL(`${name}.css`, directory), 'utf8');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const variants = name === 'wp-admin-audit'
    ? {
        full: null,
        standard: ['settings', 'media', 'editor', 'code', 'updates'],
        dashboard: ['media', 'editor', 'dashboard'],
        settings: ['settings', 'media'],
        catalog: ['catalog', 'media'],
        menus: ['menus', 'media'],
        tools: ['tools', 'lists'],
        lists: ['lists', 'media', 'editor'],
        comments: ['lists', 'comments', 'media', 'editor'],
        plugins: ['lists', 'plugins', 'media', 'editor'],
        media: ['lists', 'media'],
        apps: ['apps', 'media'],
      }
    : {full: null};
  for (const [variant, features] of Object.entries(variants)) {
    const input = source.replace(/\/\* @workspace-feature (\w+) \*\/([\s\S]*?)\/\* @end-workspace-feature \*\//g,
      (_block, feature, css) => !features || features.includes(feature) ? css : '');
    if (input.includes('@workspace-feature')) throw new Error(`${name}: unclosed CSS feature section.`);
    const {code} = await transform(input, {loader: 'css', minify: true, target: ['chrome105', 'firefox102', 'safari15.6']});
    const suffix = variant === 'full' ? '' : `.${variant}`;
    await writeFile(new URL(`${name}${suffix}.bundle.css`, directory), `/*! Generated from ${name}.css; source-sha256: ${sourceHash}; variant: ${variant} */\n${code}`);
  }
}
console.log('Kodety admin runtime built from the local framework-free sources.');
