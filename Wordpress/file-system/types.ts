export type FileVisibility = 'public' | 'private' | 'shared';
export type FileKind = 'file' | 'folder';
export type FileScope = 'files' | 'recent' | 'favorites' | 'trash' | 'activity';
export type ViewMode = 'grid' | 'list';
export type SortKey = 'name' | 'modified' | 'size' | 'type';

export interface FilePermissions {
  read?: boolean;
  write?: boolean;
  create?: boolean;
  upload?: boolean;
  delete?: boolean;
  move?: boolean;
  share?: boolean;
  visibility?: boolean;
  editCode?: boolean;
  versions?: boolean;
}

export interface AssetUsage {
  id?: string;
  label: string;
  location?: string;
  url?: string;
}

export interface FileObject {
  id: string;
  name: string;
  path: string;
  kind: FileKind;
  extension?: string;
  mimeType?: string;
  size?: number;
  provider?: string;
  mount?: string;
  /** Provider-owned mount retained when `mount` is the virtual `remote` mount. */
  storageMount?: string;
  visibility?: FileVisibility;
  publicUrl?: string | null;
  previewUrl?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  checksum?: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string | { id?: string; name?: string };
  tags?: string[];
  favorite?: boolean;
  version?: number | string;
  permissions?: FilePermissions;
  usages?: AssetUsage[];
  deletedAt?: string | null;
  originalPath?: string | null;
}

export interface StorageMount {
  id: string;
  name: string;
  label?: string;
  provider: 'filesystem' | 'wordpress' | 's3' | 'r2' | 'sftp' | 'webdav' | string;
  /** Provider-owned mount when `id` is a virtual adapter mount such as `remote`. */
  storageMount?: string;
  root?: string;
  description?: string;
  status?: 'online' | 'offline' | 'degraded' | string;
  readOnly?: boolean;
  visibility?: FileVisibility;
  quota?: { used?: number; total?: number };
  permissions?: FilePermissions;
}

export interface AssetVersion {
  id: string;
  version?: string | number;
  createdAt?: string;
  createdBy?: string;
  size?: number;
  checksum?: string;
  current?: boolean;
}

export interface ActivityEntry {
  id: string;
  action: string;
  message?: string;
  actor?: string;
  assetName?: string;
  provider?: string;
  mount?: string;
  path?: string;
  createdAt?: string;
  before?: unknown;
  after?: unknown;
}

export interface FileSystemCapabilities extends FilePermissions {
  edit?: boolean;
  upload?: boolean;
  managePrivate?: boolean;
  manageStorage?: boolean;
  dangerousFileEditing?: boolean;
  rescan?: boolean;
  archive?: boolean;
  activity?: boolean;
  purge?: boolean;
}

export interface FileSystemUser {
  id?: string | number;
  name?: string;
  avatarUrl?: string;
}

export interface FileSystemBootstrap {
  mounts: StorageMount[];
  files?: FileObject[];
  providers?: Array<{ id: string; label?: string; name?: string; capabilities?: Record<string, boolean> }>;
  currentMount?: string;
  currentStorageMount?: string;
  currentPath?: string;
  capabilities?: FileSystemCapabilities;
  user?: FileSystemUser;
  project?: { id?: string | number; name?: string };
  features?: Record<string, boolean>;
  storage?: {
    publicAvailable?: boolean;
    privateAvailable?: boolean;
    status?: string;
    warning?: string | null;
  };
  limits?: {
    maxUploadBytes?: number;
    maxEditBytes?: number;
    chunkThresholdBytes?: number;
    chunkSizeBytes?: number;
  };
}

export interface FileListResult {
  files: FileObject[];
  storageMount?: string;
  path?: string;
  mount?: string;
  total?: number;
  nextCursor?: string | null;
}

export interface FileSystemSettings {
  mode?: 'local' | 'remote';
  remote_url?: string;
  remote_token?: string;
  remote_token_set?: boolean;
  clear_remote_token?: boolean;
	remote_signing_secret?: string;
	remote_signing_secret_set?: boolean;
	clear_remote_signing_secret?: boolean;
  backendMode?: 'wordpress' | 'remote';
  backendUrl?: string;
  publicBaseUrl?: string;
  defaultMount?: string;
  chunkSizeMb?: number;
  versioning?: boolean;
  trashRetentionDays?: number;
  sanitizeSvg?: boolean;
  allowedExtensions?: string[];
  [key: string]: unknown;
}

export interface KodetyFileSystemConfig {
  restUrl: string;
  nonce?: string;
  version?: string;
  appUrl?: string;
  queryFallback?: string;
  dashboardUrl?: string;
  fileSystemUrl?: string;
  brandLogoUrl?: string;
  siteName?: string;
  projectId?: string | number;
  capabilities?: FileSystemCapabilities;
  urls?: Record<string, string>;
  labels?: Record<string, string>;
  user?: FileSystemUser;
  features?: Record<string, boolean>;
  requestHeaders?: Record<string, string>;
  initialBootstrap?: FileSystemBootstrap;
}

export type UploadStatus =
  | 'queued'
  | 'initializing'
  | 'uploading'
  | 'paused'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadTask {
  id: string;
  file: File;
  mount: string;
  provider?: string;
  storageMount?: string;
  path: string;
  progress: number;
  status: UploadStatus;
  uploadedBytes: number;
  uploadId?: string;
  chunkSize?: number;
  error?: string;
}

export interface SearchQuery {
  text: string;
  type?: string;
  extension?: string;
  visibility?: FileVisibility;
  minSize?: number;
  maxSize?: number;
  modified?: string;
  tags?: string[];
}

declare global {
  interface Window {
    KodetyFileSystemConfig?: KodetyFileSystemConfig;
  }
}
