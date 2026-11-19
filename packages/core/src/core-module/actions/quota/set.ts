import { defineCommand } from '../../../dsl/define-command.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { quotaSlotOf } from '../../../quotas/quota-slot-of.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { quota } from '../../entities/quota.ts';

/**
 * The `core.quota.set` command (12.2, S-142): an operator writes one tenant's limit of one
 * dimension; a backend's own values are its configuration (`config.core.quotas`). `limit:
 * 'default'` removes the override. The control-command route checks the dimension, the limit and
 * the tenant against the backend's app and stores the limit in its canonical form before this runs.
 * The first write creates the row at version 1 (a first `default` creates it without a limit, so
 * the reason stays in the history); the same limit and reason again changes nothing.
 */
export const set: CoreLiteral['entityActions']['quota']['set'] = defineCommand(coreBase, quota, {
  creates: true,
  // `set` is a reserved segment of an entity's REST namespace.
  hints: { rest: { path: 'limit' } },
  scope: 'deployment',
  principal: 'operator',
  input: shape({
    dimension: field.string({ minLength: 1, maxLength: 200 }),
    backendId: field.ref.own('backend'),
    tenantId: field.ref.own('tenant'),
    limit: field.string({ minLength: 1, maxLength: 40 }),
    reason: field.string({ minLength: 1, maxLength: 500 }),
  }),
  output: shape({ id: field.ref.own('quota'), version: field.integer() }),
  *decide(input, ctx) {
    const stored = input.limit === 'default' ? null : input.limit;
    const slot = quotaSlotOf(input.dimension, input.backendId, input.tenantId);
    const current = yield* ctx.load.core.quota.one({ where: { slot } });
    if (current === undefined) {
      const id = yield* ctx.newId(quota);
      return {
        events: [
          ctx.write.core.quota.create({
            id,
            slot,
            dimension: input.dimension,
            backendId: input.backendId,
            tenantId: input.tenantId,
            ...(stored === null ? {} : { limit: stored }),
            reason: input.reason,
          }),
        ],
        result: { id, version: 1 },
      };
    }
    if ((current.limit ?? null) === stored && current.reason === input.reason) {
      return { events: [], result: { id: current.id, version: current.version } };
    }
    return {
      events: [ctx.write.core.quota.update(current, { limit: stored, reason: input.reason })],
      result: { id: current.id, version: current.version + 1 },
    };
  },
});
