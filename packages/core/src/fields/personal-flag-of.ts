import type { AnyField } from './field-def.ts';

/** The personal flag of `field`, or of the personal element a list or set holds; false when it holds none. */
export function personalFlagOf(field: AnyField): AnyField['flags']['personal'] {
  if (field.flags.personal !== false) return field.flags.personal;
  return field.inner === null ? false : personalFlagOf(field.inner);
}
