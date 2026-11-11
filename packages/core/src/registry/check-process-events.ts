import { payloadCredentialField } from '../keys/payload-credential-field.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { processPersonalMembers } from './process-personal-members.ts';
import type { Registry } from './registry.ts';

/**
 * Errors per process manager (7.7, S-124): `processEventCredential` (an event member holds a
 * secret or a verifier, also in a list or set: the process stream is sealed per data subject, not
 * per value), `processPersonalSubject` (an event member is personal and the process does not say
 * that its subject is the instance key with `dataSubject: 'instanceKey'`, or the member's field
 * names a subject path of its own: a process names no row to walk a path on) and `processTenancy`
 * (an `on` event of an entity that does not live in a tenant: the process stream is tenant data) and
 * `processNameTaken` (an entity has the process's id: both would be a stream type, and a decision's
 * drafts could not tell them apart).
 */
export function checkProcessEvents(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const reaction of registry.reactions.values()) {
    if (!reaction.process) continue;
    const site = { module: reaction.module, ref: reaction.id };
    if (registry.entities.has(reaction.id)) {
      problems.push(
        compositionError(
          'processNameTaken',
          `The process '${reaction.id}' has the name of an entity of the app: both would be a stream type.`,
          site,
        ),
      );
    }
    for (const [event, shape] of Object.entries(reaction.eventShapes ?? {})) {
      const credential = payloadCredentialField(shape);
      if (credential === undefined) continue;
      problems.push(
        compositionError(
          'processEventCredential',
          `The process '${reaction.id}' holds a credential in the member '${credential}' of its event '${event}': process events are sealed per data subject, never per value.`,
          site,
        ),
      );
    }
    for (const { event, member, subject } of processPersonalMembers(reaction)) {
      if (subject !== null) {
        problems.push(
          compositionError(
            'processPersonalSubject',
            `The member '${member}' of the event '${event}' of the process '${reaction.id}' names the data subject '${subject}': a process has no row to follow a path on, its subject is the instance key.`,
            site,
          ),
        );
      } else if (reaction.dataSubject !== 'instanceKey') {
        problems.push(
          compositionError(
            'processPersonalSubject',
            `The member '${member}' of the event '${event}' of the process '${reaction.id}' is personal, and the process does not declare dataSubject: 'instanceKey'.`,
            site,
          ),
        );
      }
    }
    for (const type of reaction.on === 'all' ? [] : reaction.on) {
      const entity = registry.entities.get(type.slice(0, Math.max(0, type.lastIndexOf('.'))));
      if (entity === undefined || entity.descriptor.tenancy === 'tenant') continue;
      problems.push(
        compositionError(
          'processTenancy',
          `The process '${reaction.id}' reacts to '${type}', an event of the ${entity.descriptor.tenancy}-level entity '${entity.ref}': the state stream of a process lives in a tenant.`,
          site,
        ),
      );
    }
  }
  return problems;
}
