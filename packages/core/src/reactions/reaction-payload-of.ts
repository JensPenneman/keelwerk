import type { EntityEntry } from '../registry/entity-entry.ts';
import { fieldWithheldFrom } from '../repositories/field-withheld-from.ts';

const opMaps = ['set', 'inc', 'add', 'remove', 'crdt'] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The members of a record whose names `keep` accepts. */
function kept(
  record: Readonly<Record<string, unknown>>,
  keep: (name: string) => boolean,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => keep(name)));
}

/** The `data` and `before` of an event as one reaction sees them. */
export interface ReactionPayload {
  readonly data: unknown;
  readonly before: Readonly<Record<string, unknown>> | null;
}

/**
 * What the reaction of module `authority` receives of an event's `data` and `before` (6.6, 7.7): of
 * a field-level event (`created`, `imported`, `changed`) exactly what the module would read of the
 * row, decided by `fieldWithheldFrom` (no hidden, secret or verifier member of another module's
 * entity, and no field another module contributed), from `data.values`, from each operation map of
 * `changed` and from `before`. Of a domain event whose schema is a shape, a member flagged hidden
 * is dropped for every module but the entity's own, and so is a member the schema no longer names. Any other event, and an event of a stream that
 * is no entity (`entry` undefined), passes through. A member that is no field of the entity's
 * current descriptor reaches the entity's own module only (deny by default for every other
 * module). Personal values stay as they were opened.
 */
export function reactionPayloadOf(
  entry: EntityEntry | undefined,
  name: string,
  data: unknown,
  before: unknown,
  authority: string,
): ReactionPayload {
  const asStored = { data, before: (before ?? null) as ReactionPayload['before'] };
  if (entry === undefined) return asStored;
  // Event payloads outlive deploys: a member that is no field of the current descriptor (a field
  // since removed, or one of a module no longer composed) may have been hidden when it was stored,
  // so a reaction of another module receives only what is a visible field of the descriptor now.
  const visible = (field: string): boolean =>
    entry.descriptor.fields[field] === undefined
      ? authority === entry.module
      : !fieldWithheldFrom(entry, field, authority);
  const shownBefore = isRecord(before) ? kept(before, visible) : asStored.before;
  if ((name === 'created' || name === 'imported') && isRecord(data) && isRecord(data.values)) {
    return { data: { ...data, values: kept(data.values, visible) }, before: shownBefore };
  }
  if (name === 'changed' && isRecord(data)) {
    const shown: Record<string, unknown> = { ...data };
    for (const op of opMaps) {
      const map = data[op];
      if (isRecord(map)) shown[op] = kept(map, visible);
    }
    return { data: shown, before: shownBefore };
  }
  const declared = entry.events[name];
  if (
    declared !== null &&
    declared !== undefined &&
    'kind' in declared &&
    declared.kind === 'shape' &&
    isRecord(data) &&
    authority !== entry.module
  ) {
    const fields = (declared as unknown as { readonly fields: Readonly<Record<string, unknown>> })
      .fields;
    const shown = (member: string): boolean => {
      const def = fields[member] as { readonly flags?: { readonly hidden?: unknown } } | undefined;
      return def !== undefined && def.flags?.hidden !== true;
    };
    return { data: kept(data, shown), before: shownBefore };
  }
  return { data, before: shownBefore };
}
