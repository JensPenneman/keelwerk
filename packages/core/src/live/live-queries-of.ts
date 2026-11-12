import type { ConditionInput } from '../conditions/condition-input.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import type { LiveQueries } from '../contexts/live-queries.ts';
import { refOf } from '../dsl/ref-of.ts';
import { plainInputMembers } from '../effects/plain-input-members.ts';
import { sealedWhereMember } from '../effects/sealed-where-member.ts';
import { errors } from '../errors/errors.ts';
import { visibleModules } from '../interpreter/visible-modules.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { LiveSource } from '../model/live-source.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { LiveEffectsSource } from './live-effects-source.ts';
import type { LiveEntitySource } from './live-entity-source.ts';

/**
 * `ctx.live` of `module` at runtime: every member answers a description the live hub runs (7.9.2).
 * `entity` names an entity of the module itself or of a module it may name (the modules it requires,
 * lists as optional, contributes to or names in a `when`, as for `ctx.load`; 15.4.11). One of
 * another module, or one the app does not have, is `internal` (the types refuse it, so a caller
 * that got here went around them). `effects` names an own effect with an outside performer (an
 * effect of another module, an executor effect or a `where` over a member the input does not keep
 * in plaintext is `internal`) and describes its pending effects.
 */
export function liveQueriesOf(
  registry: Registry,
  module: ModuleEntry,
): LiveQueries<AnyModuleBase, readonly []> {
  const visible = visibleModules(registry, module);
  const queries = {
    entity: (owner: string, entity: string, options: LiveEntitySource['options'] = {}) => {
      const ref = `${owner}.${entity}`;
      if (!visible.has(owner)) {
        throw errors.internal(
          `ctx.live.entity names "${ref}", which module "${module.id}" may not follow.`,
        );
      }
      if (!registry.entities.has(ref)) {
        throw errors.internal(`ctx.live.entity names "${ref}", which is no entity of this app.`);
      }
      const source: LiveEntitySource = { kind: 'entity', entity: ref, options };
      const description: LiveSource<unknown> = { kind: 'liveSource', source };
      return description;
    },
    effects: (
      effect: object,
      options: { readonly where?: ConditionInput; readonly after?: string } = {},
    ) => {
      const ref = refOf(effect);
      const entry = registry.effects.get(ref);
      if (entry === undefined || entry.module !== module.id) {
        throw errors.internal(
          `ctx.live.effects names "${ref}", which is no effect of module "${module.id}".`,
        );
      }
      if (entry.performer !== 'external') {
        throw errors.internal(
          `ctx.live.effects names "${ref}", which an executor performs: only an effect with an outside performer has pending effects.`,
        );
      }
      const sealed = sealedWhereMember(entry, options.where);
      if (sealed !== undefined) {
        throw errors.internal(
          `ctx.live.effects filters "${ref}" by "${sealed}", which is no plaintext member of its input.`,
        );
      }
      const source: LiveEffectsSource = {
        kind: 'effects',
        effect: ref,
        plain: plainInputMembers(entry),
        entry,
        ...(options.where === undefined ? {} : { where: normalizeCondition(options.where) }),
        ...(options.after === undefined ? {} : { after: options.after }),
      };
      const description: LiveSource<unknown> = { kind: 'liveSource', source };
      return description;
    },
  };
  // The typed `entity` is generic over the module's entities and rows; the runtime form takes plain names.
  return queries as unknown as LiveQueries<AnyModuleBase, readonly []>;
}
