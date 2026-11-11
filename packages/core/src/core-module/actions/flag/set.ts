import { defineCommand } from '../../../dsl/define-command.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { flagKeyPattern } from '../../../flags/flag-key-pattern.ts';
import { flagSlotOf } from '../../../flags/flag-slot-of.ts';
import { flagTargetingSchema } from '../../../flags/flag-targeting-schema.ts';
import { canonicalizeJson } from '../../../json/canonicalize-json.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { flag } from '../../entities/flag.ts';

/**
 * The `core.flag.set` command (20.4): an operator writes the targeting of a flag for one backend,
 * or for the deployment without `backendId`. The shape checks the targeting's structure; the
 * control-command route checks it against the flag's declaration in the backend's app before this
 * runs. The first write creates the row at version 1; the same targeting and reason again changes
 * nothing; any other write keeps the rule set it replaces as `previous`.
 */
export const set: CoreLiteral['entityActions']['flag']['set'] = defineCommand(coreBase, flag, {
  creates: true,
  // `set` is a reserved segment of an entity's REST namespace.
  hints: { rest: { path: 'rules' } },
  scope: 'deployment',
  principal: 'operator',
  input: shape({
    key: field.string({ minLength: 3, maxLength: 200, pattern: flagKeyPattern.source }),
    backendId: field.ref.own('backend').optional(),
    targeting: field.json(flagTargetingSchema),
    reason: field.string({ minLength: 1, maxLength: 500 }),
  }),
  output: shape({ id: field.ref.own('flag'), ruleVersion: field.integer() }),
  *decide(input, ctx) {
    const backendId = input.backendId ?? null;
    const current = yield* ctx.load.core.flag.one({
      where: { slot: flagSlotOf(input.key, backendId) },
    });
    if (current === undefined) {
      const id = yield* ctx.newId(flag);
      return {
        events: [
          ctx.write.core.flag.create({
            id,
            slot: flagSlotOf(input.key, backendId),
            key: input.key,
            ...(backendId === null ? {} : { backendId }),
            targeting: input.targeting,
            reason: input.reason,
          }),
        ],
        result: { id, ruleVersion: 1 },
      };
    }
    if (
      current.reason === input.reason &&
      canonicalizeJson(current.targeting) === canonicalizeJson(input.targeting)
    ) {
      return { events: [], result: { id: current.id, ruleVersion: current.version } };
    }
    if (canonicalizeJson(current.targeting) === canonicalizeJson(input.targeting)) {
      // Only the reason changes: the rule set that `previous` keeps stays reachable.
      return {
        events: [ctx.write.core.flag.update(current, { reason: input.reason })],
        result: { id: current.id, ruleVersion: current.version + 1 },
      };
    }
    return {
      events: [
        ctx.write.core.flag.update(current, {
          targeting: input.targeting,
          previous: current.targeting,
          reason: input.reason,
        }),
      ],
      result: { id: current.id, ruleVersion: current.version + 1 },
    };
  },
});
