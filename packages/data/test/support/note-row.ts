import type { StorageRow } from '@keelwerk/core';
import { id } from './id.ts';
import { stamp } from './stamp.ts';

export function noteRow(n: number, over: Record<string, unknown>): StorageRow {
  return {
    id: id(n),
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    ...over,
  };
}
