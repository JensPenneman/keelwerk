import { payloadCredentialField } from '../keys/payload-credential-field.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { dataSubjectPathProblem } from './data-subject-path-problem.ts';
import { entityPathHead } from './entity-path-head.ts';
import { referenceTarget } from './reference-target.ts';
import type { Registry } from './registry.ts';
import { streamPersonalMembers } from './stream-personal-members.ts';

/**
 * Errors per stream: `streamKeyNotReference` (the key is not a `ref` field, or it names no entity
 * of the app), `streamReadAsUnknown` (`readAs` is no entity), `streamReadAsNotKeyed` (`readAs` is
 * not the keyed entity, so a subscriber would be authorized against a row of another entity),
 * `streamNameTaken` (an entity `<module>.<name>` exists: both would sit under
 * `ctx.write.<module>.<name>`), `streamDataSubject` (the subject path of a personal record
 * member, or of a personal element a list or set member holds, does not resolve on the keyed
 * entity, 14.7.4) and `streamRecordCredential` (a record member holds a credential: records are
 * sealed per subject, not per value, so a secret or verifier would be stored in clear).
 */
export function checkStreamDeclarations(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const stream of registry.streams.values()) {
    const site = { module: stream.module, ref: stream.ref };
    const target = referenceTarget(stream.key.ref, stream.module);
    if (target === null || !registry.entities.has(`${target.module}.${target.entity}`)) {
      problems.push(
        compositionError(
          'streamKeyNotReference',
          `The key of the stream '${stream.ref}' must reference an entity of the app.`,
          site,
        ),
      );
    }
    if (!registry.entities.has(stream.readAs)) {
      problems.push(
        compositionError(
          'streamReadAsUnknown',
          `The stream '${stream.ref}' is read as '${stream.readAs}', which is no entity.`,
          site,
        ),
      );
    }
    const keyed =
      target === null ? undefined : registry.entities.get(`${target.module}.${target.entity}`);
    if (
      target !== null &&
      registry.entities.has(stream.readAs) &&
      stream.readAs !== `${target.module}.${target.entity}`
    ) {
      problems.push(
        compositionError(
          'streamReadAsNotKeyed',
          `The stream '${stream.ref}' is read as '${stream.readAs}', which is not the entity '${target.module}.${target.entity}' its key references.`,
          site,
        ),
      );
    }
    if (keyed !== undefined) {
      const describe = (ref: string) => registry.entities.get(ref)?.descriptor;
      const head = entityPathHead(keyed.descriptor);
      const paths = new Set<string>();
      for (const { path } of streamPersonalMembers(stream, keyed.descriptor.dataSubject)) {
        paths.add(path);
      }
      for (const path of paths) {
        const reason = dataSubjectPathProblem(describe, head, path);
        if (reason === undefined) continue;
        problems.push(
          compositionError(
            'streamDataSubject',
            `The stream '${stream.ref}' names the data subject '${path}', ${reason}`,
            site,
          ),
        );
      }
    }
    const credential = payloadCredentialField(stream.record);
    if (credential !== undefined) {
      problems.push(
        compositionError(
          'streamRecordCredential',
          `The stream '${stream.ref}' holds a credential in the record member '${credential}': records are stored as they are appended, so a secret or verifier would be kept in clear.`,
          site,
        ),
      );
    }
    if (registry.entities.has(stream.ref)) {
      problems.push(
        compositionError(
          'streamNameTaken',
          `The stream '${stream.ref}' has the name of an entity of its module.`,
          site,
        ),
      );
    }
  }
  return problems;
}
