import { prepareProjectForDraftTransport } from './project-io';
import type { HtmlProject, HtmlProjectFile } from './types';

export type WordPressDraftDeltaEncoding = 'utf8' | 'base64';

export interface WordPressDraftDeltaUpsert {
  path: string;
  encoding: WordPressDraftDeltaEncoding;
  content: string;
  byteLength: number;
  sha256: string;
}

export interface WordPressDraftDeltaMove {
  from: string;
  to: string;
}

export interface WordPressDraftDeltaRequest {
  protocolVersion: 1;
  baseRevision: number;
  baseDigest?: string;
  requestId: string;
  upserts: WordPressDraftDeltaUpsert[];
  deletes: string[];
  moves: WordPressDraftDeltaMove[];
}

export interface WordPressDraftDeltaLimits {
  maxRawBytes: number;
  maxBodyBytes: number;
  maxOperations: number;
  maxPathBytes: number;
}

export type WordPressDraftDeltaPlan =
  | {
      kind: 'delta';
      request: WordPressDraftDeltaRequest;
      body: string;
      rawBytes: number;
      bodyBytes: number;
      operationCount: number;
    }
  | {
      kind: 'zip';
      reason: 'crypto-unavailable' | 'invalid-base-revision' | 'limit' | 'unsafe-path';
    };

interface CreateWordPressDraftDeltaOptions extends WordPressDraftDeltaLimits {
  baseRevision: number;
  baseDigest?: string;
  requestId?: string;
  updatedAt?: string;
}

const METADATA_PATH = '.incode/project.json';

export function createWordPressDraftDeltaRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `draft-delta-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}

function safeDeltaPath(path: string, maxPathBytes: number) {
  if (
    !path
    || path.startsWith('/')
    || /^[A-Za-z]:/.test(path)
    || path.includes('\\')
    || path.includes('\0')
    || path.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) return false;
  return new TextEncoder().encode(path).byteLength <= maxPathBytes;
}

/** The ZIP persists bytes only; mimeType is editor metadata and is therefore
 * deliberately excluded from file equality and move detection. */
function sameTransportBytes(left: HtmlProjectFile, right: HtmlProjectFile) {
  if (left === right) return true;
  if (left.text !== undefined || right.text !== undefined) {
    return left.text !== undefined && right.text !== undefined && left.text === right.text;
  }
  if (left.data || right.data) return Boolean(left.data && right.data && left.data === right.data);
  return true;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)));
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function fileBytes(file: HtmlProjectFile) {
  return file.text !== undefined
    ? { encoding: 'utf8' as const, bytes: new TextEncoder().encode(file.text), content: file.text }
    : {
        encoding: 'base64' as const,
        bytes: file.data || new Uint8Array(),
        content: '',
      };
}

/**
 * Diff two acknowledged authoring snapshots into whole-file operations. The
 * function never emits a partial file and never reads unchanged binary bytes.
 * If the bounded JSON contract cannot represent the exact change safely, the
 * caller receives a pre-request ZIP decision instead.
 */
export async function createWordPressDraftDelta(
  acknowledgedProject: HtmlProject,
  nextProject: HtmlProject,
  options: CreateWordPressDraftDeltaOptions,
): Promise<WordPressDraftDeltaPlan> {
  if (!Number.isSafeInteger(options.baseRevision) || options.baseRevision < 0) {
    return { kind: 'zip', reason: 'invalid-base-revision' };
  }
  if (!globalThis.crypto?.subtle) return { kind: 'zip', reason: 'crypto-unavailable' };

  // A shared timestamp makes metadata comparisons deterministic. The next
  // metadata file is still always upserted so its updatedAt matches a ZIP save.
  const updatedAt = options.updatedAt || new Date().toISOString();
  const previous = prepareProjectForDraftTransport(acknowledgedProject, updatedAt);
  const next = prepareProjectForDraftTransport(nextProject, updatedAt);
  const previousPaths = Object.keys(previous.files).sort();
  const nextPaths = Object.keys(next.files).sort();
  if (
    previousPaths.some(path => !safeDeltaPath(path, options.maxPathBytes))
    || nextPaths.some(path => !safeDeltaPath(path, options.maxPathBytes))
  ) return { kind: 'zip', reason: 'unsafe-path' };

  const removed = previousPaths.filter(path => !(path in next.files) && path !== METADATA_PATH);
  const added = nextPaths.filter(path => !(path in previous.files) && path !== METADATA_PATH);
  const movedSources = new Set<string>();
  const movedDestinations = new Set<string>();
  const moves: WordPressDraftDeltaMove[] = [];
  type MoveBucket = { paths: string[]; offset: number };
  const removedText = new Map<string, MoveBucket>();
  const removedBinary = new WeakMap<Uint8Array, MoveBucket>();
  const removedEmpty: MoveBucket = { paths: [], offset: 0 };
  const appendMoveSource = (bucket: MoveBucket | undefined, path: string) => {
    const target = bucket || { paths: [], offset: 0 };
    target.paths.push(path);
    return target;
  };
  removed.forEach(path => {
    const file = previous.files[path];
    if (file.text !== undefined) {
      removedText.set(file.text, appendMoveSource(removedText.get(file.text), path));
    } else if (file.data) {
      removedBinary.set(file.data, appendMoveSource(removedBinary.get(file.data), path));
    } else {
      removedEmpty.paths.push(path);
    }
  });
  const takeMoveSource = (file: HtmlProjectFile) => {
    const bucket = file.text !== undefined
      ? removedText.get(file.text)
      : file.data
        ? removedBinary.get(file.data)
        : removedEmpty;
    if (!bucket || bucket.offset >= bucket.paths.length) return '';
    const source = bucket.paths[bucket.offset];
    bucket.offset += 1;
    return source;
  };

  // Rename helpers preserve text values and binary UintArray identity. Pairing
  // only an added path with an actually removed path prevents overwriting a
  // live destination. Indexed buckets keep large replacements linear instead
  // of comparing every added path with every removed path.
  added.forEach(to => {
    const source = takeMoveSource(next.files[to]);
    if (!source) return;
    movedSources.add(source);
    movedDestinations.add(to);
    moves.push({ from: source, to });
  });

  const deletes = removed.filter(path => !movedSources.has(path));
  const upsertPaths = nextPaths.filter(path => (
    path === METADATA_PATH
    || (!movedDestinations.has(path) && (
      !(path in previous.files)
      || !sameTransportBytes(previous.files[path], next.files[path])
    ))
  ));
  const operationCount = moves.length + deletes.length + upsertPaths.length;
  if (operationCount > options.maxOperations) return { kind: 'zip', reason: 'limit' };

  const preparedUpserts = upsertPaths.map(path => ({ path, ...fileBytes(next.files[path]) }));
  const rawBytes = preparedUpserts.reduce((total, item) => total + item.bytes.byteLength, 0);
  if (rawBytes > options.maxRawBytes) return { kind: 'zip', reason: 'limit' };

  const upserts = await Promise.all(preparedUpserts.map(async item => ({
    path: item.path,
    encoding: item.encoding,
    content: item.encoding === 'utf8' ? item.content : bytesToBase64(item.bytes),
    byteLength: item.bytes.byteLength,
    sha256: await sha256(item.bytes),
  })));
  const request: WordPressDraftDeltaRequest = {
    protocolVersion: 1,
    baseRevision: options.baseRevision,
    ...(options.baseDigest ? { baseDigest: options.baseDigest } : {}),
    requestId: options.requestId || createWordPressDraftDeltaRequestId(),
    upserts,
    deletes,
    moves,
  };
  const body = JSON.stringify(request);
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (bodyBytes > options.maxBodyBytes) return { kind: 'zip', reason: 'limit' };
  return { kind: 'delta', request, body, rawBytes, bodyBytes, operationCount };
}
