import type { StorageRow } from '@keelwerk/core';
import { rowAt } from './row-at.ts';

export const probeOwners: readonly StorageRow[] = [
  rowAt(101, { name: 'ann', rank: 1 }),
  rowAt(102, { name: 'bob', rank: 5 }),
  rowAt(103, { name: 'cy' }),
  rowAt(104, { name: 'idle', rank: 0 }),
];
