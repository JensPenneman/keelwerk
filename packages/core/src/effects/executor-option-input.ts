import type { AnyField } from '../fields/field-def.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { effectDataSubject } from './effect-data-subject.ts';

/**
 * The input an executor's `group` and `capabilityOf` read when the effect is requested (7.9.5,
 * lead 6): the sealed input of the effect, with each personal member a getter that throws
 * `refuseRequest` naming the executor, so the sealed envelope is never read as if it were the value
 * and the personal value never decides a lane. Compose refuses such a read ahead of time
 * (`executorReadsPersonal`); this is the runtime half. Anything but an object passes unchanged.
 */
export function executorOptionInput(entry: EffectEntry, input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const { fields } = entry.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  const guarded: Record<string, unknown> = { ...input };
  for (const [name, field] of Object.entries(fields ?? {})) {
    if (effectDataSubject(entry, field) === undefined || !Object.hasOwn(guarded, name)) continue;
    Object.defineProperty(guarded, name, {
      enumerable: true,
      get: () => {
        throw refuseRequest(
          `the executor ${entry.executor ?? entry.ref}`,
          `its group or capabilityOf reads the personal member "${name}" of the input, which a lane must not depend on`,
        );
      },
    });
  }
  return guarded;
}
