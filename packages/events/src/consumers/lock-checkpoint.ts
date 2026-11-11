import type { Position, Unit } from '@keelwerk/core';

/**
 * Reads the checkpoint of the unit's scope and, when there is one, advances it to itself, which
 * takes its row lock until the unit ends, then reads it again (D6). A batch, a park and a replay
 * of one scope therefore serialise, and what they read after the lock is current.
 */
export async function lockCheckpoint(
  unit: Unit,
  consumer: string,
  scopeId: string,
): Promise<Position | null> {
  const at = await unit.consumers.checkpoint(consumer, scopeId);
  if (at === null) return null;
  await unit.consumers.advance(consumer, scopeId, at);
  return unit.consumers.checkpoint(consumer, scopeId);
}
