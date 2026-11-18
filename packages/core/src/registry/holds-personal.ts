import type { FieldDescriptor } from '../storage/field-descriptor.ts';

/** Whether a field holds a personal value, itself or in its element (a set or list of personal values). */
export function holdsPersonal(field: FieldDescriptor): boolean {
  return field.personal !== false || (field.inner !== null && holdsPersonal(field.inner));
}
