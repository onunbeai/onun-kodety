import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { FileIcon } from '@solar-icons/react/bold-duotone/file';
import { HistoryIcon } from '@solar-icons/react/bold-duotone/history';
import { StarIcon } from '@solar-icons/react/bold-duotone/star';
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold-duotone/trash-bin-minimalistic';
import { ServerIcon } from '@solar-icons/react/bold-duotone/server';
import { CloudIcon } from '@solar-icons/react/bold-duotone/cloud';
import { GlobalIcon } from '@solar-icons/react/bold-duotone/global';
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Eye,
  Filter,
  Folder,
  FolderOpen,
  Grid2X2,
  History,
  List,
  Loader2,
  Lock,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  Star,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  X,
} from '../../components/ui/gravity-icons';
import {
  FileSystemApi,
  FileSystemApiError,
  fileReference,
  getFileSystemConfig,
  normalizeFileObject,
  normalizeMount,
  relativeVirtualPath,
} from './api';
import type {
  AssetVersion,
  FileObject,
  FileScope,
  FileSystemBootstrap,
  FileSystemCapabilities,
  SortKey,
  StorageMount,
  ViewMode,
  UploadTask,
} from './types';
import {
  extensionOf,
  canEdit,
  fileKey,
  formatBytes,
  formatDate,
  isDangerousCodeFile,
  joinPath,
  matchesSearch,
  parentPath,
  parseSearchQuery,
  pathSegments,
  sortFiles,
} from './utils';
import { FilePreview } from './components/FilePreview';
import { ActivityModal } from './components/ActivityModal';
import { CodeEditorModal } from './components/CodeEditorModal';
import { SettingsModal } from './components/SettingsModal';
import {
  Button,
  EmptyState,
  FileGlyph,
  IconButton,
  KeyValue,
  KodetyMark,
  Modal,
  Pill,
  SectionLabel,
  Spinner,
  TextInput,
} from './components/ui';

type DialogKind = 'folder' | 'file' | 'rename' | 'move' | 'tags' | 'delete' | null;
type ClipboardState = { mode: 'copy' | 'cut'; files: FileObject[] } | null;
type Toast = { id: string; tone: 'neutral' | 'success' | 'danger'; message: string };

interface Location {
  mount: string;
  storageMount?: string;
  path: string;
  scope: FileScope;
}

const FALLBACK_MOUNTS: StorageMount[] = [
  { id: 'project', name: 'Project files', provider: 'local', status: 'online' },
  { id: 'public', name: 'Public', provider: 'local', visibility: 'public', status: 'online' },
  { id: 'private', name: 'Private', provider: 'local', visibility: 'private', status: 'online' },
  { id: 'media', name: 'WordPress Media', provider: 'wordpress-media', status: 'online' },
  { id: 'remote', name: 'Remote storage', provider: 'remote', status: 'offline', readOnly: true },
];

const scopeItems: Array<{ id: FileScope; label: string; icon: typeof FileIcon }> = [
  { id: 'files', label: 'Files', icon: FileIcon },
  { id: 'recent', label: 'Recent', icon: HistoryIcon },
  { id: 'favorites', label: 'Favorites', icon: StarIcon },
  { id: 'trash', label: 'Trash', icon: TrashBinMinimalisticIcon },
];

