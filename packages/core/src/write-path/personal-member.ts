/**
 * A member of a command's input (or of a record inside it) that holds a value and that is declared
 * personal: its name and the field that holds its data subject (`null` or absent when it is the
 * entity's own).
 */
export type PersonalMember = readonly [string, { readonly subject?: string | null }];
