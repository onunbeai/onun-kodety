// Development-only visual harness: the real App and real directory transport.
// It is outside Vite's production entry and never ships in the Web App.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import StudioWebApp from '../src/app';
import { bindHtmlDirectory } from '../src/html-directory';
import { browserProjectRepository } from '../src/project-library';

function Preview() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function open(previewFixture = false) {
    setBusy(true);
    try {
      const repository = browserProjectRepository();
      if (previewFixture && !repository.read().some(project => project.name === 'HTML preview check')) {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('kodety-html-preview-check', { create: true });
        const sources = {
          'index.html': '<!doctype html><html lang="en"><head><title>HTML preview check</title><link rel="stylesheet" href="assets/site.css"></head><body><main><h1>HTML preview works.</h1><p>Shared preview, local source.</p><button id="counter">Count: 0</button><p><a href="pages/about.html?from=home#details">About this preview</a></p><img src="assets/mark.svg" alt="Local purple square" width="64" height="64"></main><script src="assets/site.js"></script></body></html>',
          'pages/about.html': '<!doctype html><html lang="en"><head><title>About preview</title><link rel="stylesheet" href="../assets/site.css"></head><body><main id="details"><h1>Second local page.</h1><a href="../index.html">Back to preview home</a></main></body></html>',
          'assets/site.css': 'body{margin:0;background:#fafaf8;color:#171717;font-family:Arial,sans-serif}main{padding:80px}h1{font-size:48px}p{font-size:20px}button,a{font-size:18px}',
          'assets/site.js': 'let count=0;document.getElementById("counter").addEventListener("click",event=>{event.target.textContent="Count: "+(++count)});',
          'assets/mark.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#948bff"/></svg>',
        };
        for (const [path, text] of Object.entries(sources)) {
          const parts = path.split('/');
          let parent = directory;
          for (const segment of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(segment, { create: true });
          const writer = await (await parent.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
          await writer.write(text);
          await writer.close();
        }
        await repository.create('HTML preview check', 'en_US', { mode: 'html', directoryName: directory.name, prepare: project => bindHtmlDirectory(project.id, directory) });
      } else if (!previewFixture && !repository.read().some(project => project.name === 'Builder visual check')) {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('kodety-builder-visual-check', { create: true });
        const file = await directory.getFileHandle('index.html', { create: true });
        const writer = await file.createWritable();
        await writer.write('<!doctype html><html lang="en"><head><title>Builder visual check</title><style>body{margin:0;background:#fafaf8;color:#171717;font-family:Arial,sans-serif}main{padding:80px}h1{font-size:48px}p{font-size:20px}</style></head><body><main><h1>One shared Builder.</h1><p>HTML, styles, and editing from the same source.</p><button>Explore</button></main></body></html>');
        await writer.close();
        await repository.create('Builder visual check', 'en_US', { mode: 'html', directoryName: directory.name, prepare: project => bindHtmlDirectory(project.id, directory) });
      }
      setReady(true);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return ready ? <StudioWebApp /> : <div className="web-app" style={{ padding: 32 }}><h1>Builder visual check</h1><p>Open the real Studio with a disposable browser folder.</p><button className="web-button" disabled={busy} onClick={() => void open()}>{busy ? 'Preparing…' : 'Open test workspace'}</button><button className="web-button" disabled={busy} onClick={() => void open(true)}>Open preview test workspace</button><p role="alert">{error}</p></div>;
}
createRoot(document.getElementById('kodety-studio-root')!).render(<Preview />);
