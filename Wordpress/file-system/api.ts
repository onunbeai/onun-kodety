import type {
  ActivityEntry,
  AssetUsage,
  AssetVersion,
  FileListResult,
  FileObject,
  FilePermissions,
  FileScope,
  FileSystemBootstrap,
  FileSystemCapabilities,
  FileSystemSettings,
  KodetyFileSystemConfig,
  StorageMount,
} from './types';

export class FileSystemApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status = 0, code?: string, details?: unknown) {
    super(message);
    this.name = 'FileSystemApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get unsupported() {
    return this.status === 404 || this.status === 405 || this.status === 501;
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function boolean(value: unknown) {
  return value === true || value === 1 || value === '1';
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function providerId(value: unknown) {
  const provider = stringValue(value, 'local').trim().toLowerCase();
  if (['filesystem', 'backend-filesystem', 'backend_filesystem'].includes(provider)) return 'local';
  if (['wordpress', 'wordpress_media', 'wp-media', 'media'].includes(provider)) return 'wordpress-media';
  return provider || 'local';
}

/** Only relative virtual paths cross the API boundary. */
export function relativeVirtualPath(value: unknown) {
  return stringValue(value).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function normalizeCapabilities(value: unknown): FileSystemCapabilities {
  const raw = record(value);
  const edit = boolean(raw.edit ?? raw.write);
  const managePrivate = boolean(raw.managePrivate ?? raw.manage_private);
  const manageStorage = boolean(raw.manageStorage ?? raw.manage_storage);
  const editCode = boolean(raw.editCode ?? raw.edit_code);
  const dangerousFileEditing = boolean(raw.dangerousFileEditing ?? raw.dangerous_file_editing);
  return {
    read: boolean(raw.read),
    edit,
    write: edit || boolean(raw.write),
    create: edit || boolean(raw.create),
    delete: boolean(raw.delete),
    move: edit || boolean(raw.move),
    share: boolean(raw.share),
    visibility: managePrivate || boolean(raw.visibility),
    editCode,
    versions: edit || boolean(raw.versions),
    upload: boolean(raw.upload),
    managePrivate,
    manageStorage,
    dangerousFileEditing,
    rescan: manageStorage || boolean(raw.rescan),
    archive: edit || boolean(raw.archive ?? raw.archives),
    activity: raw.activity === undefined ? boolean(raw.read) : boolean(raw.activity),
    purge: boolean(raw.purge),
  };
}

function normalizePermissions(value: unknown): FilePermissions {
  const normalized = normalizeCapabilities(value);
  return {
    read: normalized.read,
    write: normalized.write,
    create: normalized.create,
    upload: normalized.upload,
    delete: normalized.delete,
    move: normalized.move,
    share: normalized.share,
    visibility: normalized.visibility,
    editCode: normalized.editCode,
    versions: normalized.versions,
  };
}

export function normalizeMount(value: unknown, index = 0): StorageMount {
  const raw = record(value);
  const id = stringValue(raw.id, `mount-${index}`);
  const label = stringValue(raw.label ?? raw.name, id || `Storage ${index + 1}`);
  const provider = providerId(raw.provider);
  const permissions = normalizePermissions(raw.permissions);
  return {
    id,
    name: label,
    label,
    provider,
    storageMount: stringValue(raw.storageMount ?? raw.storage_mount) || undefined,
    description: stringValue(raw.description) || undefined,
    status: stringValue(raw.status, 'online'),
    readOnly: raw.readOnly !== undefined ? boolean(raw.readOnly) : permissions.write === false && permissions.create === false,
    visibility: ['public', 'private', 'shared'].includes(stringValue(raw.visibility))
      ? stringValue(raw.visibility) as StorageMount['visibility']
      : undefined,
    quota: raw.quota && typeof raw.quota === 'object'
      ? { used: numberValue(record(raw.quota).used), total: numberValue(record(raw.quota).total) }
      : undefined,
    permissions,
  };
}

export function normalizeFileObject(value: unknown, fallbackMount = 'project', index = 0): FileObject {
  const raw = record(value);
  const path = relativeVirtualPath(raw.path);
  const name = stringValue(raw.name, path.split('/').pop() || `Item ${index + 1}`);
  const mimeType = stringValue(raw.mimeType ?? raw.mime_type);
  const kind = raw.kind === 'folder' || mimeType === 'inode/directory' ? 'folder' : 'file';
  const visibility = ['public', 'private', 'shared'].includes(stringValue(raw.visibility))
    ? stringValue(raw.visibility) as FileObject['visibility']
    : undefined;
  const createdByRecord = record(raw.createdBy ?? raw.created_by);
  const createdBy = typeof raw.createdBy === 'string'
    ? raw.createdBy
    : Object.keys(createdByRecord).length
      ? { id: stringValue(createdByRecord.id) || undefined, name: stringValue(createdByRecord.name) || undefined }
      : undefined;
  const usages = Array.isArray(raw.usages)
    ? raw.usages.map((usage): AssetUsage => {
        const item = record(usage);
        return {
          id: stringValue(item.id) || undefined,
          label: stringValue(item.label ?? item.name, 'Usage'),
          location: stringValue(item.location) || undefined,
          url: stringValue(item.url) || undefined,
        };
      })
    : [];
  return {
    id: stringValue(raw.id, `${fallbackMount}:${path}:${index}`),
    name,
    path,
    kind,
    extension: stringValue(raw.extension) || (kind === 'file' && name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined),
    mimeType: mimeType || undefined,
    size: numberValue(raw.size),
    provider: providerId(raw.provider),
    mount: stringValue(raw.mount, fallbackMount),
    storageMount: stringValue(raw.storageMount ?? raw.storage_mount) || undefined,
    visibility,
    publicUrl: stringValue(raw.publicUrl ?? raw.public_url) || null,
    previewUrl: stringValue(raw.previewUrl ?? raw.preview_url) || null,
    width: numberValue(raw.width),
    height: numberValue(raw.height),
    duration: numberValue(raw.duration),
    checksum: stringValue(raw.checksum) || null,
    createdAt: stringValue(raw.createdAt ?? raw.created_at) || undefined,
    updatedAt: stringValue(raw.updatedAt ?? raw.updated_at) || undefined,
    createdBy,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    favorite: boolean(raw.favorite),
    version: typeof raw.version === 'string' || typeof raw.version === 'number' ? raw.version : undefined,
    permissions: normalizePermissions(raw.permissions),
    usages,
    deletedAt: stringValue(raw.deletedAt ?? raw.deleted_at) || null,
    originalPath: relativeVirtualPath(raw.originalPath ?? raw.original_path) || null,
  };
}

function normalizeVersions(value: unknown): AssetVersion[] {
  const raw = record(value);
  const rawItems = Array.isArray(value) ? value : Array.isArray(raw.items) ? raw.items : Array.isArray(raw.versions) ? raw.versions : [];
  return rawItems.map((value, index) => {
    const item = record(value);
    return {
      id: stringValue(item.id ?? item.versionId ?? item.version_id),
      version: typeof item.version === 'string' || typeof item.version === 'number' ? item.version : index + 1,
      createdAt: stringValue(item.createdAt ?? item.created_at) || undefined,
      createdBy: stringValue(item.createdBy ?? item.created_by) || undefined,
      size: numberValue(item.size),
      checksum: stringValue(item.checksum) || undefined,
      current: boolean(item.current),
    };
  }).filter(version => Boolean(version.id));
}

function normalizeActivity(value: unknown): ActivityEntry[] {
  const raw = record(value);
  const rawItems = Array.isArray(value) ? value : Array.isArray(raw.items) ? raw.items : Array.isArray(raw.entries) ? raw.entries : [];
  return rawItems.map((value, index) => {
    const item = record(value);
    const actorValue = item.actor ?? item.user ?? item.userId ?? item.user_id;
    return {
      id: stringValue(item.id, `activity-${index}`),
      action: stringValue(item.action, 'activity'),
      message: stringValue(item.message) || undefined,
      actor: typeof actorValue === 'string' || typeof actorValue === 'number' ? String(actorValue) : undefined,
      assetName: stringValue(item.assetName ?? item.asset_name ?? item.name) || undefined,
      provider: providerId(item.provider),
      mount: stringValue(item.mount ?? item.mount_id) || undefined,
      path: relativeVirtualPath(item.path) || undefined,
      createdAt: stringValue(item.createdAt ?? item.created_at) || undefined,
      before: item.before,
      after: item.after,
    };
  });
}

function normalizeBootstrap(value: unknown): FileSystemBootstrap {
  const raw = record(value);
  const mounts = (Array.isArray(raw.mounts) ? raw.mounts : []).map(normalizeMount);
  const itemSource = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.files) ? raw.files : [];
  const rawLimits = record(raw.limits);
  const providers = Array.isArray(raw.providers) ? raw.providers.map(provider => {
    const descriptor = record(provider);
    return {
      id: providerId(descriptor.id),
      label: stringValue(descriptor.label ?? descriptor.name) || undefined,
      capabilities: Object.fromEntries(Object.entries(record(descriptor.capabilities)).map(([key, value]) => [key, boolean(value)])),
    };
  }) : [];
  providers.forEach(provider => {
    if (provider.id === 'local' || mounts.some(mount => mount.provider === provider.id)) return;
    const permissions = normalizePermissions(provider.capabilities);
    mounts.push({
      id: provider.id === 'wordpress-media' ? 'media' : provider.id,
      name: provider.label || provider.id,
      label: provider.label,
      provider: provider.id,
      status: 'online',
      readOnly: permissions.write === false && permissions.upload === false,
      visibility: provider.id === 'wordpress-media' ? 'public' : undefined,
      permissions,
    });
  });
  return {
    mounts,
    files: itemSource.map((item, index) => normalizeFileObject(item, stringValue(raw.currentMount, mounts[0]?.id || 'project'), index)),
    providers,
    currentMount: stringValue(raw.currentMount ?? raw.current_mount, mounts[0]?.id || 'project'),
    currentStorageMount: stringValue(raw.currentStorageMount ?? raw.current_storage_mount) || undefined,
    currentPath: relativeVirtualPath(raw.currentPath ?? raw.current_path),
    capabilities: normalizeCapabilities(raw.capabilities),
    user: raw.user ? {
      id: stringValue(record(raw.user).id) || numberValue(record(raw.user).id),
      name: stringValue(record(raw.user).name) || undefined,
      avatarUrl: stringValue(record(raw.user).avatarUrl ?? record(raw.user).avatar_url) || undefined,
    } : undefined,
    project: raw.project ? {
      id: stringValue(record(raw.project).id) || numberValue(record(raw.project).id),
      name: stringValue(record(raw.project).name) || undefined,
    } : undefined,
    features: Object.fromEntries(Object.entries(record(raw.features)).map(([key, value]) => [key, boolean(value)])),
    storage: raw.storage && typeof raw.storage === 'object' ? {
      publicAvailable: boolean(record(raw.storage).publicAvailable ?? record(raw.storage).public_available),
      privateAvailable: boolean(record(raw.storage).privateAvailable ?? record(raw.storage).private_available),
      status: stringValue(record(raw.storage).status) || undefined,
      warning: stringValue(record(raw.storage).warning) || null,
    } : undefined,
    limits: {
      maxUploadBytes: numberValue(rawLimits.maxUploadBytes ?? rawLimits.uploadBytes ?? rawLimits.upload_bytes),
      maxEditBytes: numberValue(rawLimits.maxEditBytes ?? rawLimits.editBytes ?? rawLimits.edit_bytes),
      chunkThresholdBytes: numberValue(rawLimits.chunkThresholdBytes ?? rawLimits.chunkBytes ?? rawLimits.chunk_bytes),
      chunkSizeBytes: numberValue(rawLimits.chunkSizeBytes ?? rawLimits.chunkBytes ?? rawLimits.chunk_bytes),
    },
  };
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object') {
    const value = payload as UnknownRecord;
    if ('data' in value && ('success' in value || Object.keys(value).length === 1)) return value.data as T;
  }
  return payload as T;
}

function errorMessage(payload: unknown, fallback: string) {
  const value = record(payload);
  return String(value.message || value.error || value.code || fallback);
}

export function fileReference(file: Pick<FileObject, 'id' | 'provider' | 'mount' | 'storageMount' | 'path'>) {
  return {
    id: file.id,
    provider: providerId(file.provider),
    mount: stringValue(file.mount, 'project'),
    storageMount: stringValue(file.storageMount) || undefined,
    path: relativeVirtualPath(file.path),
  };
}

function normalizeAction(action: string) {
  const aliases: Record<string, string> = {
    delete_permanently: 'permanent-delete',
    permanent_delete: 'permanent-delete',
    make_public: 'make-public',
    make_private: 'make-private',
    empty_trash: 'empty-trash',
  };
  return aliases[action] || action.replace(/_/g, '-');
}

export class FileSystemApi {
  readonly config: KodetyFileSystemConfig;
  readonly baseUrl: string;

