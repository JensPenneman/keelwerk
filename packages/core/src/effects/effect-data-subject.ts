import type { AnyField } from '../fields/field-def.ts';
import { personalFlagOf } from '../fields/personal-flag-of.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';

/**
 * The data-subject path of one effect input member (S-127): the field's own `.personal({ subject })`,
 * else the effect's `dataSubject`. `undefined`: the member (and its list or set element) holds no
 * personal value; `null`: it does and no subject is named.
 */
export function effectDataSubject(
  entry: Pick<EffectEntry, 'dataSubject'>,
  field: AnyField,
): string | null | undefined {
  const flag = personalFlagOf(field);
  if (flag === false) return undefined;
  return flag.subject ?? entry.dataSubject ?? null;
}