function makeId(prefix: string) {
  return typeof crypto?.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mountIcon(mount: StorageMount) {
  if (mount.provider === 'wordpress-media') return <GlobalIcon />;
  if (['s3', 'r2', 'webdav', 'remote'].includes(mount.provider)) return <CloudIcon />;
  return <ServerIcon />;
}

function normalizeFiles(files: FileObject[], mount: string): FileObject[] {
  return files.map((file, index) => normalizeFileObject(file, mount, index));
}

export default function FileSystemApp() {
  const config = useMemo(() => getFileSystemConfig(), []);
  const api = useMemo(() => new FileSystemApi(config), [config]);
  const [bootstrap, setBootstrap] = useState<FileSystemBootstrap | null>(config.initialBootstrap || null);
  const [mounts, setMounts] = useState<StorageMount[]>(config.initialBootstrap?.mounts?.length ? config.initialBootstrap.mounts.map(normalizeMount) : FALLBACK_MOUNTS);
  const [mount, setMount] = useState(config.initialBootstrap?.currentMount || config.initialBootstrap?.mounts?.[0]?.id || 'project');
  const [storageMount, setStorageMount] = useState(config.initialBootstrap?.currentStorageMount || '');
  const [path, setPath] = useState(relativeVirtualPath(config.initialBootstrap?.currentPath));
  const [scope, setScope] = useState<FileScope>('files');
  const [files, setFiles] = useState<FileObject[]>(normalizeFiles(config.initialBootstrap?.files || [], mount));
  const [loading, setLoading] = useState(!config.initialBootstrap);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>(() => localStorage.getItem('kodety-files-view') === 'list' ? 'list' : 'grid');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileObject | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number; file: FileObject } | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [clipboard, setClipboard] = useState<ClipboardState>(null);
  const [uploading, setUploading] = useState<UploadTask[]>([]);
  const [editorFile, setEditorFile] = useState<FileObject | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [versions, setVersions] = useState<AssetVersion[]>([]);
  const [history, setHistory] = useState<Location[]>([{ mount, storageMount, path, scope: 'files' }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<FileObject | null>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  const uploadTasksRef = useRef<UploadTask[]>([]);
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const uploadIntentsRef = useRef<Map<string, 'pause' | 'cancel' | 'restart'>>(new Map());
  const pendingUploadTasksRef = useRef<UploadTask[]>([]);
  const pendingUploadIdsRef = useRef<Set<string>>(new Set());
  const activeUploadIdsRef = useRef<Set<string>>(new Set());
  const pumpUploadQueueRef = useRef<() => void>(() => undefined);
  const locationRef = useRef<Location>({ mount, storageMount, path, scope });
  locationRef.current = { mount, storageMount, path, scope };

  const capabilities: FileSystemCapabilities = {
    ...config.capabilities,
    ...bootstrap?.capabilities,
  };
  const activeMount = mounts.find(item => item.id === mount) || mounts[0];
  const chosenFiles = files.filter(file => selected.has(fileKey(file)));
  const chosen = chosenFiles[0] || null;
  const query = useMemo(() => parseSearchQuery(search), [search]);
  const visibleFiles = useMemo(
    () => sortFiles(files.filter(file => matchesSearch(file, query)), sortKey, sortDirection),
    [files, query, sortDirection, sortKey],
  );

  const can = useCallback((key: keyof FileSystemCapabilities) => capabilities[key] !== false, [capabilities]);
  const canDeleteSelection = scope === 'trash'
    ? can('purge')
    : can('delete') && chosenFiles.every(file => {
        const descriptor = mounts.find(item => item.id === (file.mount || mount));
        return file.permissions?.delete !== false && descriptor?.permissions?.delete !== false;
      });

  const updateUploadTasks = useCallback((updater: (current: UploadTask[]) => UploadTask[]) => {
    setUploading(current => {
      const next = updater(current);
      uploadTasksRef.current = next;
      return next;
    });
  }, []);

  const patchUploadTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    updateUploadTasks(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }, [updateUploadTasks]);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'neutral') => {
    const id = makeId('toast');
    setToasts(current => [...current.slice(-3), { id, tone, message }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 4200);
  }, []);

  const loadFiles = useCallback(async (nextMount = mount, nextPath = path, nextScope = scope, quiet = false, nextStorageMount = storageMount) => {
    if (!nextMount) return;
    if (!quiet) setLoading(true);
    setNotice('');
    try {
      const descriptor = mounts.find(item => item.id === nextMount);
      const result = await api.files({
        mount: nextMount,
        storageMount: nextStorageMount || descriptor?.storageMount,
        provider: descriptor?.provider,
        path: relativeVirtualPath(nextPath),
        query: parseSearchQuery(search).text,
        scope: nextScope,
      });
      setFiles(normalizeFiles(result.files || [], nextMount));
      setSelected(new Set());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível carregar os arquivos.';
      setNotice(message);
      if (!(bootstrap?.files?.length)) setFiles([]);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api, bootstrap?.files, mount, mounts, path, scope, search, storageMount]);

  useEffect(() => {
    let active = true;
    if (config.initialBootstrap) {
      setLoading(false);
      void loadFiles(mount, path, scope, true, storageMount);
      return () => { active = false; };
    }
    api.bootstrap()
      .then(result => {
        if (!active) return;
        setBootstrap(result);
        setStorageWarning(result.storage?.warning || '');
        const nextMounts = result.mounts?.length ? result.mounts : FALLBACK_MOUNTS;
        const nextMount = result.currentMount || nextMounts[0]?.id || 'project';
        const nextStorageMount = result.currentStorageMount || nextMounts.find(item => item.id === nextMount)?.storageMount || '';
        const nextPath = relativeVirtualPath(result.currentPath);
        setMounts(nextMounts);
        setMount(nextMount);
        setStorageMount(nextStorageMount);
        setPath(nextPath);
        setFiles(normalizeFiles(result.files || [], nextMount));
        setHistory([{ mount: nextMount, storageMount: nextStorageMount, path: nextPath, scope: 'files' }]);
        setHistoryIndex(0);
        void loadFiles(nextMount, nextPath, 'files', true, nextStorageMount);
      })
      .catch(error => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : 'O backend de arquivos não respondeu.');
        setMounts(FALLBACK_MOUNTS);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  // Bootstrap must run once for this authenticated document.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFiles(mount, path, scope, true, storageMount), 260);
    return () => window.clearTimeout(timer);
  // Server-side search is debounced; client filtering is immediate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    localStorage.setItem('kodety-files-view', view);
  }, [view]);

  useEffect(() => {
    let active = true;
    setVersions([]);
    if (!chosen || chosen.kind === 'folder') return () => { active = false; };
    api.versions(chosen).then(items => active && setVersions(items)).catch(() => undefined);
    return () => { active = false; };
  }, [api, chosen?.id, chosen?.kind]);

  const go = useCallback((location: Location, push = true) => {
    const descriptor = mounts.find(item => item.id === location.mount);
    const nextLocation = {
      ...location,
      storageMount: location.storageMount ?? (location.mount === mount ? storageMount : descriptor?.storageMount || ''),
      path: relativeVirtualPath(location.path),
    };
    setMount(nextLocation.mount);
    setStorageMount(nextLocation.storageMount || '');
    setPath(nextLocation.path);
    setScope(nextLocation.scope);
    setContext(null);
    setSelected(new Set());
    setNavOpen(false);
    if (push) {
      setHistory(current => {
        const next = [...current.slice(0, historyIndex + 1), nextLocation];
        setHistoryIndex(next.length - 1);
        return next;
      });
    }
    void loadFiles(nextLocation.mount, nextLocation.path, nextLocation.scope, false, nextLocation.storageMount);
  }, [historyIndex, loadFiles, mount, mounts, storageMount]);

  const goHistory = (index: number) => {
    const location = history[index];
    if (!location) return;
    setHistoryIndex(index);
    go(location, false);
  };

  const openFile = (file: FileObject) => {
    if (file.kind === 'folder') {
      go({ mount: file.mount || mount, storageMount: file.storageMount || storageMount, path: file.path || joinPath(path, file.name), scope: 'files' });
      return;
    }
    setPreviewFile(file);
  };

  const openEditor = (file: FileObject) => {
    if (!canEdit(file)) {
      toast('Este tipo de arquivo não pode ser editado como texto.', 'danger');
      return;
    }
    if (!can('editCode') || !can('write')) {
      toast('Sua função não possui a permissão kodety_files_edit_code.', 'danger');
      return;
    }
    if (isDangerousCodeFile(file) && !can('dangerousFileEditing')) {
      toast('A edição deste tipo sensível precisa ser habilitada no wp-config.php.', 'danger');
      return;
    }
    setContext(null);
    setPreviewFile(null);
    setEditorFile(file);
  };

  const selectFile = (file: FileObject, event: ReactMouseEvent) => {
    const id = fileKey(file);
    if (event.shiftKey && selectionAnchor) {
      const start = visibleFiles.findIndex(item => fileKey(item) === selectionAnchor);
      const end = visibleFiles.findIndex(item => fileKey(item) === id);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        setSelected(new Set(visibleFiles.slice(from, to + 1).map(fileKey)));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelected(current => {
        const next = new Set(current);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
    setSelectionAnchor(id);
  };

  const run = useCallback(async (label: string, task: () => Promise<unknown>, refresh = true) => {
    setBusy(label);
    try {
      await task();
      toast(`${label} concluído.`, 'success');
      if (refresh) await loadFiles(mount, path, scope, true, storageMount);
    } catch (error) {
      const message = error instanceof FileSystemApiError && error.unsupported
        ? 'Este backend ainda não oferece essa operação.'
        : error instanceof Error ? error.message : `Não foi possível concluir: ${label}.`;
      toast(message, 'danger');
    } finally {
      setBusy('');
      setContext(null);
    }
  }, [api, loadFiles, mount, path, scope, storageMount, toast]);

  const openDialog = (kind: Exclude<DialogKind, null>, value = '') => {
    setDialogValue(value);
    setDialog(kind);
    setContext(null);
  };

  const submitDialog = async () => {
    const value = dialogValue.trim();
    if (dialog === 'delete') {
      if (!canDeleteSelection) {
        setDialog(null);
        toast(scope === 'trash' ? 'Sua função não pode excluir arquivos permanentemente.' : 'Este storage não oferece uma lixeira segura.', 'danger');
        return;
      }
      setDialog(null);
      await run(
        scope === 'trash' ? 'Excluir permanentemente' : 'Mover para a lixeira',
        () => Promise.all(chosenFiles.map(file => api.operation(
          scope === 'trash' ? 'permanent-delete' : 'delete',
          { ...fileReference(file), id: file.id },
        ))),
      );
      return;
    }
    if (!value) return;
    const current = chosenFiles[0];
    const activeDialog = dialog;
    setDialog(null);
    if (activeDialog === 'folder' || activeDialog === 'file') {
      await run(activeDialog === 'folder' ? 'Criar pasta' : 'Criar arquivo', () => api.create({ kind: activeDialog, name: value, mount, storageMount: storageMount || activeMount?.storageMount, provider: activeMount?.provider, path }));
    } else if (activeDialog === 'rename' && current) {
      await run('Renomear', () => api.operation('rename', { ...fileReference(current), name: value }));
    } else if (activeDialog === 'move') {
      const destination = relativeVirtualPath(value);
      await run('Mover', () => Promise.all(chosenFiles.map(file => api.operation('move', {
        ...fileReference(file),
        toMount: mount,
        toStorageMount: storageMount || activeMount?.storageMount,
        toPath: joinPath(destination, file.name),
      }))));
    } else if (activeDialog === 'tags') {
      await run('Atualizar tags', () => Promise.all(chosenFiles.map(file => api.metadata(file, { tags: value.split(',').map(tag => tag.trim()).filter(Boolean), favorite: file.favorite }))));
    }
  };

  const startUpload = useCallback(async (initialTask: UploadTask) => {
    const id = initialTask.id;
    const file = initialTask.file;
    const threshold = Math.max(1, bootstrap?.limits?.chunkThresholdBytes || 8 * 1024 * 1024);
    const configuredChunkSize = Math.max(256 * 1024, bootstrap?.limits?.chunkSizeBytes || 5 * 1024 * 1024);
    const chunkFeature = bootstrap?.features?.chunks ?? config.features?.chunkUpload ?? true;
    const localChunkProvider = !initialTask.provider || ['local', 'filesystem', 'backend-filesystem'].includes(initialTask.provider);
    const useChunks = localChunkProvider && file.size > threshold && chunkFeature !== false;
    uploadIntentsRef.current.delete(id);
    patchUploadTask(id, { status: useChunks ? 'initializing' : 'uploading', error: undefined });

    const refreshUploadLocation = async () => {
      const current = locationRef.current;
      if (current.scope === 'files' && current.mount === initialTask.mount && current.path === initialTask.path) {
        await loadFiles(current.mount, current.path, current.scope, true, current.storageMount);
      }
    };

    const directUpload = async () => {
      const controller = new AbortController();
      uploadControllersRef.current.set(id, controller);
      patchUploadTask(id, { status: 'uploading', progress: 0, uploadedBytes: 0 });
      await api.upload(file, {
        mount: initialTask.mount,
        storageMount: initialTask.storageMount,
        provider: initialTask.provider,
        path: initialTask.path,
      }, controller.signal);
      patchUploadTask(id, { status: 'done', progress: 100, uploadedBytes: file.size });
    };

    let activeUploadId = initialTask.uploadId;
    try {
      if (!useChunks) {
        await directUpload();
      } else {
        let uploadId = activeUploadId;
        let chunkSize = initialTask.chunkSize || configuredChunkSize;
        let uploadedBytes = Math.min(initialTask.uploadedBytes, file.size);
        let received = new Set<number>();

        if (!uploadId) {
          const controller = new AbortController();
          uploadControllersRef.current.set(id, controller);
          try {
            const session = await api.initializeUpload(file, {
              mount: initialTask.mount,
              storageMount: initialTask.storageMount,
              provider: initialTask.provider,
              path: initialTask.path,
              chunkSize,
            }, controller.signal);
            if (!session.uploadId) throw new FileSystemApiError('O backend não retornou uma sessão de upload.', 502);
            uploadId = session.uploadId;
            activeUploadId = uploadId;
            chunkSize = Math.max(256 * 1024, session.chunkSize || chunkSize);
            received = new Set((session.received || []).filter(Number.isInteger));
            patchUploadTask(id, { uploadId, chunkSize, status: 'uploading' });
          } catch (reason) {
            if (reason instanceof FileSystemApiError && reason.unsupported) {
              await directUpload();
              await refreshUploadLocation();
              return;
            }
            throw reason;
          }
        } else {
          const controller = new AbortController();
          uploadControllersRef.current.set(id, controller);
          const status = await api.uploadStatus(uploadId, controller.signal);
          if (typeof status.size === 'number' && status.size !== file.size) {
            throw new FileSystemApiError('A sessão existente não corresponde a este arquivo.', 409);
          }
          chunkSize = Math.max(256 * 1024, status.chunkSize || chunkSize);
          received = new Set((status.received || []).filter(Number.isInteger));
          uploadedBytes = Math.min(file.size, Math.max(0, status.uploadedBytes || 0));
          patchUploadTask(id, {
            status: 'uploading',
            chunkSize,
            uploadedBytes,
            progress: file.size ? Math.round((uploadedBytes / file.size) * 100) : 100,
          });
        }

        const initializedIntent = uploadIntentsRef.current.get(id);
        if (initializedIntent === 'pause' || initializedIntent === 'restart') {
          patchUploadTask(id, { status: initializedIntent === 'restart' ? 'queued' : 'paused' });
          return;
        }
        if (initializedIntent === 'cancel') {
          await api.abortUpload(uploadId).catch(() => undefined);
          patchUploadTask(id, { status: 'cancelled', uploadId: undefined, uploadedBytes: 0, progress: 0 });
          return;
        }

        const chunkCount = Math.ceil(file.size / chunkSize);
        for (let index = 0; index < chunkCount; index += 1) {
          if (received.has(index)) continue;
          const intent = uploadIntentsRef.current.get(id);
          if (intent === 'pause' || intent === 'restart') {
            patchUploadTask(id, { status: intent === 'restart' ? 'queued' : 'paused' });
            return;
          }
          if (intent === 'cancel') {
            await api.abortUpload(uploadId).catch(() => undefined);
            patchUploadTask(id, { status: 'cancelled', uploadId: undefined, uploadedBytes: 0, progress: 0 });
            return;
          }
          const start = index * chunkSize;
          const end = Math.min(file.size, start + chunkSize);
          const controller = new AbortController();
          uploadControllersRef.current.set(id, controller);
          const result = await api.uploadChunk(uploadId, file.slice(start, end), start, end, file.size, index, controller.signal);
          received.add(index);
          uploadedBytes = Math.min(file.size, Math.max(0, result.uploadedBytes || uploadedBytes + (end - start)));
          patchUploadTask(id, {
            status: 'uploading',
            uploadedBytes,
            progress: file.size ? Math.round((uploadedBytes / file.size) * 100) : 100,
          });
        }
        const completionIntent = uploadIntentsRef.current.get(id);
        if (completionIntent === 'pause' || completionIntent === 'restart') {
          patchUploadTask(id, { status: completionIntent === 'restart' ? 'queued' : 'paused' });
          return;
        }
        if (completionIntent === 'cancel') {
          await api.abortUpload(uploadId).catch(() => undefined);
          patchUploadTask(id, { status: 'cancelled', uploadId: undefined, uploadedBytes: 0, progress: 0 });
          return;
        }
        await api.completeUpload(uploadId);
        patchUploadTask(id, { status: 'done', progress: 100, uploadedBytes: file.size });
      }
      await refreshUploadLocation();
    } catch (reason) {
      const intent = uploadIntentsRef.current.get(id);
      if (intent === 'pause' || intent === 'restart') {
        patchUploadTask(id, { status: intent === 'restart' ? 'queued' : 'paused' });
      } else if (intent === 'cancel') {
        if (activeUploadId) await api.abortUpload(activeUploadId).catch(() => undefined);
        patchUploadTask(id, { status: 'cancelled', uploadId: undefined, uploadedBytes: 0, progress: 0 });
      } else {
        const message = reason instanceof Error ? reason.message : `Falha ao enviar ${file.name}.`;
        patchUploadTask(id, { status: 'error', error: message });
        toast(message, 'danger');
      }
    } finally {
      uploadControllersRef.current.delete(id);
    }
  }, [api, bootstrap?.features?.chunks, bootstrap?.limits?.chunkSizeBytes, bootstrap?.limits?.chunkThresholdBytes, config.features?.chunkUpload, loadFiles, patchUploadTask, toast]);

  const pumpUploadQueue = useCallback(() => {
    while (activeUploadIdsRef.current.size < 3 && pendingUploadTasksRef.current.length > 0) {
      const runnableIndex = pendingUploadTasksRef.current.findIndex(task => !activeUploadIdsRef.current.has(task.id));
      if (runnableIndex < 0) break;
      const [task] = pendingUploadTasksRef.current.splice(runnableIndex, 1);
      if (!task) break;
      pendingUploadIdsRef.current.delete(task.id);
      const intent = uploadIntentsRef.current.get(task.id);
      if (intent === 'pause' || intent === 'cancel') continue;
      activeUploadIdsRef.current.add(task.id);
      void startUpload(task).finally(() => {
        activeUploadIdsRef.current.delete(task.id);
        pumpUploadQueueRef.current();
      });
    }
  }, [startUpload]);
  pumpUploadQueueRef.current = pumpUploadQueue;

  const enqueueUploadTask = useCallback((task: UploadTask) => {
    if (pendingUploadIdsRef.current.has(task.id)) return;
    pendingUploadTasksRef.current.push(task);
    pendingUploadIdsRef.current.add(task.id);
    pumpUploadQueueRef.current();
  }, []);

  const removePendingUpload = (id: string) => {
    pendingUploadIdsRef.current.delete(id);
    pendingUploadTasksRef.current = pendingUploadTasksRef.current.filter(task => task.id !== id);
  };

  const uploadFiles = (incoming: FileList | File[]) => {
    if (!can('upload') || activeMount?.readOnly) {
      toast('Este storage é somente leitura.', 'danger');
      return;
    }
    const items = Array.from(incoming);
    if (!items.length) return;
    const maxUploadBytes = bootstrap?.limits?.maxUploadBytes;
    const tasks: UploadTask[] = items.map(file => ({
      id: makeId('upload'),
      file,
      mount,
      storageMount: storageMount || activeMount?.storageMount,
      provider: activeMount?.provider,
      path,
      progress: 0,
      uploadedBytes: 0,
      status: maxUploadBytes && file.size > maxUploadBytes ? 'error' : 'queued',
      error: maxUploadBytes && file.size > maxUploadBytes ? `O arquivo excede o limite de ${formatBytes(maxUploadBytes)}.` : undefined,
    }));
    updateUploadTasks(current => [...current, ...tasks]);
    tasks.filter(task => task.status === 'queued').forEach(enqueueUploadTask);
  };

  const pauseUpload = (id: string) => {
    uploadIntentsRef.current.set(id, 'pause');
    removePendingUpload(id);
    uploadControllersRef.current.get(id)?.abort();
    patchUploadTask(id, { status: 'paused' });
  };

  const cancelUpload = async (id: string) => {
    const task = uploadTasksRef.current.find(item => item.id === id);
    uploadIntentsRef.current.set(id, 'cancel');
    removePendingUpload(id);
    uploadControllersRef.current.get(id)?.abort();
    if (task?.uploadId && !activeUploadIdsRef.current.has(id)) {
      await api.abortUpload(task.uploadId).catch(() => undefined);
    }
    patchUploadTask(id, { status: 'cancelled', uploadId: undefined, uploadedBytes: 0, progress: 0 });
  };

  const resumeUpload = (id: string) => {
    const task = uploadTasksRef.current.find(item => item.id === id);
    if (!task) return;
    // Keep a restart intent until a possibly-aborting prior worker reaches its
    // finally block. The queue retains this task while that ID is still active.
    uploadIntentsRef.current.set(id, 'restart');
    patchUploadTask(id, { status: 'queued', error: undefined });
    enqueueUploadTask({ ...task, status: 'queued', error: undefined });
  };

  const retryUpload = async (id: string) => {
    const task = uploadTasksRef.current.find(item => item.id === id);
    if (!task) return;
    removePendingUpload(id);
    uploadControllersRef.current.get(id)?.abort();
    if (task.uploadId) await api.abortUpload(task.uploadId).catch(() => undefined);
    uploadIntentsRef.current.delete(id);
    const restart = { ...task, uploadId: undefined, uploadedBytes: 0, progress: 0, status: 'queued' as const, error: undefined };
    patchUploadTask(id, { status: 'queued', error: undefined, uploadId: undefined, uploadedBytes: 0, progress: 0 });
    enqueueUploadTask(restart);
  };

  const removeUpload = (id: string) => {
    const task = uploadTasksRef.current.find(item => item.id === id);
    if (task && ['uploading', 'initializing', 'queued'].includes(task.status)) void cancelUpload(id);
    updateUploadTasks(current => current.filter(item => item.id !== id));
  };

  const replaceFile = async (replacement: File) => {
    const target = replaceTargetRef.current;
    if (!target) return;
    await run('Substituir arquivo', () => api.upload(replacement, {
      mount: target.mount || mount,
      storageMount: target.storageMount || storageMount || activeMount?.storageMount,
      provider: target.provider || activeMount?.provider,
      path: parentPath(target.path),
      replace: target,
    }));
    replaceTargetRef.current = null;
  };

  const copyUrl = async (file: FileObject) => {
    if (!file.publicUrl) return toast('Este arquivo não possui URL pública.', 'danger');
    try {
      await navigator.clipboard.writeText(file.publicUrl);
      toast('URL copiada.', 'success');
    } catch {
      toast('Não foi possível copiar a URL.', 'danger');
    }
  };

  const action = (name: string, extra: Record<string, unknown> = {}) => {
    if (!chosenFiles.length) return;
    if (name === 'favorite') {
      void run('Atualizar favorito', () => Promise.all(chosenFiles.map(file => api.metadata(file, {
        favorite: typeof extra.favorite === 'boolean' ? extra.favorite : !file.favorite,
        tags: file.tags,
      }))));
      return;
    }
    if (name === 'compress') {
      const archiveName = `archive-${new Date().toISOString().slice(0, 10)}.zip`;
      void run('Compactar', () => api.operation('compress', {
        provider: activeMount?.provider || 'local',
        mount,
        items: chosenFiles.map(fileReference),
        toMount: mount,
        toStorageMount: storageMount || activeMount?.storageMount,
        toPath: joinPath(path, archiveName),
      }));
      return;
    }
    if (name === 'extract') {
      const file = chosenFiles[0];
      void run('Extrair', () => api.operation('extract', { ...fileReference(file), toPath: parentPath(file.path) }));
      return;
    }
    void run(name, () => Promise.all(chosenFiles.map(file => api.operation(name, { ...fileReference(file), ...extra }))));
  };

  const paste = () => {
    if (!clipboard?.files.length) return;
    void run('Colar', () => Promise.all(clipboard.files.map(file => api.operation(
      clipboard.mode === 'cut' ? 'move' : 'copy',
      { ...fileReference(file), toMount: mount, toStorageMount: storageMount || activeMount?.storageMount, toPath: joinPath(path, file.name) },
    )))).then(() => {
      if (clipboard.mode === 'cut') setClipboard(null);
    });
  };

  const onBrowserKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(new Set(visibleFiles.map(fileKey)));
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && chosenFiles.length) {
      event.preventDefault();
      setClipboard({ mode: 'copy', files: chosenFiles });
      toast(`${chosenFiles.length} item(ns) copiado(s).`);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'x' && chosenFiles.length) {
      event.preventDefault();
      setClipboard({ mode: 'cut', files: chosenFiles });
      toast(`${chosenFiles.length} item(ns) recortado(s).`);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      paste();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e' && chosenFiles.length === 1 && canEdit(chosenFiles[0])) {
      event.preventDefault();
      openEditor(chosenFiles[0]);
    } else if (event.key === 'Delete' || event.key === 'Backspace' && event.metaKey) {
      if (chosenFiles.length && canDeleteSelection) {
        event.preventDefault();
        openDialog('delete');
      }
    } else if (event.key === 'F2' && chosenFiles.length === 1) {
      event.preventDefault();
      openDialog('rename', chosenFiles[0].name);
    } else if (event.key === 'Enter' && chosenFiles.length === 1) {
      event.preventDefault();
      openFile(chosenFiles[0]);
    } else if (event.key === 'Escape') {
      setSelected(new Set());
      setContext(null);
    }
  };

  useEffect(() => {
    const close = () => setContext(null);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  const setSearchToken = (key: string, value: string) => {
    setSearch(current => {
      const without = current.replace(new RegExp(`(?:^|\\s)${key}:[^\\s]+`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
      return [without, value ? `${key}:${value}` : ''].filter(Boolean).join(' ');
    });
  };

  const selectedContextFile = context?.file || chosen;
  const breadcrumbParts = pathSegments(path);
  const dialogTitle: Record<Exclude<DialogKind, null>, string> = {
    folder: 'New folder',
    file: 'New file',
    rename: 'Rename',
    move: 'Move items',
    tags: 'Edit tags',
    delete: scope === 'trash' ? 'Delete permanently?' : 'Move to trash?',
  };

  return (
    <div className="kfs-app" onMouseDown={() => context && setContext(null)}>
      <header className="kfs-topbar">
        <a className="kfs-brand" href={config.dashboardUrl || '#'} aria-label="Voltar ao Onun Kodety">
          {config.brandLogoUrl ? <img src={config.brandLogoUrl} alt="" /> : <KodetyMark />}
        </a>
        <div className="kfs-topbar__title">
          <strong>Onun Kodety File System</strong>
          <span>{config.siteName || bootstrap?.project?.name || 'Asset workspace'}</span>
        </div>
        <div className="kfs-topbar__status">
          <span className={`kfs-status-dot ${notice || storageWarning ? 'is-warning' : ''}`} />
          <span>{notice || storageWarning ? 'Storage attention' : 'Storage connected'}</span>
        </div>
        <div className="kfs-topbar__actions">
          <Button variant="quiet" className="kfs-mobile-nav-trigger" onClick={() => setNavOpen(value => !value)}>
            <FolderOpen size={14} /> Browse
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={!can('upload') || activeMount?.readOnly}>
            <Upload size={14} /> Upload
          </Button>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)} disabled={!can('manageStorage')}>
            <Settings2 size={16} />
          </IconButton>
        </div>
      </header>

      <div className="kfs-workspace">
        <nav className="kfs-rail" aria-label="File System areas">
          {scopeItems.map(item => {
            const ScopeIcon = item.icon;
            return (
              <button
                key={item.id}
                className={`kfs-rail__item ${scope === item.id ? 'is-active' : ''}`}
                onClick={() => go({ mount, path: item.id === 'files' ? path : '', scope: item.id })}
                aria-label={item.label}
                title={item.label}
              >
                <ScopeIcon />
              </button>
            );
          })}
          <span className="kfs-rail__spacer" />
          <button className={`kfs-rail__item ${activityOpen ? 'is-active' : ''}`} onClick={() => setActivityOpen(true)} disabled={!can('activity')} aria-label="Activity" title="Activity">
            <Activity size={18} />
          </button>
          <button className={`kfs-rail__item ${settingsOpen ? 'is-active' : ''}`} onClick={() => setSettingsOpen(true)} disabled={!can('manageStorage')} aria-label="Settings" title="Settings">
            <Settings2 size={18} />
          </button>
        </nav>

        <aside className={`kfs-navigation ${navOpen ? 'is-mobile-open' : ''}`}>
          <div className="kfs-panel-heading">
            <strong>File System</strong>
            <IconButton label="Fechar navegação" className="kfs-mobile-close" onClick={() => setNavOpen(false)}><X size={14} /></IconButton>
          </div>
          <div className="kfs-navigation__scroll">
            <SectionLabel>Workspace</SectionLabel>
            <div className="kfs-navigation__group">
              {scopeItems.map(item => (
                <button
                  key={item.id}
                  className={`kfs-nav-row ${scope === item.id ? 'is-active' : ''}`}
                  onClick={() => go({ mount, path: item.id === 'files' ? path : '', scope: item.id })}
                >
                  {item.id === 'files' && <FolderOpen size={15} />}
                  {item.id === 'recent' && <History size={15} />}
                  {item.id === 'favorites' && <Star size={15} />}
                  {item.id === 'trash' && <Trash2 size={15} />}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <SectionLabel action={can('manageStorage') ? <IconButton label="Add storage" onClick={() => setSettingsOpen(true)}><Plus size={12} /></IconButton> : null}>Storage</SectionLabel>
            <div className="kfs-navigation__group">
              {mounts.map(item => (
                <button
                  key={item.id}
                  className={`kfs-nav-row kfs-nav-row--mount ${mount === item.id && scope === 'files' ? 'is-active' : ''}`}
                  onClick={() => go({ mount: item.id, path: '', scope: 'files' })}
                >
                  <span className="kfs-nav-row__solar">{mountIcon(item)}</span>
                  <span className="kfs-nav-row__copy">
                    <strong>{item.name}</strong>
                    <small>{item.provider}{item.readOnly ? ' · read only' : ''}</small>
                  </span>
                  <span className={`kfs-storage-status ${item.status === 'offline' ? 'is-offline' : ''}`} />
                </button>
              ))}
            </div>
            {activeMount?.quota?.total ? (
              <div className="kfs-quota">
                <div><span>Storage</span><span>{formatBytes(activeMount.quota.used)} / {formatBytes(activeMount.quota.total)}</span></div>
                <span><i style={{ width: `${Math.min(100, ((activeMount.quota.used || 0) / activeMount.quota.total) * 100)}%` }} /></span>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="kfs-browser" ref={browserRef} tabIndex={0} onKeyDown={onBrowserKeyDown}>
          <div className="kfs-browser__nav">
            <div className="kfs-history-controls">
              <IconButton label="Back" disabled={historyIndex <= 0} onClick={() => goHistory(historyIndex - 1)}><ArrowLeft size={14} /></IconButton>
              <IconButton label="Forward" disabled={historyIndex >= history.length - 1} onClick={() => goHistory(historyIndex + 1)}><ArrowRight size={14} /></IconButton>
              <IconButton label="Up" disabled={!path} onClick={() => go({ mount, path: parentPath(path), scope: 'files' })}><ArrowUp size={14} /></IconButton>
            </div>
            <nav className="kfs-breadcrumbs" aria-label="Breadcrumb">
              <button onClick={() => go({ mount, path: '', scope: 'files' })}>{activeMount?.name || mount}</button>
              {breadcrumbParts.map((part, index) => (
                <span key={`${part}-${index}`}>
                  <ChevronRight size={11} />
                  <button onClick={() => go({ mount, path: breadcrumbParts.slice(0, index + 1).join('/'), scope: 'files' })}>{part}</button>
                </span>
              ))}
            </nav>
            <div className="kfs-search">
              <Search size={14} />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search files or type filters…" aria-label="Search files" />
              {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={12} /></button>}
              <kbd>⌘K</kbd>
            </div>
          </div>

          <div className="kfs-toolbar">
            <div className="kfs-toolbar__leading">
              <Button onClick={() => openDialog('folder')} disabled={!can('create') || activeMount?.readOnly}><Plus size={14} /> New</Button>
              <Button variant="quiet" onClick={() => fileInputRef.current?.click()} disabled={!can('upload') || activeMount?.readOnly}><Upload size={14} /> Upload</Button>
              {clipboard && <Button variant="quiet" onClick={paste}><ClipboardPaste size={14} /> Paste</Button>}
            </div>
            <div className="kfs-toolbar__selection">
              {selected.size > 0 ? <span>{selected.size} selected</span> : <span>{visibleFiles.length} items</span>}
            </div>
            <div className="kfs-toolbar__trailing">
              <div className="kfs-filter-wrap">
                <IconButton label="Filter" active={filtersOpen} onClick={() => setFiltersOpen(value => !value)}><Filter size={14} /></IconButton>
                {filtersOpen && (
                  <div className="kfs-filter-popover" onMouseDown={event => event.stopPropagation()}>
                    <label>Type<select value={query.type || ''} onChange={event => setSearchToken('type', event.target.value)}><option value="">All types</option><option value="image">Images</option><option value="video">Video</option><option value="audio">Audio</option><option value="code">Code</option><option value="document">Documents</option></select></label>
                    <label>Visibility<select value={query.visibility || ''} onChange={event => setSearchToken('visibility', event.target.value)}><option value="">Any</option><option value="public">Public</option><option value="private">Private</option><option value="shared">Shared</option></select></label>
                    <label>Modified<select value={query.modified || ''} onChange={event => setSearchToken('modified', event.target.value)}><option value="">Any time</option><option value="today">Today</option><option value="this-week">This week</option><option value="this-month">This month</option></select></label>
                  </div>
                )}
              </div>
              <label className="kfs-sort"><span>Sort</span><select value={`${sortKey}:${sortDirection}`} onChange={event => { const [key, direction] = event.target.value.split(':'); setSortKey(key as SortKey); setSortDirection(direction as 'asc' | 'desc'); }}><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="modified:desc">Newest</option><option value="modified:asc">Oldest</option><option value="size:desc">Largest</option><option value="type:asc">Type</option></select><ChevronDown size={11} /></label>
              <div className="kfs-view-toggle">
                <IconButton label="Grid view" active={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={14} /></IconButton>
                <IconButton label="List view" active={view === 'list'} onClick={() => setView('list')}><List size={14} /></IconButton>
              </div>
              <IconButton label="Refresh" onClick={() => void loadFiles()}><RefreshCw size={14} /></IconButton>
              <IconButton label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} active={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}><Eye size={14} /></IconButton>
              <IconButton label="More actions" onClick={event => chosen && setContext({ x: event.clientX, y: event.clientY, file: chosen })}><Ellipsis size={15} /></IconButton>
            </div>
          </div>

          {(notice || storageWarning) && (
            <div className="kfs-notice">
              <span>{notice || storageWarning}</span>
              <Button variant="quiet" size="compact" onClick={() => void loadFiles()}><RefreshCw size={12} /> Retry</Button>
            </div>
          )}

          <div
            className={`kfs-file-surface is-${view}`}
            onMouseDown={event => {
              if (event.target === event.currentTarget) setSelected(new Set());
            }}
            onDragOver={event => { event.preventDefault(); event.currentTarget.classList.add('is-dragging'); }}
            onDragLeave={event => event.currentTarget.classList.remove('is-dragging')}
            onDrop={event => {
              event.preventDefault();
              event.currentTarget.classList.remove('is-dragging');
              void uploadFiles(event.dataTransfer.files);
            }}
          >
            {loading ? (
              <div className="kfs-loading"><KodetyMark /><Spinner label="Loading files" /><span>Loading files</span></div>
            ) : visibleFiles.length === 0 ? (
              <EmptyState
                icon={search ? <Search size={21} /> : <Folder size={21} />}
                title={search ? 'No matching files' : scope === 'trash' ? 'Trash is empty' : 'This folder is empty'}
                description={search ? 'Try another name or remove one of the filters.' : 'Drop files here or create your first folder.'}
                action={!search && scope === 'files' ? <Button onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Upload files</Button> : undefined}
              />
            ) : view === 'grid' ? (
              <div className="kfs-grid" role="listbox" aria-multiselectable="true">
                {visibleFiles.map(file => {
                  const id = fileKey(file);
                  const isSelected = selected.has(id);
                  const thumbnail = file.kind === 'file' && file.mimeType?.startsWith('image/') && (file.previewUrl || file.publicUrl);
                  return (
                    <article
                      key={id}
                      className={`kfs-file-card ${isSelected ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={event => selectFile(file, event)}
                      onDoubleClick={() => openFile(file)}
                      onContextMenu={event => { event.preventDefault(); if (!isSelected) setSelected(new Set([id])); setContext({ x: event.clientX, y: event.clientY, file }); }}
                    >
                      <div className="kfs-file-card__preview">
                        {thumbnail ? <img src={String(thumbnail)} alt="" draggable={false} /> : <FileGlyph file={file} size={file.kind === 'folder' ? 34 : 28} />}
                        {file.visibility === 'private' && <span className="kfs-file-card__privacy"><Lock size={10} /></span>}
                        {file.favorite && <span className="kfs-file-card__favorite"><Star size={10} /></span>}
                      </div>
                      <div className="kfs-file-card__copy"><strong title={file.name}>{file.name}</strong><span>{file.kind === 'folder' ? 'Folder' : `${extensionOf(file).toUpperCase() || 'FILE'} · ${formatBytes(file.size)}`}</span></div>
                      <button className="kfs-file-card__menu" onClick={event => { event.stopPropagation(); setSelected(new Set([id])); setContext({ x: event.clientX, y: event.clientY, file }); }} aria-label={`Actions for ${file.name}`}><MoreHorizontal size={14} /></button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="kfs-list" role="listbox" aria-multiselectable="true">
                <div className="kfs-list__header"><span>Name</span><span>Visibility</span><span>Size</span><span>Modified</span><span /></div>
                {visibleFiles.map(file => {
                  const id = fileKey(file);
                  const isSelected = selected.has(id);
                  return (
                    <div
                      key={id}
                      className={`kfs-file-row ${isSelected ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={event => selectFile(file, event)}
                      onDoubleClick={() => openFile(file)}
                      onContextMenu={event => { event.preventDefault(); if (!isSelected) setSelected(new Set([id])); setContext({ x: event.clientX, y: event.clientY, file }); }}
                    >
                      <span className="kfs-file-row__name"><FileGlyph file={file} size={16} /><span><strong>{file.name}</strong><small>{file.kind === 'folder' ? 'Folder' : file.mimeType || extensionOf(file).toUpperCase()}</small></span></span>
                      <span>{file.visibility ? <Pill tone={file.visibility === 'public' ? 'success' : file.visibility === 'private' ? 'warning' : 'accent'}>{file.visibility}</Pill> : '—'}</span>
                      <span>{file.kind === 'folder' ? '—' : formatBytes(file.size)}</span>
                      <span>{formatDate(file.updatedAt, true)}</span>
                      <button onClick={event => { event.stopPropagation(); setSelected(new Set([id])); setContext({ x: event.clientX, y: event.clientY, file }); }} aria-label={`Actions for ${file.name}`}><MoreHorizontal size={14} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        <aside className={`kfs-inspector ${inspectorOpen ? 'is-open' : ''}`}>
          <div className="kfs-panel-heading"><strong>Inspector</strong><IconButton label="Close inspector" onClick={() => setInspectorOpen(false)}><X size={14} /></IconButton></div>
          {chosenFiles.length > 1 ? (
            <div className="kfs-inspector__multiple"><div><ClipboardCopy size={22} /></div><strong>{chosenFiles.length} items selected</strong><span>{formatBytes(chosenFiles.reduce((sum, file) => sum + (file.size || 0), 0))}</span><Button onClick={() => openDialog('move')}>Move selection</Button></div>
          ) : chosen ? (
            <div className="kfs-inspector__scroll">
              <div className="kfs-inspector__preview"><FilePreview file={chosen} api={api} /></div>
              <div className="kfs-inspector__title"><FileGlyph file={chosen} size={16} /><div><strong>{chosen.name}</strong><span>{chosen.mimeType || (chosen.kind === 'folder' ? 'Folder' : 'File')}</span></div><IconButton label="More actions" onClick={event => setContext({ x: event.clientX, y: event.clientY, file: chosen })}><MoreHorizontal size={14} /></IconButton></div>
              <section className="kfs-inspector__section"><SectionLabel>Details</SectionLabel><dl><KeyValue label="Type">{chosen.kind === 'folder' ? 'Folder' : extensionOf(chosen).toUpperCase() || 'File'}</KeyValue><KeyValue label="Size">{formatBytes(chosen.size)}</KeyValue>{chosen.width && chosen.height ? <KeyValue label="Dimensions">{chosen.width} × {chosen.height}</KeyValue> : null}<KeyValue label="Modified">{formatDate(chosen.updatedAt)}</KeyValue><KeyValue label="Visibility"><span className="kfs-visibility"><i className={`is-${chosen.visibility || 'private'}`} />{chosen.visibility || 'private'}</span></KeyValue><KeyValue label="Provider">{chosen.provider || activeMount?.provider || 'filesystem'}</KeyValue></dl></section>
              {chosen.publicUrl && <section className="kfs-inspector__section"><SectionLabel>URL</SectionLabel><button className="kfs-url-field" onClick={() => void copyUrl(chosen)}><span>{chosen.publicUrl}</span><Copy size={12} /></button></section>}
              <section className="kfs-inspector__section"><SectionLabel>Tags</SectionLabel><button className="kfs-tags" onClick={() => openDialog('tags', (chosen.tags || []).join(', '))}>{chosen.tags?.length ? chosen.tags.map(tag => <Pill key={tag}>{tag}</Pill>) : <span>Add tags…</span>}</button></section>
              {chosen.usages?.length ? <section className="kfs-inspector__section"><SectionLabel>Used by · {chosen.usages.length}</SectionLabel><div className="kfs-usages">{chosen.usages.slice(0, 5).map((usage, index) => <div key={usage.id || index}><Share2 size={12} /><span><strong>{usage.label}</strong><small>{usage.location}</small></span></div>)}</div></section> : null}
              {versions.length ? <section className="kfs-inspector__section"><SectionLabel>Versions</SectionLabel><div className="kfs-versions">{versions.slice(0, 4).map((version, index) => <div key={version.id}><span><strong>{version.version ? `v${version.version}` : `Version ${versions.length - index}`}</strong><small>{formatDate(version.createdAt, true)}</small></span>{version.current ? <Pill tone="accent">Current</Pill> : <button onClick={() => void run('Restore version', () => api.restoreVersion(version.id))}><Undo2 size={12} /></button>}</div>)}</div></section> : null}
            </div>
          ) : <FilePreview file={null} api={api} />}
        </aside>
      </div>

      {context && selectedContextFile && (
        <div className="kfs-context" style={{ left: Math.min(context.x, window.innerWidth - 230), top: Math.min(context.y, window.innerHeight - 470) }} onMouseDown={event => event.stopPropagation()} role="menu">
          <button onClick={() => openFile(selectedContextFile)}><span>{selectedContextFile.kind === 'folder' ? <FolderOpen size={14} /> : <Eye size={14} />}{selectedContextFile.kind === 'folder' ? 'Open' : 'Preview'}</span><kbd>Enter</kbd></button>
          {selectedContextFile.kind === 'file' && canEdit(selectedContextFile) && <button onClick={() => openEditor(selectedContextFile)} disabled={!can('editCode') || !can('write') || (isDangerousCodeFile(selectedContextFile) && !can('dangerousFileEditing'))}><span><Code2 size={14} />Edit code</span><kbd>⌘E</kbd></button>}
          {selectedContextFile.kind === 'file' && selectedContextFile.provider !== 'remote' && <button onClick={() => void api.download(selectedContextFile).catch(error => toast(error.message, 'danger'))}><span><Download size={14} />Download</span></button>}
          <div className="kfs-context__separator" />
          <button onClick={() => openDialog('rename', selectedContextFile.name)} disabled={chosenFiles.length !== 1 || !can('write')}><span><Pencil size={14} />Rename</span><kbd>F2</kbd></button>
          <button onClick={() => action('duplicate')} disabled={!can('create')}><span><ClipboardCopy size={14} />Duplicate</span></button>
          <button onClick={() => { setClipboard({ mode: 'copy', files: chosenFiles }); setContext(null); }}><span><Copy size={14} />Copy</span><kbd>⌘C</kbd></button>
          <button onClick={() => openDialog('move')} disabled={!can('move')}><span><ArrowRight size={14} />Move to…</span></button>
          <div className="kfs-context__separator" />
          <button onClick={() => action('favorite', { favorite: !selectedContextFile.favorite })}><span><Star size={14} />{selectedContextFile.favorite ? 'Remove favorite' : 'Add to favorites'}</span></button>
          {selectedContextFile.kind === 'file' && (!selectedContextFile.provider || ['local', 'filesystem', 'backend-filesystem'].includes(selectedContextFile.provider)) && <button onClick={() => { replaceTargetRef.current = selectedContextFile; replaceInputRef.current?.click(); setContext(null); }} disabled={!can('write')}><span><RefreshCw size={14} />Replace file…</span></button>}
          <button onClick={() => action(selectedContextFile.visibility === 'public' ? 'make-private' : 'make-public')} disabled={!can('visibility')}><span>{selectedContextFile.visibility === 'public' ? <Lock size={14} /> : <Unlock size={14} />}{selectedContextFile.visibility === 'public' ? 'Make private' : 'Make public'}</span></button>
          <button onClick={() => openDialog('tags', (selectedContextFile.tags || []).join(', '))}><span><Code2 size={14} />Edit tags…</span></button>
          <div className="kfs-context__separator" />
          {selectedContextFile.kind === 'folder' ? <button onClick={() => action('compress')}><span><Archive size={14} />Compress to ZIP</span></button> : extensionOf(selectedContextFile) === 'zip' ? <button onClick={() => action('extract')}><span><Archive size={14} />Extract here</span></button> : null}
          {scope === 'trash' && <button onClick={() => action('restore')}><span><Undo2 size={14} />Restore</span></button>}
          <button className="is-danger" onClick={() => openDialog('delete')} disabled={!canDeleteSelection}><span><Trash2 size={14} />{scope === 'trash' ? 'Delete permanently' : 'Move to trash'}</span><kbd>⌫</kbd></button>
        </div>
      )}

      <Modal
        open={dialog !== null}
        title={dialog ? dialogTitle[dialog] : ''}
        description={dialog === 'delete' ? `${chosenFiles.length} item(ns) serão ${scope === 'trash' ? 'removidos permanentemente' : 'movidos para a lixeira'}.` : undefined}
        onClose={() => setDialog(null)}
        footer={<><Button variant="quiet" onClick={() => setDialog(null)}>Cancel</Button><Button variant={dialog === 'delete' ? 'danger' : 'primary'} onClick={() => void submitDialog()} disabled={dialog === 'delete' ? !canDeleteSelection : !dialogValue.trim()}>{busy ? <Loader2 size={13} /> : dialog === 'delete' ? <Trash2 size={13} /> : <Check size={13} />}{dialog === 'delete' ? 'Confirm' : 'Save'}</Button></>}
      >
        {dialog !== 'delete' && <label className="kfs-field"><span>{dialog === 'tags' ? 'Tags separated by commas' : dialog === 'move' ? 'Destination path inside this storage' : 'Name'}</span><TextInput autoFocus value={dialogValue} onChange={event => setDialogValue(event.target.value)} onKeyDown={event => event.key === 'Enter' && void submitDialog()} placeholder={dialog === 'move' ? 'assets/destination' : dialog === 'tags' ? 'brand, homepage' : 'Untitled'} /></label>}
        {(dialog === 'folder' || dialog === 'file') && <div className="kfs-create-switch"><button className={dialog === 'folder' ? 'is-active' : ''} onClick={() => setDialog('folder')}><Folder size={14} />Folder</button><button className={dialog === 'file' ? 'is-active' : ''} onClick={() => setDialog('file')}><FileGlyph file={{ id: '', name: 'file.txt', path: '', kind: 'file' }} size={14} />File</button></div>}
      </Modal>

      <Modal open={Boolean(previewFile)} title={previewFile?.name || 'Preview'} width="min(920px, calc(100vw - 32px))" onClose={() => setPreviewFile(null)}>
        <FilePreview file={previewFile} api={api} expanded onDownload={previewFile?.provider === 'remote' ? undefined : file => void api.download(file).catch(error => toast(error.message, 'danger'))} onEdit={openEditor} />
      </Modal>

      <CodeEditorModal
        api={api}
        file={editorFile}
        canSave={can('editCode') && can('write')}
        maxBytes={bootstrap?.limits?.maxEditBytes}
        onClose={() => setEditorFile(null)}
        onSaved={updated => {
          setEditorFile(updated);
          setFiles(current => current.map(file => file.id === updated.id ? updated : file));
          toast('Arquivo salvo e nova versão registrada.', 'success');
          void loadFiles(mount, path, scope, true, storageMount);
        }}
      />

      <ActivityModal api={api} open={activityOpen} onClose={() => setActivityOpen(false)} />

      <SettingsModal
        api={api}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          toast('Configurações de storage atualizadas.', 'success');
          void api.bootstrap().then(result => {
            setBootstrap(result);
            if (result.mounts?.length) setMounts(result.mounts);
            void loadFiles(mount, path, scope, true, storageMount);
          }).catch(error => toast(error instanceof Error ? error.message : 'Não foi possível atualizar os storages.', 'danger'));
        }}
      />

      {uploading.length > 0 && (
        <section className="kfs-upload-stack" aria-label="Fila de uploads">
          <header>
            <span><Upload size={13} />Uploads <small>{uploading.filter(item => ['queued', 'initializing', 'uploading'].includes(item.status)).length} active</small></span>
            <button onClick={() => updateUploadTasks(current => current.filter(item => ['queued', 'initializing', 'uploading', 'paused'].includes(item.status)))} aria-label="Limpar uploads finalizados"><X size={12} /></button>
          </header>
          {uploading.map(item => (
            <div key={item.id} className={`kfs-upload-item is-${item.status}`}>
              <span className="kfs-upload-item__state">{['queued', 'initializing', 'uploading'].includes(item.status) ? <Loader2 size={12} /> : item.status === 'done' ? <Check size={12} /> : item.status === 'paused' ? <Pause size={12} /> : <X size={12} />}</span>
              <div className="kfs-upload-item__copy">
                <strong title={item.file.name}>{item.file.name}</strong>
                <small>{item.status === 'error' ? item.error : `${formatBytes(item.uploadedBytes)} / ${formatBytes(item.file.size)} · ${item.progress}%`}</small>
                <span className="kfs-upload-item__progress" aria-hidden="true"><i style={{ width: `${item.progress}%` }} /></span>
              </div>
              <div className="kfs-upload-item__actions">
                {['queued', 'initializing', 'uploading'].includes(item.status) && <IconButton label={`Pausar ${item.file.name}`} onClick={() => pauseUpload(item.id)}><Pause size={11} /></IconButton>}
                {item.status === 'paused' && <IconButton label={`Retomar ${item.file.name}`} onClick={() => resumeUpload(item.id)}><Play size={11} /></IconButton>}
                {item.status === 'error' && <IconButton label={`Tentar novamente ${item.file.name}`} onClick={() => retryUpload(item.id)}><RotateCcw size={11} /></IconButton>}
                {!['done', 'cancelled'].includes(item.status) && <IconButton label={`Cancelar ${item.file.name}`} onClick={() => cancelUpload(item.id)}><X size={11} /></IconButton>}
                {['done', 'cancelled'].includes(item.status) && <IconButton label={`Remover ${item.file.name} da fila`} onClick={() => removeUpload(item.id)}><X size={11} /></IconButton>}
              </div>
            </div>
          ))}
        </section>
      )}
      <div className="kfs-toasts" aria-live="polite">{toasts.map(item => <div key={item.id} className={`is-${item.tone}`}>{item.tone === 'success' ? <Check size={13} /> : item.tone === 'danger' ? <X size={13} /> : <MoreHorizontal size={13} />}<span>{item.message}</span></div>)}</div>

      <input ref={fileInputRef} className="kfs-hidden-input" type="file" multiple onChange={event => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />
      <input ref={replaceInputRef} className="kfs-hidden-input" type="file" onChange={event => { const file = event.target.files?.[0]; if (file) void replaceFile(file); event.target.value = ''; }} />
    </div>
  );
}
