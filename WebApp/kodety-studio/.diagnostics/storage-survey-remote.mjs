/**
 * Metadata-only OPFS inventory. This module has no dependencies so its exact
 * source can run as a module script in the visible Playground document.
 */
export async function scanOpfsReadOnly(root, options = {}) {
  const maxDepth = Math.min(8, Math.max(0, Number.isInteger(options.maxDepth) ? options.maxDepth : 8));
  const maxEntries = Math.min(50_000, Math.max(1, Number.isInteger(options.maxEntries) ? options.maxEntries : 50_000));
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    limits: { maxDirectoryDepth: maxDepth, maxEntries },
    visitedEntries: 0,
    visitedDirectories: 0,
    stopped: null,
    rootEntries: [],
    projectRoots: [],
    sqliteCandidates: [],
    skippedAtDepthLimit: [],
    errors: [],
  };
  const queue = [{ handle: root, path: '/', depth: 0 }];
  let cursor = 0;
  const recordError = (path, error) => {
    if (report.errors.length < 100) report.errors.push({
      path,
      name: typeof error?.name === 'string' ? error.name : 'Error',
      message: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Metadata could not be read.',
    });
  };
  const emitProgress = () => options.onProgress?.({
    visitedEntries: report.visitedEntries,
    visitedDirectories: report.visitedDirectories,
    sqliteCandidates: report.sqliteCandidates.length,
  });
  while (cursor < queue.length && !report.stopped) {
    if (options.signal?.aborted) { report.stopped = 'cancelled'; break; }
    const current = queue[cursor++];
    report.visitedDirectories += 1;
    const names = [];
    let wordpressMarker = false;
    try {
      for await (const [name, entry] of current.handle.entries()) {
        if (options.signal?.aborted) { report.stopped = 'cancelled'; break; }
        if (report.visitedEntries >= maxEntries) { report.stopped = 'entry-limit'; break; }
        report.visitedEntries += 1;
        const path = `${current.path === '/' ? '' : current.path}/${name}`;
        if (names.length < 30) names.push({ name, kind: entry.kind });
        if (current.depth === 0 && report.rootEntries.length < 100) report.rootEntries.push({ name, kind: entry.kind });
        if (['wp-config.php', 'wp-load.php', 'wp-content', 'wp-includes'].includes(name)) wordpressMarker = true;
        if (entry.kind === 'directory') {
          if (current.depth >= maxDepth) {
            if (report.skippedAtDepthLimit.length < 100) report.skippedAtDepthLimit.push(path);
          } else {
            try {
              // Explicitly prohibit directory creation, including paths found
              // during enumeration that disappear before they are opened.
              const directory = await current.handle.getDirectoryHandle(name, { create: false });
              queue.push({ handle: directory, path, depth: current.depth + 1 });
            } catch (error) { recordError(path, error); }
          }
        } else if (entry.kind === 'file' && (
          /^\.ht\.sqlite(?:\.php)?(?:-(?:wal|shm|journal))?$/i.test(name)
          || /\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm|journal))?$/i.test(name)
        )) {
          try {
            const file = await entry.getFile();
            // getFile provides metadata. Do not call text/arrayBuffer/stream,
            // inspect the SQLite header, or open a SQLite connection.
            report.sqliteCandidates.push({ path, name, size: file.size });
          } catch (error) { recordError(path, error); }
        }
        if (report.visitedEntries % 250 === 0) emitProgress();
      }
    } catch (error) { recordError(current.path, error); }
    const knownProjectRoot = /^\/kodety-studio\/projects\/[^/]+$/.test(current.path)
      || /^\/sites\/[^/]+$/.test(current.path);
    if (knownProjectRoot || wordpressMarker) report.projectRoots.push({
      path: current.path,
      reason: knownProjectRoot ? 'known-project-layout' : 'wordpress-file-names',
      entries: names,
    });
  }
  report.finishedAt = new Date().toISOString();
  emitProgress();
  return report;
}

if (typeof document !== 'undefined' && document.querySelector('#scan-storage')) {
  const start = document.querySelector('#scan-storage');
  const cancel = document.querySelector('#cancel-scan');
  const status = document.querySelector('#survey-status');
  const output = document.querySelector('#survey-output');
  let controller = null;
  cancel.addEventListener('click', () => controller?.abort());
  start.addEventListener('click', async () => {
    if (controller) return;
    controller = new AbortController();
    start.disabled = true;
    cancel.disabled = false;
    output.textContent = '';
    status.textContent = 'Lendo os nomes de diretórios e os tamanhos dos possíveis bancos…';
    try {
      if (!navigator.storage?.getDirectory) throw new Error('O navegador não disponibiliza OPFS neste contexto.');
      const root = await navigator.storage.getDirectory();
      const metadata = await Promise.allSettled([
        Promise.resolve().then(() => typeof navigator.storage.persisted === 'function' ? navigator.storage.persisted() : null),
        Promise.resolve().then(() => typeof navigator.storage.estimate === 'function' ? navigator.storage.estimate() : null),
      ]);
      const persisted = metadata[0].status === 'fulfilled' ? metadata[0].value : null;
      const estimate = metadata[1].status === 'fulfilled' ? metadata[1].value : null;
      const report = await scanOpfsReadOnly(root, {
        signal: controller.signal,
        onProgress(progress) {
          status.textContent = `${progress.visitedEntries} entradas · ${progress.visitedDirectories} diretórios · ${progress.sqliteCandidates} possíveis bancos`;
        },
      });
      output.textContent = JSON.stringify({
        origin: location.origin,
        storage: {
          persisted: typeof persisted === 'boolean' ? persisted : null,
          usageBytes: typeof estimate?.usage === 'number' ? estimate.usage : null,
          quotaBytes: typeof estimate?.quota === 'number' ? estimate.quota : null,
        },
        scope: 'Somente o armazenamento acessível neste perfil e nesta origem incorporada. Candidatos identificados pelo nome; conteúdo não verificado.',
        ...report,
      }, null, 2);
      status.textContent = report.stopped === 'cancelled'
        ? 'Leitura interrompida. O relatório parcial está abaixo.'
        : report.stopped === 'entry-limit' || report.skippedAtDepthLimit.length
          ? 'Leitura concluída dentro dos limites. O relatório indica os caminhos não percorridos.'
          : 'Leitura concluída. Nenhum arquivo foi criado, alterado ou apagado no OPFS.';
    } catch (error) {
      status.textContent = 'Não foi possível concluir a leitura.';
      output.textContent = JSON.stringify({
        origin: location.origin,
        name: error?.name || 'Error',
        message: error?.message || String(error),
      }, null, 2);
    } finally {
      controller = null;
      start.disabled = false;
      cancel.disabled = true;
    }
  });
}
