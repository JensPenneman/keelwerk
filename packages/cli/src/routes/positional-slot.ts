import type { FieldNode } from '@keelwerk/core';

/** One positional argument and the input field it sets: the id of an instance command, then `cli.positional`. */
export interface PositionalSlot {
  readonly name: string;
  readonly node: FieldNode;
}
