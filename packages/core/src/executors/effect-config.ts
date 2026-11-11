import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/**
 * The configuration an executor attempt reads: `value` is what `ctx.config` answers (secret members
 * as references of the module) and `shape` the module's config shape, which names the secret
 * members the executor may reveal; absent for a module without one.
 */
export interface EffectConfig {
  readonly value: unknown;
  readonly shape: StandardSchemaV1 | undefined;
}
