/**
 * Assets Store
 * 
 * Global store for managing assets (images, files) with caching
 */

import { create } from 'zustand';
import { getEditorImageUrl } from '@/lib/asset-utils';
import type { Asset, AssetFolder } from '@/types';

/**
 * Rewrite bitmap image `public_url`s to the proxy URL with a `?width=` cap
 * so the canvas iframe doesn't decode multi-hundred-megabyte bitmaps. SVGs,
 * videos, documents, and any asset without a storage_path pass through.
 */
function normalizeAssetForEditor(asset: Asset): Asset {
  const rewritten = getEditorImageUrl(asset);
  if (rewritten === asset.public_url) return asset;
  return { ...asset, public_url: rewritten };
}

interface AssetsState {
  assets: Asset[];
  assetsById: Record<string, Asset>;
  folders: AssetFolder[];
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
}

export interface FetchAssetsParams {
  folderId?: string | null;
  folderIds?: string[];
  search?: string;
  page?: number;
  limit?: number;
}

export interface FetchAssetsResult {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface AssetsActions {
  loadAssets: () => Promise<void>;
  fetchAssets: (params: FetchAssetsParams) => Promise<FetchAssetsResult>;
  setAssets: (assets: Asset[]) => void;
  setFolders: (folders: AssetFolder[]) => void;
  getAsset: (id: string) => Asset | null;
  addAsset: (asset: Asset) => void;
  addAssetsToCache: (assets: Asset[]) => void;
  updateAsset: (assetId: string, updates: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  addFolder: (folder: AssetFolder) => void;
  updateFolder: (folderId: string, updates: Partial<AssetFolder>) => void;
  deleteFolder: (folderId: string) => Promise<string[]>;
  batchReorderFolders: (updatedFolders: AssetFolder[]) => Promise<void>;
  reset: () => void;
}

type AssetsStore = AssetsState & AssetsActions;

const initialState: AssetsState = {
  assets: [],
  assetsById: {},
  folders: [],
  isLoading: false,
  isLoaded: false,
  error: null,
};

// Track the owner of each in-flight asset fetch. A token prevents an older
// request from writing to the cache or clearing a newer request's marker.
const pendingFetches = new Map<string, symbol>();
let assetStoreGeneration = 0;
let assetMutationGeneration = 0;
const assetMutationGenerations = new Map<string, number>();
let assetRequestSequence = 0;
const assetAppliedSequences = new Map<string, number>();

function invalidateAssetRequest(id: string) {
  pendingFetches.delete(id);
  assetMutationGeneration += 1;
  assetMutationGenerations.set(id, assetMutationGeneration);
  assetRequestSequence += 1;
  assetAppliedSequences.set(id, assetRequestSequence);
}

function invalidateAllAssetRequests() {
  assetStoreGeneration += 1;
  pendingFetches.clear();
  assetMutationGenerations.clear();
  assetAppliedSequences.clear();
}

export const useAssetsStore = create<AssetsStore>((set, get) => ({
  ...initialState,

  /**
   * Set assets directly (used during initial load)
   */
  setAssets: (assets: Asset[]) => {
    invalidateAllAssetRequests();
    const normalized = assets.map(normalizeAssetForEditor);
    const assetsById: Record<string, Asset> = {};
    normalized.forEach((asset) => {
      assetsById[asset.id] = asset;
    });

    set({
      assets: normalized,
      assetsById,
      isLoading: false,
      isLoaded: true,
      error: null,
    });
  },

  /**
   * Set asset folders directly (used during initial load)
   */
  setFolders: (folders: AssetFolder[]) => {
    set({ folders });
  },

  /**
   * Load folders from API (assets are loaded on-demand via fetchAssets)
   */
  loadAssets: async () => {
    // Don't reload if already loaded or currently loading
    if (get().isLoaded || get().isLoading) {
      return;
    }

    const requestGeneration = assetStoreGeneration;
    set({ isLoading: true, error: null });

    try {
      // Only load folders initially - assets are loaded on-demand
      const foldersResponse = await fetch('/kodety/api/asset-folders');
      
      if (!foldersResponse.ok) {
        throw new Error('Failed to fetch folders');
      }

      const { data: folders } = await foldersResponse.json();

      if (requestGeneration !== assetStoreGeneration) return;

      set({
        folders,
        isLoading: false,
        isLoaded: true,
        error: null,
      });
    } catch (error) {
      if (requestGeneration !== assetStoreGeneration) return;
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load assets',
      });
    }
  },

  /**
   * Fetch assets with pagination and search support
   * Results are also added to the global cache for quick lookups
   */
  fetchAssets: async (params: FetchAssetsParams): Promise<FetchAssetsResult> => {
    const { folderId, folderIds, search, page = 1, limit = 50 } = params;
    const requestGeneration = assetStoreGeneration;
    const requestMutationGeneration = assetMutationGeneration;
    const requestSequence = ++assetRequestSequence;
    
    // Build query params
    const queryParams = new URLSearchParams();
    
    if (folderIds && folderIds.length > 0) {
      queryParams.set('folderIds', folderIds.join(','));
    } else if (folderId !== undefined) {
      queryParams.set('folderId', folderId === null ? 'null' : folderId);
    }
    
    if (search) {
      queryParams.set('search', search);
    }
    
    queryParams.set('page', page.toString());
    queryParams.set('limit', limit.toString());
    
    const response = await fetch(`/kodety/api/assets?${queryParams.toString()}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch assets');
    }
    
    const result = await response.json();

    if (requestGeneration !== assetStoreGeneration) {
      return { assets: [], total: 0, page, limit, hasMore: false };
    }

    const normalizedAssets: Asset[] = (result.data || []).map(normalizeAssetForEditor);
    const currentAssetsById = get().assetsById;
    let removedAfterRequest = 0;
    const reconciledAssets = normalizedAssets.flatMap((asset: Asset) => {
      const mutationGeneration = assetMutationGenerations.get(asset.id) || 0;
      const appliedSequence = assetAppliedSequences.get(asset.id) || 0;
      if (
        mutationGeneration <= requestMutationGeneration
        && appliedSequence <= requestSequence
      ) {
        assetAppliedSequences.set(asset.id, requestSequence);
        pendingFetches.delete(asset.id);
        return [asset];
      }
      const current = currentAssetsById[asset.id];
      if (current) return [current];
      removedAfterRequest += 1;
      return [];
    });

    // Merge only entries that were not locally added, changed, or removed
    // after this list request began. Reconciled local values remain untouched.
    if (normalizedAssets.length > 0) {
      set((state) => {
        const newAssetsById = { ...state.assetsById };
        normalizedAssets.forEach((asset: Asset) => {
          const mutationGeneration = assetMutationGenerations.get(asset.id) || 0;
          if (
            mutationGeneration <= requestMutationGeneration
            && assetAppliedSequences.get(asset.id) === requestSequence
          ) {
            newAssetsById[asset.id] = asset;
          }
        });
        return { assetsById: newAssetsById };
      });
    }

    return {
      assets: reconciledAssets,
      total: Math.max(0, (result.total || 0) - removedAfterRequest),
      page: result.page || page,
      limit: result.limit || limit,
      hasMore: result.hasMore ?? false,
    };
  },

  /**
   * Add multiple assets to the cache (without affecting the assets array)
   */
  addAssetsToCache: (assets: Asset[]) => {
    assets.forEach(asset => invalidateAssetRequest(asset.id));
    set((state) => {
      const newAssetsById = { ...state.assetsById };
      assets.forEach((asset) => {
        newAssetsById[asset.id] = normalizeAssetForEditor(asset);
      });
      return { assetsById: newAssetsById };
    });
  },

  /**
   * Get asset by ID (from cache or fetch if not found)
   */
  getAsset: (id: string) => {
    const state = get();
    
    // Try to get from cache
    const cached = state.assetsById[id];
    if (cached) {
      return cached;
    }

    // If store is loaded, asset isn't known — skip background fetch.
    // Assets are preloaded via items API (includeAssets=true).
    if (state.isLoaded) {
      return null;
    }

    // Skip background fetch on server-side (relative URLs don't work in Node.js)
    if (typeof window === 'undefined') {
      return null;
    }

    // Skip if already fetching this asset (prevents duplicate requests)
    if (pendingFetches.has(id)) {
      return null;
    }

    // Mark as pending and fetch from API in background.
    const requestToken = Symbol(id);
    pendingFetches.set(id, requestToken);

    const requestGeneration = assetStoreGeneration;
    const requestSequence = ++assetRequestSequence;
    assetAppliedSequences.set(id, requestSequence);
    const ownsPendingFetch = () => (
      requestGeneration === assetStoreGeneration
      && pendingFetches.get(id) === requestToken
      && (assetAppliedSequences.get(id) || 0) <= requestSequence
    );

    void Promise.resolve()
      .then(() => {
        if (!ownsPendingFetch()) return null;
        return fetch(`/kodety/api/assets/${id}`);
      })
      .then(res => res?.ok ? res.json() : null)
      .then(result => {
        if (!ownsPendingFetch() || !result?.data) return;

        const asset = normalizeAssetForEditor(result.data);
        assetAppliedSequences.set(asset.id, requestSequence);
        set((state) => ({
          assetsById: {
            ...state.assetsById,
            [asset.id]: asset,
          },
        }));
      })
      .catch(err => {
        if (!ownsPendingFetch()) return;
        console.error('Failed to fetch asset:', err);
      })
      .finally(() => {
        if (ownsPendingFetch()) {
          pendingFetches.delete(id);
        }
      });

    return null;
  },

  /**
   * Add new asset to store (after upload)
   */
  addAsset: (asset: Asset) => {
    invalidateAssetRequest(asset.id);
    const normalized = normalizeAssetForEditor(asset);
    set((state) => ({
      assets: [normalized, ...state.assets],
      assetsById: {
        ...state.assetsById,
        [normalized.id]: normalized,
      },
    }));
  },

  /**
   * Update asset in store
   */
  updateAsset: (assetId: string, updates: Partial<Asset>) => {
    invalidateAssetRequest(assetId);
    set((state) => {
      const merged = { ...state.assetsById[assetId], ...updates } as Asset;
      const updatedAsset = normalizeAssetForEditor(merged);
      return {
        assets: state.assets.map(a =>
          a.id === assetId ? updatedAsset : a
        ),
        assetsById: {
          ...state.assetsById,
          [assetId]: updatedAsset,
        },
      };
    });
  },

  /**
   * Remove asset from store (after delete)
   */
  removeAsset: (id: string) => {
    // Invalidate an in-flight lookup before mutating the cache. Its response
    // must not resurrect the removed asset or release a later refetch marker.
    invalidateAssetRequest(id);

    set((state) => {
      const { [id]: removed, ...restAssetsById } = state.assetsById;
      
      return {
        assets: state.assets.filter(a => a.id !== id),
        assetsById: restAssetsById,
      };
    });
  },

  /**
   * Add folder to store
   */
  addFolder: (folder: AssetFolder) => {
    set((state) => ({
      folders: [...state.folders, folder],
    }));
  },

  /**
   * Update folder in store
   */
  updateFolder: (folderId: string, updates: Partial<AssetFolder>) => {
    set((state) => ({
      folders: state.folders.map(f => 
        f.id === folderId ? { ...f, ...updates } : f
      ),
    }));
  },

  /**
   * Delete folder and all its descendants recursively
   * Returns array of all deleted folder IDs
   */
  deleteFolder: async (folderId: string): Promise<string[]> => {
    const state = get();

    // Helper to get all descendant folder IDs recursively
    const getDescendantFolderIds = (parentId: string): string[] => {
      const children = state.folders.filter(f => f.asset_folder_id === parentId);
      const descendants: string[] = children.map(c => c.id);
      
      for (const child of children) {
        descendants.push(...getDescendantFolderIds(child.id));
      }
      
      return descendants;
    };

    // Get all folders that will be deleted
    const descendantIds = getDescendantFolderIds(folderId);
    const allFolderIdsToDelete = [folderId, ...descendantIds];

    // Call API to delete folder (backend handles cascading deletion)
    const response = await fetch(`/kodety/api/asset-folders/${folderId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete folder');
    }

    // Folder deletion can remove assets that were never present in the local
    // page/cache. Invalidate every older list/lookup so none can repopulate the
    // deleted subtree after the server ACK.
    invalidateAllAssetRequests();

    // Update state: remove deleted folders
    set((state) => ({
      folders: state.folders.filter(f => !allFolderIdsToDelete.includes(f.id)),
      isLoading: false,
    }));

    // Update state: remove assets that were in deleted folders
    set((state) => {
      const remainingAssets = state.assets.filter(asset => {
        // Keep assets that are not in any of the deleted folders
        return !asset.asset_folder_id || !allFolderIdsToDelete.includes(asset.asset_folder_id);
      });

      // Rebuild assetsById
      const assetsById: Record<string, Asset> = {};
      remainingAssets.forEach((asset) => {
        assetsById[asset.id] = asset;
      });

      return {
        assets: remainingAssets,
        assetsById,
      };
    });

    return allFolderIdsToDelete;
  },

  /**
   * Batch reorder folders after drag and drop
   * Optimistically updates UI then syncs with backend
   */
  batchReorderFolders: async (updatedFolders: AssetFolder[]) => {
    const { folders } = get();

    // Store original state for rollback
    const originalFolders = folders;

    try {
      // Optimistically update the UI
      set({
        folders: updatedFolders,
        isLoading: true,
      });

      // Batch update folders
      const updatePromises = updatedFolders.map(async (folder) => {
        const originalFolder = originalFolders.find(f => f.id === folder.id);
        if (!originalFolder) return;

        // Only update if something changed
        if (
          originalFolder.asset_folder_id !== folder.asset_folder_id ||
          originalFolder.order !== folder.order ||
          originalFolder.depth !== folder.depth
        ) {
          const response = await fetch(`/kodety/api/asset-folders/${folder.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset_folder_id: folder.asset_folder_id,
              order: folder.order,
              depth: folder.depth,
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to update folder ${folder.id}`);
          }
        }
      });

      // Wait for all updates to complete
      await Promise.all(updatePromises);

      set({ isLoading: false });
    } catch (error) {
      console.error('Failed to reorder folders:', error);
      
      // Rollback to original state on error
      set({
        folders: originalFolders,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to reorder folders',
      });
      
      throw error;
    }
  },

  /**
   * Reset store to initial state
   */
  reset: () => {
    invalidateAllAssetRequests();
    set(initialState);
  },
}));
