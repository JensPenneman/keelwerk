import type { PathField } from './path-field.ts';

/** Where a data-subject path starts: what it is called in a message and the fields its first segment names. */
export interface PathHead {
  readonly label: string;
  readonly field: (name: string) => PathField | undefined;
}
