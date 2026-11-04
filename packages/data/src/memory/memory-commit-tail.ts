import type { MemoryCounter } from './memory-counter.ts';
import { memoryEnvelope } from './memory-envelope.ts';
import type { MemoryLoggedEvent } from './memory-logged-event.ts';
import type { MemoryPendingEvent } from './memory-pending-event.ts';
import { memoryStreamKey } from './memory-stream-key.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * The commit tail of a unit that appended events (15.1.4): advances the scope's counter by the
 * number of buffered events and writes them at consecutive positions, so positions follow commit
 * order and a rolled-back allocation is reused. Runs inside the unit, before its collections are
 * installed.
 */
export function memoryCommitTail(ctx: MemoryUnitContext): void {
  const buffered = [...ctx.tx.read<MemoryPendingEvent>('~events').values()];
  if (buffered.length === 0) return;
  const scopeId = ctx.scopeId();
  const counters = ctx.tx.write<MemoryCounter>(`pos/${scopeId}`);
  const counter = counters.get('counter') ?? { next: 1n, epoch: 1 };
  const log = ctx.tx.write<MemoryLoggedEvent>(`events/${scopeId}`);
  const versions = ctx.tx.write<number>(`streamv/${scopeId}`);
  buffered.forEach((pending, index) => {
    const position = counter.next + BigInt(index);
    log.set(position.toString().padStart(20, '0'), {
      name: pending.event.name,
      event: memoryEnvelope(ctx, pending, position),
    });
    versions.set(memoryStreamKey(pending.stream.type, pending.stream.id), pending.version);
    ctx.assigned.push(position);
  });
  counters.set('counter', { next: counter.next + BigInt(buffered.length), epoch: counter.epoch });
}
