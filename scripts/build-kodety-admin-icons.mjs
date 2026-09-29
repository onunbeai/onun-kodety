import { build } from 'esbuild';
import { optimize } from 'svgo';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile, writeFile } from 'node:fs/promises';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const entryPoint = resolve(
  projectDirectory,
  'Wordpress/kodety/admin/components/kodety-icons.js',
);
const outputFile = resolve(
  projectDirectory,
  'Wordpress/kodety/admin/components/kodety-icons.bundle.js',
);

// React is used only by this build process to extract the original Solar SVGs.
// The browser graph contains raw SVG strings and our small DOM renderer.
const rawIcons = new Map();
const result = await build({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome105', 'firefox102', 'safari15.6'],
  charset: 'utf8',
  legalComments: 'eof',
  logLevel: 'info',
  metafile: true,
  banner: { js: '/*! Solar Icons by 480 Design (CC BY 4.0): https://www.figma.com/community/file/1166831539721848736 | https://creativecommons.org/licenses/by/4.0/ */' },
  plugins: [{
    name: 'solar-raw-svg',
    setup(builder) {
      builder.onResolve({ filter: /^@solar-icons\/raw\/(?:bold-duotone|linear)\/[a-z0-9-]+\.svg$/ }, (args) => ({
        path: args.path.replace('@solar-icons/raw/', '').replace(/\.svg$/, ''),
        namespace: 'solar-svg',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'solar-svg' }, async ({ path }) => {
        const module = await import(`@solar-icons/react/${path}`);
        const component = Object.values(module)[0];
        const markup = renderToStaticMarkup(createElement(component));
        // Root styling belongs to the admin's icon API. Preserve all genuine
        // paths, fill rules and Solar secondary opacity inside the SVG.
        const normalized = markup
          .replace(/^<svg\b[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">')
          // Two decimal places keep coordinate error within 0.005 SVG units
          // (0.0034px at 16px). Preserve every path, opacity and stroke.
          .replace(/\b(d|points|cx|cy|r|rx|ry|x|y|x1|x2|y1|y2)="([^"]*)"/g, (_attribute, name, value) =>
            `${name}="${value.replace(/-?\d*\.\d{3,}/g, (number, offset) =>
              String(Number(Number(number).toFixed(2))) + (value[offset + number.length] === '.' ? ' ' : ''))}"`);
        // Compact path notation only. Keep the Solar node tree, paint, curves
        // and transforms intact; extra precision preserves the rounded grid.
        const contents = optimize(normalized, {
          plugins: [{
            name: 'convertPathData',
            params: {
              applyTransforms: false,
              makeArcs: false,
              straightCurves: false,
              convertToQ: false,
              convertToZ: false,
              curveSmoothShorthands: false,
              lineShorthands: false,
              removeUseless: false,
              collapseRepeated: false,
              floatPrecision: 3,
            },
          }],
        }).data;
        if (!contents.includes('viewBox="0 0 24 24"') || !/<(?:path|circle|ellipse|rect)\b/.test(contents)) {
          throw new Error(`Invalid Solar SVG: ${path}`);
        }
        rawIcons.set(path, contents);
        return { contents, loader: 'text' };
      });
    },
  }],
});

if (Object.keys(result.metafile.inputs).some((input) => /node_modules\/(?:react|react-dom)\//.test(input))) {
  throw new Error('The admin icon bundle must never include the React runtime.');
}

// The server-rendered first frame uses the same Solar paths without waiting for JS.
const source = await readFile(entryPoint, 'utf8');
const imports = new Map([...source.matchAll(/import (\w+) from '@solar-icons\/raw\/([^']+)\.svg'/g)].map((match) => [match[1], match[2]]));
const names = new Set(['dashboard','editor','database','analytics','image','mail','marketing','users','files','comments','appearance','plugins','tools','settings','folder','upload','refresh','lock','shield','sparkles','help','search','chevron-down','chevron-right','panel-close','logout','blocks','plus','bell','website']);
const symbols = [...source.matchAll(/^\s*['"]?([\w-]+)['"]?: (\w+Icon),/gm)].filter((match) => names.has(match[1])).map((match) => {
  const svg = rawIcons.get(imports.get(match[2]));
  if (!svg) throw new Error(`Missing first-frame icon: ${match[1]}`);
  return svg.replace(/^<svg[^>]*>/, `<symbol id="${match[1]}" viewBox="0 0 24 24" fill="none">`).replace(/<\/svg>$/, '</symbol>');
});
await writeFile(resolve(projectDirectory, 'Wordpress/kodety/admin/components/shell-icons.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!-- Solar Icons by 480 Design, CC BY 4.0 -->' + symbols.join('') + '</svg>');
