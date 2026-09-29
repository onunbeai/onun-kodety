import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve('ChromeExtension/kodety-recorder');
const outputDirectory = path.resolve('ChromeExtension/dist/kodety-recorder');
const outputArchive = path.resolve('ChromeExtension/dist/kodety-recorder.zip');
const zip = new JSZip();

async function addDirectory(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) await addDirectory(absolute, relative);
    else zip.file(relative, await fs.readFile(absolute));
  }
}

await addDirectory(root);
await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.cp(root, outputDirectory, {
  recursive: true,
  filter: source => path.basename(source) !== '.DS_Store',
});
await fs.mkdir(path.dirname(outputArchive), { recursive: true });
await fs.writeFile(
  outputArchive,
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
);
console.log(`Chrome extension created: ${outputArchive}`);
