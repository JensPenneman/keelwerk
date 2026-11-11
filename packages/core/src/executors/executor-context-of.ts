import type { ExecutorContext } from '../contexts/executor-context.ts';
import { coreError } from '../http/core-error.ts';

const blobsArriveLater = (): Promise<never> =>
  Promise.reject(coreError('core.not_implemented', { message: 'Blobs arrive with M4.' }));

/**
 * The frozen context of one attempt (7.9.5). `blobs.read` and `write` reject with
 * `not_implemented` (`core.not_implemented`, "Blobs arrive with M4.") until the blob store exists (S-130).
 */
export function executorContextOf(
  parts: Omit<ExecutorContext<unknown>, 'blobs'>,
): ExecutorContext<unknown> {
  return Object.freeze({
    ...parts,
    blobs: Object.freeze({ read: blobsArriveLater, write: blobsArriveLater }),
  });
}
