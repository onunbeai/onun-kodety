import type { WordPressDraftSavePayload } from './editor-wordpress-helpers';

interface ReplacementUpload {
  response: Response;
  payload: WordPressDraftSavePayload | null;
}

interface ReplacementReceipt {
  projectId: string;
  projectDigest: string;
  workspaceRevision: number;
  cssDigest: string;
  templateDigest: string;
}

/** A lost ZIP response is not evidence that the workspace was not committed. */
export async function resolveWordPressReplacementUpload(options: {
  upload: () => Promise<ReplacementUpload>;
  readReceipt: () => Promise<ReplacementReceipt>;
  projectId: string;
  projectDigest: string;
  baseRevision: number;
  assertCurrent: () => void;
  signal?: AbortSignal;
}): Promise<ReplacementUpload> {
  let uploaded: ReplacementUpload | undefined;
  let uploadError: unknown;
  try {
    uploaded = await options.upload();
    const payload = uploaded.payload;
    const savedAt = Date.parse(payload?.savedAt || '');
    if (
      uploaded.response.ok
      && payload?.success === true
      && payload.projectId?.trim().toLowerCase() === options.projectId.toLowerCase()
      && payload.projectDigest?.toLowerCase() === options.projectDigest.toLowerCase()
      && Number.isSafeInteger(payload.workspaceRevision)
      && payload.workspaceRevision! > options.baseRevision
      && /^[a-f0-9]{64}$/i.test(payload.cssDigest || payload.workspaceDigest || '')
      && Number.isFinite(savedAt)
    ) return uploaded;
    // A definite rejection is actionable immediately. Conflicts can be the
    // retry of a committed ZIP; gateway errors and malformed success responses
    // can both hide a successful commit, so read the actual workspace first.
    if (
      !uploaded.response.ok
      && uploaded.response.status !== 408
      && uploaded.response.status !== 409
      && uploaded.response.status < 500
    ) {
      return uploaded;
    }
  } catch (error) {
    uploadError = error;
  }
  options.signal?.throwIfAborted();
  options.assertCurrent();
  try {
    const receipt = await options.readReceipt();
    options.signal?.throwIfAborted();
    options.assertCurrent();
    if (
      receipt.projectId.trim().toLowerCase() === options.projectId.toLowerCase()
      && /^[a-f0-9]{64}$/i.test(receipt.projectDigest)
      && receipt.projectDigest.toLowerCase() === options.projectDigest.toLowerCase()
      && Number.isSafeInteger(receipt.workspaceRevision)
      && receipt.workspaceRevision > options.baseRevision
      && /^[a-f0-9]{64}$/i.test(receipt.cssDigest)
    ) {
      // This timestamp is the observation of the committed snapshot. The
      // identity, full path/byte digest and newer server revision prove which
      // write is active without issuing a compensating destructive upload.
      return {
        response: new Response(null, { status: 200 }),
        payload: { success: true, ...receipt, savedAt: new Date().toISOString() },
      };
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    options.assertCurrent();
    if (!uploadError) uploadError = error;
  }
  if (uploaded) return uploaded;
  throw uploadError || new Error('Não foi possível confirmar a criação do projeto. A edição anterior permanece disponível para recuperação.');
}