  constructor(config: KodetyFileSystemConfig) {
    this.config = config;
    this.baseUrl = config.restUrl.replace(/\/+$/, '');
  }

  url(endpoint: string, query?: Record<string, string | number | boolean | undefined | null>) {
    const absolute = /^https?:\/\//i.test(endpoint);
    const base = absolute ? endpoint : `${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`;
    const url = new URL(base, window.location.href);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  async request<T>(endpoint: string, init: RequestInit = {}, query?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
    const headers = new Headers(this.config.requestHeaders || {});
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (this.config.nonce) headers.set('X-WP-Nonce', this.config.nonce);
    headers.set('X-Requested-With', 'XMLHttpRequest');
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const requestUrl = this.url(endpoint, query);
    const credentials = new URL(requestUrl).origin === window.location.origin ? 'same-origin' : 'include';
    const response = await fetch(requestUrl, { cache: 'no-store', ...init, credentials: init.credentials || credentials, headers });
    if (response.status === 204) return undefined as T;
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
    if (!response.ok) {
      const code = stringValue(record(payload).code) || undefined;
      throw new FileSystemApiError(errorMessage(payload, `A operação falhou (${response.status}).`), response.status, code, payload);
    }
    return unwrap<T>(payload);
  }

  async optional<T>(request: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof FileSystemApiError && error.unsupported) return fallback;
      throw error;
    }
  }

