import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { SchedulePassState } from './run-schedule-pass.ts';
import { scheduleGroup } from './schedule-group.ts';
import type { ScheduleLimits } from './schedule-limits.ts';
import { scheduleNamespaceUnit } from './schedule-namespace-unit.ts';
import { scheduleRowKey } from './schedule-row-key.ts';
import { scheduleUnitOptions } from './schedule-unit-options.ts';
import { withinSignal } from './within-signal.ts';

/** Provisions the backend's group of an each-tenant schedule once per process. */
export async function provisionScheduleGroup(input: {
  readonly source: QueueSource;
  readonly entry: ScheduleEntry;
  readonly backendId: string;
  readonly state: SchedulePassState;
  readonly limits: ScheduleLimits;
}): Promise<void> {
  const { source, entry, backendId, state, limits } = input;
  if (entry.scope !== 'each-tenant') return;
  const key = scheduleRowKey(scheduleRowKey('group', entry.ref), backendId);
  if (state.seeded.has(key)) return;
  const options = scheduleUnitOptions(state, limits);
  await withinSignal(
    source.handle.adapter.unit(
      source.namespace,
      scheduleNamespaceUnit,
      (unit) => unit.jobs.provisionGroup(scheduleGroup(entry.ref, backendId)),
      options,
    ),
    options.signal,
  );
  state.seeded.add(key);
}
