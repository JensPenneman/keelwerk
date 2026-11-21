import type { UsageCharge } from '@keelwerk/core';
import { quotaExceeded } from '@keelwerk/core';
import { queueFull } from '../sql/queue-full.ts';
import { sumUsageCharges } from '../sql/sum-usage-charges.ts';
import type { MemoryCounter } from './memory-counter.ts';
import { memoryEnvelope } from './memory-envelope.ts';
import { memoryJobTables } from './memory-job-tables.ts';
import type { MemoryLoggedEvent } from './memory-logged-event.ts';
import type { MemoryPendingEvent } from './memory-pending-event.ts';
import { memoryStreamKey } from './memory-stream-key.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** Writes the buffered events at consecutive positions. */
function appendBufferedEvents(ctx: MemoryUnitContext, scopeId: string): void {
  const buffered = [...ctx.tx.read<MemoryPendingEvent>(`~events/${scopeId}`).values()];
  if (buffered.length === 0) return;
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

/** Refuses the unit when a lane that gained available jobs leaves its queue above its cap. */
function refuseFullQueues(ctx: MemoryUnitContext, scopeId: string): void {
  const lanes = memoryJobTables(ctx, scopeId).lanes();
  for (const [laneKey, cap] of ctx.tx.read<number>(`~queuedcap/${scopeId}`)) {
    const lane = lanes.get(laneKey);
    if (lane === undefined) continue;
    let value = 0;
    for (const other of lanes.values()) {
      if (other.queue === lane.queue) value += other.enqueued - other.taken;
    }
    if (value > cap) throw queueFull(lane.queue, cap, value);
  }
}

/** Adds the summed charges to the counters, refusing a net growth above a limit. */
function addUsage(ctx: MemoryUnitContext, scopeId: string): void {
  const charges = sumUsageCharges([...ctx.tx.read<UsageCharge>(`~charges/${scopeId}`).values()]);
  if (charges.length === 0) return;
  const counters = ctx.tx.write<bigint>(`usage/${scopeId}`);
  for (const charge of charges) {
    const value = (counters.get(charge.dimension) ?? 0n) + charge.delta;
    counters.set(charge.dimension, value);
    if (charge.limit !== null && charge.delta > 0n && value > charge.limit) {
      throw quotaExceeded(charge.dimension, charge.limit, value);
    }
  }
}

/**
 * The commit tail of a unit (15.1.4): advances the scope's counter by the number of buffered
 * events and writes them at consecutive positions, so positions follow commit order and a
 * rolled-back allocation is reused. Runs inside the unit, before its collections are installed.
 * Then it checks the queued caps of the lanes that gained jobs and adds the usage charges to the
 * counters; both refuse the unit by throwing.
 */
export function memoryCommitTail(ctx: MemoryUnitContext): void {
  if (ctx.scope.level === 'namespace') return;
  const scopeId = ctx.scopeId();
  appendBufferedEvents(ctx, scopeId);
  refuseFullQueues(ctx, scopeId);
  addUsage(ctx, scopeId);
}