  bootstrap() {
    return this.request<unknown>('/bootstrap').then(value => {
      const normalized = normalizeBootstrap(value);
      if (!normalized.user && this.config.user) normalized.user = this.config.user;
      normalized.capabilities = normalizeCapabilities({ ...this.config.capabilities, ...normalized.capabilities });
      return normalized;
    });
  }

  files(params: { mount: string; storageMount?: string; provider?: string; path: string; query?: string; scope?: FileScope; cursor?: string }) {
    const provider = providerId(params.provider);
    const path = relativeVirtualPath(params.path);
    const endpoint = params.scope === 'recent' ? '/recent' : params.scope === 'trash' ? '/trash' : '/files';
    const query = endpoint === '/files' ? {
      provider,
      mount: params.mount,
      storageMount: params.storageMount,
      path,
      query: params.query,
      scope: params.scope === 'favorites' || params.query ? 'recursive' : 'folder',
      cursor: params.cursor,
    } : undefined;
    return this.request<unknown>(endpoint, {}, query).then(value => {
      const raw = record(value);
      const source = Array.isArray(value) ? value : Array.isArray(raw.items) ? raw.items : Array.isArray(raw.files) ? raw.files : [];
      let files = source.map((item, index) => normalizeFileObject(item, params.mount, index));
      if (params.scope === 'favorites') files = files.filter(file => file.favorite);
      return {
        files,
        mount: stringValue(raw.mount, params.mount),
        storageMount: stringValue(raw.storageMount ?? raw.storage_mount, params.storageMount) || undefined,
        path: relativeVirtualPath(raw.path ?? path),
        total: numberValue(raw.total) ?? files.length,
        nextCursor: stringValue(raw.nextCursor ?? raw.next_cursor) || null,
      } satisfies FileListResult;
    });
  }

