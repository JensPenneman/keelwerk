import type { LiveQueries } from '../contexts/live-queries.ts';
import { errors } from '../errors/errors.ts';
import { visibleModules } from '../interpreter/visible-modules.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { LiveSource } from '../model/live-source.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { LiveEntitySource } from './live-entity-source.ts';

/**
 * `ctx.live` of `module` at runtime: every member answers a description the live hub runs (7.9.2).
 * `entity` names an entity of the module itself or of a module it may name (the modules it requires,
 * lists as optional, contributes to or names in a `when`, as for `ctx.load`; 15.4.11). One of
 * another module, or one the app does not have, is `internal` (the types refuse it, so a caller
 * that got here went around them).
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
  };
  // The typed `entity` is generic over the module's entities and rows; the runtime form takes plain names.
  return queries as unknown as LiveQueries<AnyModuleBase, readonly []>;
}
