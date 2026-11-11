import type { EffectEntry } from '../registry/effect-entry.ts';
import type { ExecutorEntry } from '../registry/executor-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { StoredJob } from '../storage/stored-job.ts';

/** What the units and the run of one attempt of an effect job share. */
export interface EffectAttemptJob {
  readonly stored: StoredJob;
  readonly registry: Registry;
  readonly effectId: string;
  readonly scope: Scope;
  /** Missing when the registry has no executor or effect of this name: the effect then settles `failed`. */
  readonly executor: ExecutorEntry | undefined;
  readonly entry: EffectEntry | undefined;
  /** The request id of this attempt (log, span and the error projection). */
  readonly requestId: string;
}
