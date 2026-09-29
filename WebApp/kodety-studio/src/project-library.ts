import {
  newProject,
  type KodetyStudioProject,
  type WordPressLocale,
} from "../../../ChromeExtension/kodety-studio/src/storage";
import {
  KODETY_PHP_VERSION,
  KODETY_PLUGIN_VERSION,
  KODETY_WORDPRESS_VERSION,
} from "../../../ChromeExtension/kodety-studio/src/product-versions";

// Keep the existing key and IDs: upgrading the shell must retain every site's
// association with its remote OPFS directory.
export const LIBRARY_KEY = "kodetyStudioProjectsV1";
export const LIBRARY_EVENT = "kodety-studio:library-changed";
export type StudioProjectMode = "html" | "wordpress";
export type StudioProjectStorageMode = "folder" | "browser";
export type StudioProject = KodetyStudioProject & {
  favorite?: boolean;
  mode: StudioProjectMode;
  directoryName?: string;
  storageMode?: StudioProjectStorageMode;
  manualBackupAcknowledgedAt?: number;
};
export type LibraryErrorCode =
  | "unreadable"
  | "corrupt"
  | "quota"
  | "unavailable"
  | "missing"
  | "mode"
  | "name"
  | "duplicate";
export class LibraryError extends Error {
  constructor(
    public code: LibraryErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

export function normalizedName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function validateProjectName(
  name: string,
  projects: StudioProject[],
  exceptId?: string,
): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 80 || /[\u0000-\u001f\u007f]/.test(clean))
    throw new LibraryError("name");
  if (
    projects.some(
      (project) =>
        project.id !== exceptId &&
        normalizedName(project.name) === normalizedName(clean),
    )
  ) {
    throw new LibraryError("duplicate");
  }
  return clean;
}

export function parseLibrary(raw: string | null): StudioProject[] {
  if (raw === null) return [];
  try {
    const input: unknown = JSON.parse(raw);
    if (!Array.isArray(input)) throw new Error("Expected an array");
    const ids = new Set<string>();
    return input.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid record");
      const project = value as StudioProject;
      if (
        typeof project.id !== "string" ||
        !/^[a-z0-9-]{8,80}$/i.test(project.id) ||
        ids.has(project.id) ||
        typeof project.name !== "string" ||
        !project.name.trim() ||
        !Number.isFinite(project.createdAt) ||
        !Number.isFinite(project.updatedAt) ||
        typeof project.initialized !== "boolean" ||
        (project.mode !== undefined &&
          project.mode !== "html" &&
          project.mode !== "wordpress") ||
        (project.storageMode !== undefined && project.storageMode !== "folder" && project.storageMode !== "browser")
      )
        throw new Error("Invalid project");
      ids.add(project.id);
      const thumbnailDataUrl =
        typeof project.thumbnailDataUrl === "string" &&
        project.thumbnailDataUrl.length <= 1_100_000 &&
        /^data:image\/(?:png|jpe?g|webp|avif);base64,[a-z0-9+/=]+$/i.test(
          project.thumbnailDataUrl,
        )
          ? project.thumbnailDataUrl
          : undefined;
      return {
        ...project,
        mode: project.mode ?? "wordpress",
        storageMode: project.storageMode ?? "folder",
        manualBackupAcknowledgedAt: Number.isFinite(project.manualBackupAcknowledgedAt) && Number(project.manualBackupAcknowledgedAt) > 0
          ? project.manualBackupAcknowledgedAt : undefined,
        directoryName:
          typeof project.directoryName === "string"
            ? project.directoryName
            : undefined,
        lastOpenedAt: Number.isFinite(project.lastOpenedAt)
          ? project.lastOpenedAt
          : null,
        phpVersion: project.phpVersion || KODETY_PHP_VERSION,
        wordpressVersion: project.wordpressVersion || KODETY_WORDPRESS_VERSION,
        kodetyVersion: project.kodetyVersion || KODETY_PLUGIN_VERSION,
        wordpressLocale:
          project.wordpressLocale === "pt_BR" ? "pt_BR" : "en_US",
        runtimeRevision: Number.isFinite(project.runtimeRevision)
          ? project.runtimeRevision
          : 0,
        favorite: project.favorite === true,
        thumbnailDataUrl,
        thumbnailUpdatedAt:
          thumbnailDataUrl && Number.isFinite(project.thumbnailUpdatedAt)
            ? project.thumbnailUpdatedAt
            : undefined,
      } as StudioProject;
    });
  } catch (cause) {
    // Corruption must never masquerade as an empty library that a subsequent
    // Create action could overwrite. The original bytes stay untouched.
    throw new LibraryError("corrupt", { cause });
  }
}

