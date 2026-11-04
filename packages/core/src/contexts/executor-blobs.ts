import type { BlobRef } from '../ids/blob-ref.ts';

/** Blob access of executors: read by reference; new blobs return as references. */
export interface ExecutorBlobs {
  read(ref: BlobRef): Promise<Uint8Array>;
  write(bytes: Uint8Array, mediaType: string): Promise<BlobRef>;
}
