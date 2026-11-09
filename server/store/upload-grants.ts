import { ApiError } from '../http/middleware/errors.js';
import type { Doc, UploadFinalization, UploadReceipt } from './types.js';

export function uploadReceiptKey(id: string): string {
  if (!/^media_[a-f0-9]{32}$/.test(id)) throw new Error('Invalid upload grant id');
  return 'upload-grant-' + id;
}

/** Called inside the document transaction as well as before expensive copies. */
export async function uploadResult(upload: UploadFinalization, read: (id: string) => Promise<UploadReceipt | null>): Promise<Doc | null> {
  if (!upload.grantIds.length || upload.grantIds.length > 2 || new Set(upload.grantIds).size !== upload.grantIds.length || !/^[a-f0-9]{64}$/.test(upload.fingerprint)) throw new Error('Invalid upload finalization');
  const receipts = await Promise.all(upload.grantIds.map(id => read(uploadReceiptKey(id))));
  if (receipts.some(receipt => receipt && receipt.fingerprint !== upload.fingerprint)) throw new ApiError(409, 'upload_consumed', 'Upload ticket has already been used');
  if (receipts.some(Boolean) && !receipts.every(Boolean)) throw new ApiError(409, 'upload_consumed', 'Upload ticket has already been used');
  return receipts[0]?.doc ?? null;
}
