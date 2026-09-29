import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
// Render the production PHP markup, so missing controls and selector changes
// fail this browser test instead of being concealed by a handwritten DOM.
const markup = execFileSync(process.env.KODETY_PHP_BINARY || 'php', ['-r', `
  define('ABSPATH', '/fixture/');
  define('ARRAY_A', 'ARRAY_A');
  function current_user_can(...$args): bool { return true; }
  function esc_attr($value): string { return htmlspecialchars((string) $value, ENT_QUOTES); }
  function esc_html($value): string { return htmlspecialchars((string) $value, ENT_QUOTES); }
  function wp_max_upload_size(): int { return 8 * 1024 * 1024; }
  function size_format($value): string { return '8 MB'; }
  class Kodety_Admin_I18n {
    public static function instance(): self { return new self(); }
    public function format_number($value): string { return (string) $value; }
  }
  $wpdb = new class {
    public string $posts = 'wp_posts';
    public function get_results(...$args): array { return [['mime' => 'application/pdf', 'total' => 1]]; }
  };
  require getenv('KODETY_MEDIA_FIXTURE_SOURCE');
  (new ReflectionClass(Kodety_Media::class))->newInstanceWithoutConstructor()->render_page();
`], {
  encoding: 'utf8',
  env: { ...process.env, KODETY_MEDIA_FIXTURE_SOURCE: path.join(root, 'Wordpress/kodety/includes/class-kodety-media.php') },
});
const [script, css] = await Promise.all([
  readFile(path.join(root, 'Wordpress/kodety/admin/media-library.js'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/admin/media-library.css'), 'utf8'),
]);
const foldersPath = '/wp-json/kodety/v1/media-folders';
const mediaPath = '/wp-json/wp/v2/media';
const lockMessage = 'Este projeto já está aberto para edição em outra sessão.';
const conflictMessage = 'Esta pasta foi alterada em outra sessão. Recarregue as pastas antes de tentar novamente.';
const requests = [];
let nextFolderId = 1;
let folders = [];
let mediaFolder = 0;
let rejectNext = null;
const folderPayload = folder => ({
  ...folder, count: mediaFolder === folder.id ? 1 : 0,
  revision: `name:${folder.id}:${folder.name}`,
  deleteRevision: `delete:${folder.id}:${folder.name}:${mediaFolder === folder.id ? '71' : ''}`,
});
const media = {
  id: 71, slug: 'manual', title: { raw: 'Manual PDF' }, media_type: 'file',
  mime_type: 'application/pdf', source_url: '/manual.pdf',
  media_details: { filesize: 1250 }, date: '2026-01-01T12:00:00',
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture.test');
  if (url.pathname === '/media-library.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script);
    return;
  }
  if (url.pathname === '/media-library.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' }).end(css);
    return;
  }
  if (url.pathname === '/wp-admin/admin.php') {
    const config = { endpoint: mediaPath, foldersEndpoint: foldersPath, moveEndpoint: foldersPath + '/move', nonce: 'media-fixture-nonce', canManageFolders: true, canUpload: true, canDelete: true };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      '<!doctype html><html lang="pt-BR"><head><link rel="stylesheet" href="/media-library.css"></head><body>'
      + markup + '<script>window.kodetyMediaLibrary=' + JSON.stringify(config) + '</script><script src="/media-library.js"></script></body></html>',
    );
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
  const json = (status, payload, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(payload));
  if (rejectNext && req.method === rejectNext.method && url.pathname === rejectNext.path) {
    rejectNext = null;
    json(423, { code: 'kodety_editor_lock_required', message: lockMessage });
    return;
  }
  if (url.pathname === mediaPath && req.method === 'GET') {
    const filter = url.searchParams.get('kodety_folder');
    const items = filter === null || Number(filter) === mediaFolder ? [{ ...media, kodety_folder_ids: mediaFolder ? [mediaFolder] : [] }] : [];
    json(200, items, { 'X-WP-Total': String(items.length), 'X-WP-TotalPages': '1' });
  } else if (url.pathname === foldersPath && req.method === 'GET') {
    json(200, folders.map(folderPayload));
  } else if (url.pathname === foldersPath && req.method === 'POST') {
    const folder = { id: nextFolderId++, name: body.name, parent: 0, count: 0 };
    folders.push(folder);
    json(201, folderPayload(folder));
  } else if (url.pathname === foldersPath + '/move' && req.method === 'POST') {
    if (JSON.stringify(body.expectedFolders?.[71]) !== JSON.stringify(mediaFolder ? [mediaFolder] : [])) {
      json(409, { code: 'kodety_media_folder_conflict', message: 'A pasta de um arquivo foi alterada em outra sessão.' });
    } else {
      mediaFolder = body.folder_id;
      json(200, { moved: body.ids.length, failed: [] });
    }
  } else if (url.pathname.startsWith(foldersPath + '/')) {
    const id = Number(url.pathname.slice(foldersPath.length + 1));
    const folder = folders.find(candidate => candidate.id === id);
    if (!folder) json(404, { message: 'Pasta inexistente.' });
    else if ((req.method === 'POST' && body.expectedRevision !== folderPayload(folder).revision)
      || (req.method === 'DELETE' && body.expectedDeleteRevision !== folderPayload(folder).deleteRevision)) {
      json(409, { code: 'kodety_folder_conflict', message: conflictMessage, data: { folder: folderPayload(folder) } });
    }
    else if (req.method === 'POST') {
      folder.name = body.name;
      json(200, folderPayload(folder));
    } else if (req.method === 'DELETE') {
      folders = folders.filter(candidate => candidate.id !== id);
      if (mediaFolder === id) mediaFolder = 0;
      json(200, { deleted: true });
    } else json(405, { message: 'Método inesperado.' });
  } else json(404, { message: 'Endpoint inesperado.' });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/wp-admin/admin.php?page=kodety-media`);
  await expect(page.locator('[data-kodety-media-app]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Abrir detalhes de Manual PDF' })).toBeVisible();
  const folderForm = page.locator('[data-kodety-media-folder-form]');
  const nameInput = page.getByRole('textbox', { name: 'Nome da pasta', exact: true });
  const toast = page.locator('[data-kodety-media-toast]');
  const folderButton = id => page.locator(`[data-kodety-media-folder="${id}"]`);
  const writes = () => requests.filter(request => request.method !== 'GET');

  await page.getByRole('button', { name: 'Criar pasta', exact: true }).click();
  await nameInput.fill('   ');
  await folderForm.getByRole('button', { name: 'Criar', exact: true }).click();
  assert.equal(writes().length, 0, 'Blank folder names must not reach the server.');
  await nameInput.fill('  Fotos do lançamento  ');
  rejectNext = { method: 'POST', path: foldersPath };
  await folderForm.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(toast).toHaveText(lockMessage);
  await expect(toast).toHaveAttribute('role', 'alert');
  await expect(nameInput).toHaveValue('  Fotos do lançamento  ');
  await expect(folderForm.getByRole('button', { name: 'Criar', exact: true })).toBeEnabled();
  assert.equal(folders.length, 0);
  await folderForm.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(folderButton(1)).toHaveText('Fotos do lançamento0');
  await expect(folderButton(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(folderForm).toBeHidden();
  await expect(page.locator('[data-kodety-media-empty]')).toBeVisible();
  assert.deepEqual(writes().slice(0, 2).map(request => request.body), [{ name: 'Fotos do lançamento' }, { name: 'Fotos do lançamento' }]);

  await page.getByRole('button', { name: 'Renomear Fotos do lançamento', exact: true }).click();
  const renameInput = page.getByRole('textbox', { name: 'Renomear Fotos do lançamento', exact: true });
  const renameSave = page.locator('.kodety-media-folder-edit').getByRole('button', { name: 'Salvar', exact: true });
  await renameInput.fill('  Arquivo final  ');
  rejectNext = { method: 'POST', path: foldersPath + '/1' };
  await renameSave.click();
  await expect(toast).toHaveText(lockMessage);
  await expect(renameInput).toHaveValue('  Arquivo final  ');
  await expect(renameSave).toBeEnabled();
  await renameSave.click();
  await expect(folderButton(1)).toHaveText('Arquivo final0');
  await expect(page.locator('.kodety-media-folder-edit')).toHaveCount(0);
  await expect(folderButton(1)).toHaveAttribute('aria-pressed', 'true');
  assert.deepEqual(writes().slice(2, 4).map(request => request.body), [
    { name: 'Arquivo final', expectedRevision: 'name:1:Fotos do lançamento' },
    { name: 'Arquivo final', expectedRevision: 'name:1:Fotos do lançamento' },
  ]);

  // A concurrent rename must not be overwritten by either the first submit
  // or an unchanged retry. Refresh is explicit and keeps the user's draft.
  await page.getByRole('button', { name: 'Renomear Arquivo final', exact: true }).click();
  await page.getByRole('textbox', { name: 'Renomear Arquivo final', exact: true }).fill('Arquivo final');
  folders[0].name = 'Nome da outra sessão';
  await renameSave.click();
  await expect(toast).toHaveText(conflictMessage);
  await renameSave.click();
  await expect(renameSave).toBeEnabled();
  assert.equal(folders[0].name, 'Nome da outra sessão', 'Repeated saves must not automatically adopt a conflicting baseline.');
  await page.getByRole('button', { name: 'Atualizar pastas', exact: true }).click();
  await expect(page.getByText('Nome atual: Nome da outra sessão', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Renomear Nome da outra sessão', exact: true })).toHaveValue('Arquivo final');
  await renameSave.click();
  await expect(folderButton(1)).toHaveText('Arquivo final0');

  await folderButton('').click();
  await page.getByRole('checkbox', { name: 'Selecionar Manual PDF', exact: true }).check();
  await page.getByRole('combobox', { name: 'Pasta de destino' }).selectOption('1');
  await page.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(toast).toHaveText('1 arquivo movido.');
  await expect(folderButton(1)).toHaveText('Arquivo final1');
  assert.deepEqual(writes().at(-1).body, { ids: [71], folder_id: 1, expectedFolders: { 71: [] } });
  await folderButton(1).click();
  await expect(page.getByRole('button', { name: 'Abrir detalhes de Manual PDF' })).toBeVisible();

  const writesBeforeDelete = writes().length;
  await page.getByRole('button', { name: 'Excluir Arquivo final', exact: true }).click();
  assert.equal(writes().length, writesBeforeDelete, 'First delete click only asks for confirmation.');
  rejectNext = { method: 'DELETE', path: foldersPath + '/1' };
  await page.getByRole('button', { name: 'Confirmar exclusão de Arquivo final', exact: true }).click();
  await expect(toast).toHaveText(lockMessage);
  const deleteRetry = page.getByRole('button', { name: 'Confirmar exclusão de Arquivo final', exact: true });
  await expect(deleteRetry).toBeEnabled();
  assert.equal(folders.length, 1, 'A rejected deletion must preserve the folder.');
  await deleteRetry.click();
  await expect(folderButton(1)).toHaveCount(0);
  await expect(folderButton('')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Abrir detalhes de Manual PDF' })).toBeVisible();
  assert.equal(mediaFolder, 0, 'Deleting the folder leaves its media in the library.');
  assert.deepEqual(writes().slice(-2).map(request => [request.method, request.path]), [['DELETE', foldersPath + '/1'], ['DELETE', foldersPath + '/1']]);

  for (const request of writes()) {
    assert.equal(request.headers['x-wp-nonce'], 'media-fixture-nonce');
    assert.equal(request.headers['x-kodety-editor-session'], undefined, 'wp-admin must not impersonate a Builder session.');
    assert.equal(request.headers['x-kodety-editor-lease'], undefined);
  }
  assert.deepEqual(errors, [], 'The real media UI must run without uncaught browser errors.');
  console.log('PASS: real PHP media markup + production JavaScript; folder CRUD, move, 423 retry, stale rename 409 and explicit refresh preserve names and concurrent changes.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
