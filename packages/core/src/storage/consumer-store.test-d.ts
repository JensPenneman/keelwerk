import { expectTypeOf, test } from 'vitest';
import type { WireError } from '../errors/wire-error.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { ConsumerStore } from './consumer-store.ts';
import type { ParkedStream } from './parked-stream.ts';
import type { Position } from './position.ts';
import type { ScheduleStore } from './schedule-store.ts';
import type { StoredSchedule } from './stored-schedule.ts';
import type { StreamRecord } from './stream-record.ts';
import type { StreamRecordStore } from './stream-record-store.ts';

test('ConsumerStore follows section 14.3.2', () => {
  expectTypeOf<Awaited<ReturnType<ConsumerStore['checkpoint']>>>().toEqualTypeOf<Position | null>();
  expectTypeOf<Awaited<ReturnType<ConsumerStore['unpark']>>>().toEqualTypeOf<Position | null>();
  expectTypeOf<Awaited<ReturnType<ConsumerStore['parked']>>>().toEqualTypeOf<
    readonly ParkedStream[]
  >();
  expectTypeOf<ConsumerStore['startAtHeads']>().toEqualTypeOf<
    (consumer: string) => Promise<boolean>
  >();
  expectTypeOf<ConsumerStore['advanceParked']>().toEqualTypeOf<
    (consumer: string, stream: StreamRef, to: Position) => Promise<boolean>
  >();
  expectTypeOf<Parameters<ConsumerStore['park']>>().toEqualTypeOf<
    [consumer: string, stream: StreamRef, from: Position, error: WireError]
  >();
});

test('StreamRecordStore.read answers StreamRecord rows', () => {
  expectTypeOf<Awaited<ReturnType<StreamRecordStore['read']>>>().toEqualTypeOf<
    readonly StreamRecord[]
  >();
  expectTypeOf<Awaited<ReturnType<StreamRecordStore['append']>>>().toEqualTypeOf<{
    readonly firstSeq: bigint;
  }>();
});

test('ScheduleStore.due answers StoredSchedule rows', () => {
  expectTypeOf<Awaited<ReturnType<ScheduleStore['due']>>>().toEqualTypeOf<
    readonly StoredSchedule[]
  >();
  expectTypeOf<Awaited<ReturnType<ScheduleStore['claimTick']>>>().toEqualTypeOf<boolean>();
});
