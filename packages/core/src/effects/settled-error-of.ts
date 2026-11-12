import { coreErrorCodes } from '../errors/core-error-codes.ts';
import type { ErrorKind } from '../errors/error-kind.ts';
import { kernelOnlyErrorCodes } from '../errors/kernel-only-error-codes.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { EffectAttemptError } from './effect-attempt-error.ts';

/**
 * What a failed settle stores (7.9.5): the code when it is a core code or one an action of the
 * effect's module declares, with that code's kind; any other code is `core.internal`, and so is a
 * code only the kernel stores (`kernelOnlyErrorCodes`), so a performer cannot forge a deadline. Never the
 * message: an outside performer's text may repeat a value the input sealed. The error is not
 * retryable; its request id is a fresh one, as for the deadline's error, since a settle has no
 * attempt of its own.
 */
export function settledErrorOf(
  registry: Pick<Registry, 'actions'>,
  entry: EffectEntry,
  error: { readonly code: string },
): EffectAttemptError {
  const { code } = error;
  const requestId = newUuidV7();
  if (Object.hasOwn(coreErrorCodes, code) && !kernelOnlyErrorCodes.includes(code)) {
    const kind: ErrorKind = coreErrorCodes[code as keyof typeof coreErrorCodes].kind;
    return { kind, code, retryable: false, requestId };
  }
  for (const action of registry.actions.values()) {
    if (action.module !== entry.module) continue;
    const specs = action.errorSpecs;
    if (specs !== undefined && Object.hasOwn(specs, code)) {
      const spec = specs[code];
      if (spec !== undefined) return { kind: spec.kind, code, retryable: false, requestId };
    }
  }
  return { kind: 'internal', code: 'core.internal', retryable: false, requestId };
}
