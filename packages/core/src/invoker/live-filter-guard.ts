import type { Condition } from '../conditions/condition.ts';
import { conditionFields } from '../conditions/condition-fields.ts';
import { normalizerRegistry } from '../encryption/normalizer-registry.ts';
import { planEncryption } from '../encryption/plan-encryption.ts';
import type { PlannerContext } from '../encryption/planner-context.ts';
import { verifyUnsealed } from '../encryption/verify-unsealed.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/** What a live filter is checked and evaluated with. */
export interface LiveFilterGuard {
  /**
   * Refuses what a `query` of the same filter refuses: a field no client sees (hidden, secret or
   * verifier) is `forbidden`, and a comparison a personal field's declared capabilities cannot answer
   * is what the encryption planner answers (`core.personal_operator`, `core.personal_needle_short`).
   */
  check(filter: Condition): Promise<void>;
  /** The filter on a post-image, with the personal fields' normalisers applied to the stored value and the operand alike. */
  matches(filter: Condition, row: StorageRow): boolean;
}

/**
 * The filter rules of a live stream (15.4.3 step 2). The planner runs only for its refusals: the key
 * it is given derives no tag anyone sees, and the planned condition is dropped.
 */
export function liveFilterGuard(registry: Registry, entry: EntityEntry): LiveFilterGuard {
  const { descriptor } = entry;
  const context: PlannerContext = {
    describe: (ref) => registry.entities.get(ref)?.descriptor,
    normalizers: normalizerRegistry(),
    indexKeys: { fieldKey: () => Promise.resolve(new Uint8Array(32)) },
  };
  return {
    check: async (filter) => {
      const hidden = conditionFields(filter).fields.filter((path) => {
        const field = descriptor.fields[path.split('.')[0] ?? path];
        return (
          field !== undefined &&
          (field.hidden !== false ||
            field.sealed ||
            field.kind === 'secret' ||
            field.kind === 'verifier')
        );
      });
      if (hidden.length > 0) {
        throw new KeelwerkError({
          kind: 'forbidden',
          code: 'core.forbidden',
          message: `A live filter may not name ${hidden.map((name) => `"${name}"`).join(', ')}.`,
          issues: hidden.map((path) => ({
            path: ['filter', path],
            message: 'The field is not available to a filter.',
          })),
        });
      }
      await planEncryption(context, descriptor, filter);
    },
    matches: (filter, row) => verifyUnsealed(context, descriptor, filter, [row]).length === 1,
  };
}
