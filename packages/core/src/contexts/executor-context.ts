import type { SecretRef } from '../ids/secret-ref.ts';
import type { ConfigOf } from '../model/config-of.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { Scope } from '../storage/scope.ts';
import type { Egress } from './egress.ts';
import type { ExecutorBlobs } from './executor-blobs.ts';

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
