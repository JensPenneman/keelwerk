import { entityPositions } from '../api-versions/entity-positions.ts';
import { isMemberRecord } from '../api-versions/is-member-record.ts';
import { newerSideRef } from '../api-versions/newer-side-ref.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';
import type { VersionChangeEntry } from './version-change-entry.ts';

/** Names an older field cannot take: a row carries them itself, or a filter reads them as operators. */
const reservedNames: ReadonlySet<string> = new Set([
  'id',
  'version',
  'createdAt',
  'updatedAt',
  'archivedAt',
  '$masked',
  'and',
  'or',
  'not',
]);

/** Said with every refusal of a change that does not fit its point. */
const orderNote =
  'Changes adopted at one date apply in the order of their since and then their id (the changes of one module together, modules in the order they are listed).';

function invalid(change: VersionChangeEntry, message: string): CompositionProblem {
  return compositionError('invalidVersionChange', `The change '${change.id}' ${message}`, {
    module: change.module,
    ref: change.id,
  });
}

/** Whether `action` creates rows of `entity` that carry `field` (its head name): a generated create or set, or a declared action whose input names it. */
function createsWith(action: ActionEntry, entity: string, field: string): boolean {
  const positions = entityPositions(action);
  if (positions?.entity !== entity || positions.inputRows.length === 0) return false;
  if (action.generated === 'create' || action.generated === 'set') return true;
  if (action.generated !== undefined) return false;
  const members: unknown = Reflect.get(action.input, 'fields');
  return isMemberRecord(members) && Object.hasOwn(members, field);
}

/**
 * The compose check of the changes themselves (section 18.2), walked the way the surface undoes
 * them: from the head, newest change first, each against the names as they stand at that point.
 * A renamed or added field must exist there, and an older or removed name must be free (not a
 * field, not another change's older name, not a system member, not a relation); an action rename
 * likewise on the references. An added required field needs a declared default or a custom input
 * transform for every action that creates rows with it. An older error code must be the module's
 * own and unused at the head.
 */
export function checkVersionChangeChain(
  registry: Registry,
  ordered: readonly VersionChangeEntry[],
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const fieldsAt = new Map<string, Set<string>>();
  const fieldsOf = (entity: string): Set<string> => {
    let names = fieldsAt.get(entity);
    if (names === undefined) {
      names = new Set(Object.keys(registry.entities.get(entity)?.descriptor.fields ?? {}));
      fieldsAt.set(entity, names);
    }
    return names;
  };
  const headNames = new Map<string, Map<string, string>>();
  const headNameAt = (entity: string, name: string): string =>
    headNames.get(entity)?.get(name) ?? name;
  const refs = new Set(registry.actions.keys());
  const headCodes = new Set([
    ...Object.keys(coreErrorCodes),
    ...[...registry.actions.values()].flatMap((action) => action.errors),
  ]);
  for (const [index, change] of [...ordered.entries()].reverse()) {
    const newer = ordered.slice(index + 1);
    const refuse = (message: string): void => {
      problems.push(invalid(change, `${message} ${orderNote}`));
    };
    for (const spec of [...change.surface].reverse()) {
      const older = spec.renamedFrom;
      if (spec.action !== undefined) {
        if (!refs.has(spec.action)) {
          refuse(`renames the action '${spec.action}', which the app lacks at that point.`);
        } else if (older === undefined) {
          continue;
        } else if (refs.has(older)) {
          refuse(`renames from '${older}', which is an action at that point.`);
        } else if (!older.startsWith(`${change.module}.`)) {
          refuse(`renames from '${older}', which is outside its module.`);
        } else {
          refs.delete(spec.action);
          refs.add(older);
        }
        continue;
      }
      if (spec.field === undefined) continue;
      if (spec.entity === undefined) {
        refuse(`changes the field '${spec.field}' of an entity its module does not own.`);
        continue;
      }
      const names = fieldsOf(spec.entity);
      const where = `'${spec.entity}.${spec.field}'`;
      const olderName = spec.removed === true ? spec.field : older;
      if (olderName !== undefined) {
        const relations = registry.entities.get(spec.entity)?.descriptor.relations ?? {};
        if (reservedNames.has(olderName) || Object.hasOwn(relations, olderName)) {
          refuse(`uses '${olderName}' for ${where}, a system member, operator or relation name.`);
          continue;
        }
        if (names.has(olderName)) {
          refuse(
            spec.removed === true
              ? `removes ${where}, which is a field at that point.`
              : `renames from '${olderName}', which is a field of '${spec.entity}' at that point.`,
          );
          continue;
        }
      }
      if (spec.removed === true) {
        names.add(spec.field);
        continue;
      }
      if (!names.has(spec.field)) {
        refuse(`changes ${where}, which is not a field at that point.`);
        continue;
      }
      const head = headNameAt(spec.entity, spec.field);
      names.delete(spec.field);
      if (older !== undefined) {
        names.add(older);
        const known = headNames.get(spec.entity) ?? new Map<string, string>();
        known.set(older, head);
        headNames.set(spec.entity, known);
      }
      if (spec.addedRequired === true) {
        const defaults = registry.entities.get(spec.entity)?.behaviour?.defaults;
        if (defaults !== undefined && Object.hasOwn(defaults, head)) continue;
        for (const action of registry.actions.values()) {
          if (
            createsWith(action, spec.entity, head) &&
            change.input[newerSideRef(newer, action.ref)] === undefined
          ) {
            refuse(
              `adds the required field ${where}, which has no declared default (under its current name '${head}') and no input transform for '${action.ref}'.`,
            );
          }
        }
      }
    }
    for (const [head, older] of Object.entries(change.errors)) {
      if (headCodes.has(older)) {
        problems.push(
          invalid(
            change,
            `maps '${head}' to '${older}', which is an error code of the app or the core.`,
          ),
        );
      } else if (!older.startsWith(`${change.module}.`)) {
        problems.push(
          invalid(change, `maps '${head}' to '${older}', which is outside its module.`),
        );
      }
    }
  }
  return problems;
}