  create(payload: { kind: 'file' | 'folder'; name: string; mount: string; storageMount?: string; provider?: string; path: string }) {
    return this.request<unknown>('/files', {
      method: 'POST',
      body: JSON.stringify({ ...payload, provider: providerId(payload.provider), path: relativeVirtualPath(payload.path) }),
    }).then(value => normalizeFileObject(value, payload.mount));
  }

  operation(action: string, payload: Record<string, unknown>) {
    return this.request<unknown>('/operations', {
      method: 'POST',
      body: JSON.stringify({ ...payload, action: normalizeAction(action) }),
    });
  }

  content(file: FileObject) {
    return this.request<{ content?: string } | string>('/content', {}, fileReference(file)).then(result => (
      typeof result === 'string' ? result : result.content || ''
    ));
  }

  saveContent(file: FileObject, content: string, checksum?: string | null) {
    return this.request<unknown>('/content', {
      method: 'PUT',
      body: JSON.stringify({ ...fileReference(file), content, checksum }),
    }).then(value => {
      const raw = record(value);
      return normalizeFileObject(raw.item ?? raw.file ?? value, file.mount);
    });
  }

  versions(file: FileObject) {
    return this.optional(() => this.request<unknown>('/versions', {}, fileReference(file)).then(normalizeVersions), [] as AssetVersion[]);
  }

