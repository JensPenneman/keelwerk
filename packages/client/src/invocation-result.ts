import type { ClientError } from './client-error.ts';
import type { EffectReferences } from './effect-references.ts';

/** What one invocation came to, before `invoke` throws and `attempt` returns it. */
export type InvocationResult =
  | {
      readonly ok: true;
      readonly value: unknown;
      /** The command id sent; absent for a query. */
      readonly commandId?: string;
      /** The effect references the envelope reported; absent when it listed none. */
      readonly effects?: EffectReferences;
    }
  | { readonly ok: false; readonly error: ClientError };
