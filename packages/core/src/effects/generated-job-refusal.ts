import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import { holdsCredential } from '../keys/holds-credential.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { holdsPersonal } from '../registry/holds-personal.ts';
import type { Registry } from '../registry/registry.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { generatedRecordsOf } from '../write-path/generated-records.ts';

type Fields = Readonly<Record<string, FieldDescriptor>>;

/**
 * The first member of `record` that `holds` finds in the entity's fields and the record has a value
 * for, as a path.
 */
function firstMember(
  fields: Fields,
  record: Readonly<Record<string, unknown>>,
  prefix: readonly string[],
  holds: (field: FieldDescriptor) => boolean,
): string | undefined {
  for (const [name, field] of Object.entries(fields)) {
    const value = record[name];
    if (value !== undefined && value !== null && holds(field)) {
      return [...prefix, name].join('.');
    }
  }
  return undefined;
}

/**
 * The refusal of a job row that would hold a credential or personal value unsealed, or
 * `undefined`. The kernel seals the top-level members of a job's input that the action declares,
 * and a generated write declares only the entity's own fields at the top level of a create: the
 * `patch` of an update is a json member and the items of a set are not declared at all, so a
 * credential or personal value in them would be stored in clear. Only a generated `create`,
 * `update` or `set` whose entity is in the registry is looked at: a verifier field of a create (a
 * verifier is never sealed in a job), and in a record of an update or set a verifier, a secret or a
 * personal field. The message names the action and the member's path, never a value: an item of a
 * map is `create.*` or `update.*`, because its key is an input value.
 */
export function generatedJobRefusal(
  registry: Registry,
  action: ActionEntry,
  input: unknown,
): KeelwerkError | undefined {
  const { generated } = action;
  if (generated !== 'create' && generated !== 'update' && generated !== 'set') return undefined;
  if (action.entity === undefined || typeof input !== 'object' || input === null) return undefined;
  const fields = registry.entities.get(action.entity)?.descriptor.fields;
  if (fields === undefined) return undefined;
  const found =
    generated === 'create'
      ? firstMember(
          fields,
          input as Readonly<Record<string, unknown>>,
          [],
          (field) => field.kind === 'verifier',
        )
      : generatedRecordsOf(action, input)
          .map((generatedRecord) =>
            firstMember(
              fields,
              generatedRecord.record,
              generatedRecord.label,
              (field) => holdsCredential(field) || holdsPersonal(field),
            ),
          )
          .find((path) => path !== undefined);
  if (found === undefined) return undefined;
  return refuseRequest(
    `the job of "${action.ref}"`,
    `its input would store the member '${found}' unsealed: write such a value in the decision that has it`,
  );
}
