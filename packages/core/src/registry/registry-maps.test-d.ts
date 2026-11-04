import { expectTypeOf, test } from 'vitest';
import type { EffectEntry } from './effect-entry.ts';
import type { EntityEntry } from './entity-entry.ts';
import type { ExecutorEntry } from './executor-entry.ts';
import type { Registry } from './registry.ts';
import type { ScheduleEntry } from './schedule-entry.ts';
import type { TrackRef } from './track-ref.ts';

test('the registry maps effects, executors and schedules by reference', () => {
  expectTypeOf<Registry['effects']>().toEqualTypeOf<ReadonlyMap<string, EffectEntry>>();
  expectTypeOf<Registry['executors']>().toEqualTypeOf<ReadonlyMap<string, ExecutorEntry>>();
  expectTypeOf<Registry['schedules']>().toEqualTypeOf<ReadonlyMap<string, ScheduleEntry>>();
  expectTypeOf<EntityEntry['tracks']>().toEqualTypeOf<readonly TrackRef[]>();
});

test('an executor never returns a value synchronously', () => {
  expectTypeOf<ReturnType<ExecutorEntry['run']>>().toEqualTypeOf<Promise<unknown>>();
});