  restoreVersion(versionId: string) {
    return this.request<unknown>('/versions/restore', { method: 'POST', body: JSON.stringify({ id: versionId }) });
  }

  async download(file: FileObject) {
    if (providerId(file.provider) === 'remote') {
      throw new FileSystemApiError('Downloads remotos ainda não são suportados por este adaptador.', 501);
    }
    const href = this.url('/download', {
      ...fileReference(file),
      _wpnonce: this.config.nonce,
    });
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = file.name;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  metadata(file: FileObject, metadata: { favorite?: boolean; tags?: string[] }) {
    return this.request<unknown>('/metadata', {
      method: 'POST',
      body: JSON.stringify({ ...fileReference(file), ...metadata }),
    });
  }

  activity() {
    return this.optional(() => this.request<unknown>('/activity').then(normalizeActivity), [] as ActivityEntry[]);
  }

  rescan(mount: string, path = '') {
    return this.request<{ queued?: boolean; message?: string }>('/rescan', {
      method: 'POST',
      body: JSON.stringify({ mount, path: relativeVirtualPath(path) }),
    });
  }

  getSettings() {
    return this.optional(() => this.request<FileSystemSettings>('/settings'), {} as FileSystemSettings);
  }

  saveSettings(settings: FileSystemSettings) {
    return this.request<FileSystemSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) });
  }

  upload(file: File, payload: { mount: string; storageMount?: string; provider?: string; path: string; replace?: FileObject }, signal?: AbortSignal) {
    const form = new FormData();
    form.set('file', file, file.name);
    form.set('provider', providerId(payload.replace?.provider || payload.provider));
    form.set('mount', payload.replace?.mount || payload.mount);
    const storageMount = payload.replace?.storageMount || payload.storageMount;
    if (storageMount) form.set('storageMount', storageMount);
    form.set('path', relativeVirtualPath(payload.replace ? payload.replace.path.split('/').slice(0, -1).join('/') : payload.path));
    if (payload.replace) {
      form.set('name', payload.replace.name);
			form.set('replaceId', payload.replace.id);
    }
    return this.request<unknown>('/upload', { method: 'POST', body: form, signal }).then(value => {
      const raw = record(value);
      const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.files) ? raw.files : [];
      if (items.length) return normalizeFileObject(items[0], payload.replace?.mount || payload.mount);
      if (Object.keys(raw).length) return normalizeFileObject(raw, payload.replace?.mount || payload.mount);
      throw new FileSystemApiError('O servidor não retornou o arquivo enviado.', 502);
    });
  }

  initializeUpload(file: File, payload: { mount: string; storageMount?: string; provider?: string; path: string; chunkSize?: number }, signal?: AbortSignal) {
    return this.request<{ id?: string; uploadId?: string; received?: number[]; chunkSize?: number }>('/uploads/init', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        mount: payload.mount,
        storageMount: payload.storageMount,
        provider: providerId(payload.provider),
        path: relativeVirtualPath(payload.path),
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        chunkSize: payload.chunkSize,
      }),
    }).then(result => ({ ...result, uploadId: result.uploadId || result.id || '' }));
  }

  uploadChunk(uploadId: string, chunk: Blob, start: number, end: number, total: number, index: number, signal?: AbortSignal) {
    return this.request<{ received?: number[]; uploadedBytes?: number }>(`/uploads/${encodeURIComponent(uploadId)}/chunk`, {
      method: 'PUT',
      body: chunk,
      signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end - 1}/${total}`,
        'X-Chunk-Index': String(index),
      },
    }, { index });
  }

  completeUpload(uploadId: string) {
    return this.request<unknown>(`/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ id: uploadId }),
    }).then(value => {
      const raw = record(value);
      return normalizeFileObject(raw.item ?? raw.file ?? value);
    });
  }

  uploadStatus(uploadId: string, signal?: AbortSignal) {
    return this.request<{ id?: string; uploadId?: string; size?: number; chunkSize?: number; uploadedBytes?: number; received?: number[] }>(
      `/uploads/${encodeURIComponent(uploadId)}`,
      { signal },
    );
  }

  abortUpload(uploadId: string) {
    return this.request<{ id?: string; aborted?: boolean }>(`/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
    });
  }
}

export function getFileSystemConfig(): KodetyFileSystemConfig {
  let source: unknown = window.KodetyFileSystemConfig;
  if (!source) {
    const configElement = document.getElementById('kodety-fs-config');
    if (configElement?.textContent) {
      try {
        source = JSON.parse(configElement.textContent);
      } catch {
        source = undefined;
      }
    }
  }
  const raw = record(source);
  const config: KodetyFileSystemConfig = {
    restUrl: stringValue(raw.restUrl ?? raw.rest_url, '/wp-json/kodety-file-system/v1'),
    nonce: stringValue(raw.nonce) || undefined,
    version: stringValue(raw.version) || undefined,
    appUrl: stringValue(raw.appUrl ?? raw.app_url) || undefined,
    queryFallback: stringValue(raw.queryFallback ?? raw.query_fallback) || undefined,
    dashboardUrl: stringValue(raw.dashboardUrl ?? raw.dashboard_url) || undefined,
    fileSystemUrl: stringValue(raw.fileSystemUrl ?? raw.file_system_url ?? raw.appUrl) || undefined,
    brandLogoUrl: stringValue(raw.brandLogoUrl ?? raw.brand_logo_url) || undefined,
    siteName: stringValue(raw.siteName ?? raw.site_name) || undefined,
    projectId: typeof raw.projectId === 'string' || typeof raw.projectId === 'number' ? raw.projectId : undefined,
    capabilities: normalizeCapabilities(raw.capabilities),
    urls: record(raw.urls) as Record<string, string>,
    labels: record(raw.labels) as Record<string, string>,
    requestHeaders: record(raw.requestHeaders ?? raw.request_headers) as Record<string, string>,
    user: raw.user ? {
      id: stringValue(record(raw.user).id) || numberValue(record(raw.user).id),
      name: stringValue(record(raw.user).name) || undefined,
      avatarUrl: stringValue(record(raw.user).avatarUrl ?? record(raw.user).avatar_url) || undefined,
    } : undefined,
    features: Object.fromEntries(Object.entries(record(raw.features)).map(([key, value]) => [key, boolean(value)])),
    initialBootstrap: raw.initialBootstrap ? normalizeBootstrap(raw.initialBootstrap) : undefined,
  };
  window.KodetyFileSystemConfig = config;
  return config;
}
