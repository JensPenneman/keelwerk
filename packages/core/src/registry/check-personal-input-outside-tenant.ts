import { personalInputField } from '../effects/personal-input-field.ts';
import { personalFlagAt } from '../fields/personal-flag-at.ts';
import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityEntry } from './entity-entry.ts';
import type { StreamEntry } from './stream-entry.ts';

/**
 * `personalOutsideTenant` for what is STORED outside the tenant scope (14.7.5): erasure reaches
 * tenant units only, so a personal member in the input of an asynchronous command (its job holds
 * it) of a backend, deployment or invocation scope, or in a record of a stream whose rows are not
 * a tenant's, would sit sealed under a key that no erasure destroys. The input of a synchronous
 * command is not stored and is not refused here; a timer or an enqueue of such a command, and an
 * effect, which compose cannot see, are refused when the member is sealed (`sealPersonalMembers`).
 * A process state is a tenant's by `processTenancy`.
 */
export function checkPersonalInputOutsideTenant(
  actions: ReadonlyMap<string, ActionEntry>,
  streams: ReadonlyMap<string, StreamEntry>,
  entities: ReadonlyMap<string, EntityEntry>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const action of actions.values()) {
    if (action.kind !== 'command' || action.scope === 'tenant' || action.execution === 'sync') {
      continue;
    }
    const personal = personalInputField('commandInput', action.input);
    if (personal === undefined) continue;
    problems.push(
      compositionError(
        'personalOutsideTenant',
        `'${action.ref}' has ${action.scope} scope, runs asynchronously and takes the personal member '${personal}': its job would store the value where erasure cannot reach it, so a personal value must be handled in a tenant.`,
        { module: action.module, ref: action.ref },
      ),
    );
  }
  for (const stream of streams.values()) {
    const tenancy = entities.get(stream.readAs)?.descriptor.tenancy;
    if (tenancy === undefined || tenancy === 'tenant') continue;
    const member = Object.entries(stream.record.fields).find(
      ([, def]) => personalFlagAt('streamRecord', def) !== false,
    );
    if (member === undefined) continue;
    problems.push(
      compositionError(
        'personalOutsideTenant',
        `The stream '${stream.ref}' is keyed by '${stream.readAs}' of ${tenancy} tenancy and holds the personal member '${member[0]}': erasure reaches tenant scope only, so a personal value must live in a tenant stream.`,
        { module: stream.module, ref: stream.ref },
      ),
    );
  }
  return problems;
}
