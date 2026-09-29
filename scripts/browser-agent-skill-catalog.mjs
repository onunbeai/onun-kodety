import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packagedRoot = fileURLToPath(new URL('../Wordpress/kodety/agent-skills/', import.meta.url));

/** Read the same packaged skills as the server at build time. No host paths or
 * filesystem dependency enter the browser runtime. Symlinks are not followed. */
export async function readBrowserAgentSkills(root = packagedRoot) {
  async function filesAt(directory, prefix = '') {
    const files = [];
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) files.push(...await filesAt(path.join(directory, entry.name), relative + '/'));
      else if (entry.isFile()) files.push({ path: relative, content: await readFile(path.join(directory, entry.name), 'utf8') });
    }
    return files;
  }
  const packages = [];
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await filesAt(path.join(root, entry.name));
    if (files.some(file => file.path === 'SKILL.md')) packages.push({ name: entry.name, files });
  }
  return packages;
}
