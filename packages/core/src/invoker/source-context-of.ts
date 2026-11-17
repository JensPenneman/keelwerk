import { errors } from '../errors/errors.ts';
import type { ReadContextInput } from '../interpreter/build-read-context.ts';
import { buildReadContext } from '../interpreter/build-read-context.ts';
import { liveQueriesOf } from '../live/live-queries-of.ts';
import type { ActionEntry } from '../registry/action-entry.ts';

/**
 * The `SourceContext` of a subscription's module, a contribution's contributor (7.6): scope,
 * principal, ability, configuration, request, flags, target and log read through the module's read
 * context, plus `live`, the source descriptions the hub runs. A getter per member, so the ability
 * and the loads are built only when a source reads them. Frozen.
 */
export function sourceContextOf(
  input: ReadContextInput & { readonly action: ActionEntry },
): Readonly<Record<string, unknown>> {
  // A contribution's code runs with the contributor's context (5.3), not the target module's.
  const moduleId = input.action.contributedBy ?? input.action.module;
  const context = buildReadContext(input).forModule(moduleId);
  const owner = input.registry.modules.find((module) => module.id === moduleId);
  if (owner === undefined) {
    throw errors.internal(`The module "${moduleId}" of a subscription is not in the app.`);
  }
  const live = liveQueriesOf(input.registry, owner);
  return Object.freeze({
    get scope() {
      return context.scope;
    },
    get principal() {
      return context.principal;
    },
    get ability() {
      return context.ability;
    },
    get config() {
      return context.config;
    },
    get request() {
      return context.request;
    },
    get flags() {
      return context.flags;
    },
    get target() {
      return context.target;
    },
    get log() {
      return context.log;
    },
    live,
  });
}
