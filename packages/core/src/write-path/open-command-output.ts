import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Unit } from '../storage/unit.ts';

const decoder = new TextDecoder();

async function openMember(
  unit: Unit,
  binding: { readonly entity: string; readonly id: string; readonly field: string },
  field: AnyField,
  value: unknown,
): Promise<unknown> {
  if (field.kind === 'secret') {
    if (typeof value !== 'string') return value;
    const sealed = parseSealedValueText(value);
    if (sealed === undefined) return value;
    const plain = await unit.keys.openValue(sealed, binding);
    if (plain === undefined) {
      throw errors.conflict(
        'The stored output can no longer be read; send the command again with a new command id.',
      );
    }
    return decoder.decode(plain);
  }
  const { inner } = field;
  if (inner === null || !Array.isArray(value)) return value;
  return Promise.all(value.map((member) => openMember(unit, binding, inner, member)));
}

/**
 * A receipt's stored value for a replay to its submitter (15.1.7, S-127; `assertSameRequest` keeps
 * other principals out): each `kwv1` string in a secret member is opened with `unit.keys.openValue`
 * against the binding the receipt sealed it under (`core.commandReceipt`, `commandId`,
 * `outcome.<member>`) and answered as plaintext; `{ ref }` members and texts that are no `kwv1` pass unchanged.
 * Throws `conflict` "The stored output can no longer be read; send the command again with a new
 * command id." when a key is gone or was sealed for another command or effect (a text a command
 * of an earlier version stored as plaintext).
 */
export async function openCommandOutput(
  unit: Unit,
  commandId: string,
  action: ActionEntry,
  value: unknown,
): Promise<unknown> {
  const { fields } = action.output as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const opened: Record<string, unknown> = { ...value };
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(opened, name)) continue;
    const binding = { entity: 'core.commandReceipt', id: commandId, field: `outcome.${name}` };
    opened[name] = await openMember(unit, binding, field, opened[name]);
  }
  return opened;
}
