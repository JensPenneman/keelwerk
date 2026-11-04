import type { FieldNode } from './field-node.ts';

/** Stands for a value the registry could not describe: any JSON, in and out. */
export const anyValue: FieldNode = {
  optional: false,
  access: 'read-write',
  kind: 'foreign',
  input: {},
  output: {},
};
