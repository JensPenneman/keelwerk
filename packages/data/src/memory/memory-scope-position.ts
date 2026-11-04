import type { Position } from '@keelwerk/core';
import type { MemoryCounter } from './memory-counter.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * The last committed position of the unit's scope, `next - 1` of its counter (S-19): 0 for a
 * scope that never appended. A unit's own buffered events have no position until its tail.
 */
export function memoryScopePosition(ctx: MemoryUnitContext): Position {
  const counter = ctx.tx.read<MemoryCounter>(`pos/${ctx.scopeId()}`).get('counter');
  return counter === undefined ? 0n : counter.next - 1n;
}
