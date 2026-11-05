import type { FieldDescriptor } from '../storage/field-descriptor.ts';

/** What a personal field declares (14.7.9.2): the `personal` member of its descriptor, never `false`. */
export type PersonalDeclaration = Exclude<FieldDescriptor['personal'], false>;
