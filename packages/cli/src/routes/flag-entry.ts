import type { FieldNode } from '@keelwerk/core';

/** One flag of an action command and the input field it sets. */
export interface FlagEntry {
  /** The flag name as typed: `display-name`, `address.city`, `notes-json`, `password-stdin`. */
  readonly key: string;
  /** The field's path inside the input: `['address', 'city']`. */
  readonly path: readonly string[];
  readonly node: FieldNode;
  /** `value` sets the field from the flag; `stdin` reads a secret from standard input; `negate` is the `--no-` form of a boolean. */
  readonly role: 'value' | 'stdin' | 'negate';
}
