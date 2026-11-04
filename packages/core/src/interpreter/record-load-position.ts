import type { AnswerContext } from '../kernel/answer-context.ts';
import type { Position } from '../storage/position.ts';

/** Tags a load with the scope position its snapshot saw (S-19); `crossed` marks a read of backend entities from a tenant unit. */
export function recordLoadPosition(
  context: AnswerContext,
  position: Position,
  crossed: boolean,
): void {
  context.record.read(crossed ? { scope: 'backend', at: position } : { at: position });
}
