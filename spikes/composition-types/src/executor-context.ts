import type { ConfigOf } from './config-of.ts';
import type { Logger, Scope, Span } from './decide-context.ts';
import type { BlobRef, SecretRef } from './id.ts';

/** What an executor may send out (section 12.3). */
export interface Egress {
  fetch(
    url: string,
    init?: {
      readonly method?: string;
      readonly body?: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ readonly status: number; text(): Promise<string> }>;
}

/** Blob access of executors: read by reference; new blobs return as references. */
export interface ExecutorBlobs {
  read(ref: BlobRef): Promise<Uint8Array>;
  write(bytes: Uint8Array, mediaType: string): Promise<BlobRef>;
}

/** The context of effect executors, the only imperative module code (section 7.9.5). */
export interface ExecutorContext<B> {
  readonly scope: Scope;
  readonly effect: { readonly id: string; readonly type: string; readonly attempt: number };
  readonly config: ConfigOf<B>;
  readonly secrets: { reveal(ref: SecretRef, reason: string): Promise<string> };
  readonly egress: Egress;
  readonly blobs: ExecutorBlobs;
  readonly log: Logger;
  readonly trace: Span;
  readonly signal: AbortSignal;
}
