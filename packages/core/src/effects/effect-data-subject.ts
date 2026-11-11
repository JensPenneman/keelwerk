import type { AnyField } from '../fields/field-def.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';

/** The personal flag of `field` or of the element field of a list or set it holds. */
function personalFlag(field: AnyField): AnyField['flags']['personal'] {
  if (field.flags.personal !== false) return field.flags.personal;
  return field.inner === null ? false : personalFlag(field.inner);
}

/**
 * The data-subject path of one effect input member (S-127): the field's own `.personal({ subject })`,
 * else the effect's `dataSubject`. `undefined`: the member (and its list or set element) holds no
 * personal value; `null`: it does and no subject is named.
 */
export function effectDataSubject(
  entry: Pick<EffectEntry, 'dataSubject'>,
  field: AnyField,
): string | null | undefined {
  const flag = personalFlag(field);
  if (flag === false) return undefined;
  return flag.subject ?? entry.dataSubject ?? null;
}