type StorageAdapter = Pick<Storage, "getItem" | "setItem">;
type ExclusiveLock = <T>(operation: () => T) => Promise<T>;
type ProjectCreationOptions = {
  mode?: StudioProjectMode;
  directoryName?: string;
  storageMode?: StudioProjectStorageMode;
  manualBackupAcknowledgedAt?: number;
  runtimeVersions?: Pick<StudioProject, "phpVersion" | "wordpressVersion">;
  prepare?: (project: StudioProject) => Promise<void>;
};

export function createProjectRepository(
  storage: StorageAdapter,
  exclusive: ExclusiveLock,
) {
  const read = (): StudioProject[] => {
    let raw: string | null;
    try {
      raw = storage.getItem(LIBRARY_KEY);
    } catch (cause) {
      throw new LibraryError("unreadable", { cause });
    }
    return parseLibrary(raw);
  };
  const mutate = async (change: (latest: StudioProject[]) => StudioProject[]) =>
    exclusive(() => {
      const next = change(read());
      const serialized = JSON.stringify(next);
      parseLibrary(serialized);
      try {
        storage.setItem(LIBRARY_KEY, serialized);
      } catch (cause) {
        const quota =
          cause instanceof Error &&
          /QuotaExceeded|quota|space/i.test(`${cause.name} ${cause.message}`);
        throw new LibraryError(quota ? "quota" : "unavailable", { cause });
      }
      return next;
    });
  const requireProject = (projects: StudioProject[], id: string) => {
    const project = projects.find((item) => item.id === id);
    if (!project) throw new LibraryError("missing");
    return project;
  };
  const insert = async (
    name: string,
    locale: WordPressLocale,
    options: ProjectCreationOptions,
  ) => {
    let created!: StudioProject;
    const prepared: StudioProject = {
      ...newProject(validateProjectName(name, read()), locale),
      ...(options.runtimeVersions ? { phpVersion: options.runtimeVersions.phpVersion, wordpressVersion: options.runtimeVersions.wordpressVersion } : {}),
      mode: options.mode ?? "html",
      directoryName: options.directoryName,
      storageMode: options.storageMode ?? "folder",
      manualBackupAcknowledgedAt: options.manualBackupAcknowledgedAt,
    };
    // Persist directory permission handles before making a new project visible.
    // The duplicate-name check is repeated under the catalog's exclusive lock.
    await options.prepare?.(prepared);
    const projects = await mutate((latest) => {
      created = { ...prepared, name: validateProjectName(name, latest) };
      return [created, ...latest];
    });
    return { project: created, projects };
  };
  return {
    read,
    async create(name: string, locale: WordPressLocale, options: ProjectCreationOptions = {}) {
      // A stale preference or caller must not create another browser WordPress.
      if (options.mode !== undefined && options.mode !== "html") throw new LibraryError("mode");
      return insert(name, locale, { ...options, mode: "html" });
    },
    // Validated backups may still recover existing WordPress work as a new copy.
    // Keep this explicit path separate from ordinary new-project creation.
    restore(name: string, locale: WordPressLocale, options: ProjectCreationOptions & {
      mode: StudioProjectMode;
      prepare: (project: StudioProject) => Promise<void>;
    }) {
      return insert(name, locale, options);
    },
    patch(id: string, patch: Partial<Omit<StudioProject, "id" | "createdAt">>) {
      return mutate((latest) => {
        const current = requireProject(latest, id);
        const next = {
          ...current,
          ...patch,
          id: current.id,
          createdAt: current.createdAt,
        };
        if (patch.name !== undefined)
          next.name = validateProjectName(patch.name, latest, id);
        return latest.map((project) => (project.id === id ? next : project));
      });
    },
    remove(id: string) {
      return mutate((latest) => {
        requireProject(latest, id);
        return latest.filter((project) => project.id !== id);
      });
    },
  };
}

export function browserProjectRepository() {
  return createProjectRepository(
    {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    async (operation) => {
      if (!navigator.locks?.request) throw new LibraryError("unavailable");
      const result = await navigator.locks.request(
        "kodety-studio:library",
        { mode: "exclusive" },
        operation,
      );
      window.dispatchEvent(new Event(LIBRARY_EVENT));
      return result;
    },
  );
}

export function visibleProjects(
  projects: StudioProject[],
  query: string,
  filter: "all" | "favorites",
  sort: "recent" | "name" | "created",
) {
  const search = normalizedName(query);
  return projects
    .filter(
      (project) =>
        (!search || normalizedName(project.name).includes(search)) &&
        (filter !== "favorites" || project.favorite),
    )
    .sort((left, right) =>
      sort === "name"
        ? left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
          })
        : sort === "created"
          ? right.createdAt - left.createdAt
          : (right.lastOpenedAt || right.updatedAt) -
            (left.lastOpenedAt || left.updatedAt),
    );
}
