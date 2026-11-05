import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { PersonalDeclaration } from './personal-declaration.ts';

/** A personal field of an entity with its declaration. */
export interface PersonalField {
  readonly name: string;
  readonly field: FieldDescriptor;
  readonly personal: PersonalDeclaration;
}

/** The personal fields of an entity, in declaration order. */
export function personalFieldsOf(entity: EntityDescriptor): readonly PersonalField[] {
  const found: PersonalField[] = [];
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.personal !== false) found.push({ name, field, personal: field.personal });
  }
  return found;
}
