import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { ChangedOps } from './changed-ops.ts';
import { encodeEventValue } from './encode-event-value.ts';

type Ops = {
  set: Record<string, unknown>;
  inc: Record<string, number | string>;
  add: Record<string, unknown[]>;
  remove: Record<string, unknown[]>;
};

function notSupported(name: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'not_implemented',
    code: 'core.not_implemented',
    message: `The collaborative field "${name}" is not part of this release.`,
  });
}

function isOperation(value: unknown, ...keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Set) &&
    keys.some((key) => key in value)
  );
}

/** The `changed` payload of an update draft (section 15.1.5): the patch as field operations, and the same without the `stateOnly` fields. */
export function changedOpsOf(
  entry: EntityEntry,
  row: StorageRow,
  patch: Readonly<Record<string, unknown>>,
): { readonly full: ChangedOps; readonly stored: ChangedOps } {
  const ops: Ops = { set: {}, inc: {}, add: {}, remove: {} };
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const field = entry.descriptor.fields[name];
    if (field === undefined) {
      throw errors.validation(`${entry.ref} has no field "${name}"`, {
        issues: [{ path: [name], message: 'Unknown field.' }],
      });
    }
    if (field.kind === 'richText' || field.merge === 'sequence' || field.merge === 'richText') {
      throw notSupported(name);
    }
    if (value === null) {
      ops.set[name] = null;
    } else if (field.merge === 'counter' && isOperation(value, 'inc')) {
      ops.inc[name] = encodeEventValue(value.inc) as number | string;
    } else if (field.kind === 'set' && value instanceof Set) {
      const was = row[name] instanceof Set ? (row[name] as ReadonlySet<unknown>) : new Set();
      const added = [...value].filter((member) => !was.has(member));
      const removed = [...was].filter((member) => !value.has(member));
      if (added.length > 0) ops.add[name] = added.map(encodeEventValue);
      if (removed.length > 0) ops.remove[name] = removed.map(encodeEventValue);
    } else if (field.kind === 'set' && isOperation(value, 'add', 'remove')) {
      const { add, remove } = value as { add?: readonly unknown[]; remove?: readonly unknown[] };
      if (add !== undefined) ops.add[name] = add.map(encodeEventValue);
      if (remove !== undefined) ops.remove[name] = remove.map(encodeEventValue);
    } else {
      ops.set[name] = encodeEventValue(value);
    }
  }
  const pick = <T>(source: Record<string, T>, stored: boolean): Record<string, T> | undefined => {
    const kept = Object.entries(source).filter(
      ([name]) => !(stored && entry.descriptor.fields[name]?.stateOnly === true),
    );
    return kept.length === 0 ? undefined : Object.fromEntries(kept);
  };
  const build = (stored: boolean): ChangedOps => {
    const set = pick(ops.set, stored);
    const inc = pick(ops.inc, stored);
    const add = pick(ops.add, stored);
    const remove = pick(ops.remove, stored);
    return {
      ...(set === undefined ? {} : { set }),
      ...(inc === undefined ? {} : { inc }),
      ...(add === undefined ? {} : { add }),
      ...(remove === undefined ? {} : { remove }),
    };
  };
  return { full: build(false), stored: build(true) };
}
