import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import { jsonShapeFields } from '../fields/json-shape-fields.ts';
import { holdsCredential } from '../keys/holds-credential.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { actionInputFields } from './action-input-fields.ts';

const known = new WeakMap<ActionEntry, boolean>();

/** A field, or one inside its list or set element or its json shape, that holds a credential. */
function declares(field: AnyField, seen: Set<AnyField>): boolean {
  if (holdsCredential(field)) return true;
  if (seen.has(field)) return false;
  seen.add(field);
  if (field.inner !== null && declares(field.inner as AnyField, seen)) return true;
  const members = jsonShapeFields(field);
  return members !== undefined && Object.values(members).some((member) => declares(member, seen));
}

/**
 * Whether the action's input declares a credential member: at any depth a field for which
 * `holdsCredential` holds (a secret or verifier, optional or not, a list or set of them, a member of
 * a `field.json(shape(...))`, of a list of such shapes), and for a generated `update` or `set` a
 * secret or verifier field of its entity. Exactly the members the receipt fingerprint can withhold
 * (`commandDigests`, `maskInputMembers` in `credentials` mode). A property of the action, never of a
 * call: worked out once per entry and kept in a WeakMap, only after a complete answer. For a
 * generated `update` or `set` whose entity the registry lacks it throws `internal` naming the action
 * and the entity and keeps nothing: a composed registry always has it, and a wrong `false` would be
 * kept for the life of the process and replay to a caller. The test of section 7.5's refusal.
 */
export function declaresCredentialMember(
  action: ActionEntry,
  registry: Pick<Registry, 'entities'>,
): boolean {
  const cached = known.get(action);
  if (cached !== undefined) return cached;
  const seen = new Set<AnyField>();
  let found = Object.values(actionInputFields(action) ?? {}).some((field) => declares(field, seen));
  if (
    !found &&
    (action.generated === 'update' || action.generated === 'set') &&
    action.entity !== undefined
  ) {
    const entity = registry.entities.get(action.entity);
    if (entity === undefined)
      throw errors.internal(
        `${action.ref} is a generated write of ${action.entity}, which the registry lacks`,
      );
    found = Object.values(entity.descriptor.fields).some((field) => holdsCredential(field));
  }
  known.set(action, found);
  return found;
}
