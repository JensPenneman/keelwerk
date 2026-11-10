import { expectTypeOf, test } from 'vitest';
import type { InfrastructureEntry } from '../dsl/define-deployment.ts';
import type { Connected } from '../runtime/connected.ts';
import type { RuntimeService } from '../runtime/runtime-service.ts';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { EventWorker } from './event-worker.ts';

test('EventWorker.runs is a closed union', () => {
  expectTypeOf<EventWorker['runs']>().toEqualTypeOf<
    readonly ('asyncReactions' | 'retention' | 'erasure')[]
  >();
  expectTypeOf<'projections'>().not.toExtend<EventWorker['runs'][number]>();
});

test('an EventWorker is an infrastructure entry', () => {
  expectTypeOf<EventWorker>().toExtend<InfrastructureEntry>();
});

test('an EventWorker is a RuntimeService', () => {
  expectTypeOf<EventWorker>().toExtend<RuntimeService>();
  expectTypeOf<Parameters<EventWorker['start']>[0]>().toEqualTypeOf<RuntimeServiceContext>();
});

test('RuntimeServiceContext carries the connected placements and control store', () => {
  expectTypeOf<RuntimeServiceContext['placements']>().toEqualTypeOf<Connected['placements']>();
  expectTypeOf<RuntimeServiceContext['control']>().toEqualTypeOf<Connected['control']>();
});
