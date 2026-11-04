import { expectTypeOf, test } from 'vitest';
import type { ActorRef } from '../principals/actor-ref.ts';
import type { Scope } from '../storage/scope.ts';
import type { DecisionRecord } from './decision-record.ts';
import type { EventEnvelope } from './event-envelope.ts';
import type { FlagRead } from './flag-read.ts';
import type { Hlc } from './hlc.ts';
import type { NewEvent } from './new-event.ts';
import type { StoredEvent } from './stored-event.ts';

test('the envelope carries every member of section 15.1.3', () => {
  expectTypeOf<keyof EventEnvelope>().toEqualTypeOf<
    | 'eventId'
    | 'position'
    | 'namespace'
    | 'scope'
    | 'stream'
    | 'version'
    | 'partition'
    | 'type'
    | 'shape'
    | 'data'
    | 'before'
    | 'hlc'
    | 'recordedAt'
    | 'actor'
    | 'commandId'
    | 'action'
    | 'causationId'
    | 'correlationId'
    | 'client'
    | 'merge'
    | 'writer'
    | 'flags'
    | 'decision'
    | 'transient'
    | 'prevHash'
    | 'hash'
    | 'traceparent'
  >();
});

test('positions are bigint and clocks are branded', () => {
  expectTypeOf<EventEnvelope['position']>().toEqualTypeOf<bigint>();
  expectTypeOf<EventEnvelope['hlc']>().toEqualTypeOf<Hlc>();
  expectTypeOf<string>().not.toExtend<Hlc>();
  expectTypeOf<Hlc>().toExtend<string>();
});

test('writer, flags and decision enter the envelope (S-60)', () => {
  expectTypeOf<EventEnvelope['writer']>().toEqualTypeOf<{
    readonly build: string;
    readonly revision: number;
  }>();
  expectTypeOf<EventEnvelope['flags']>().toEqualTypeOf<readonly FlagRead[]>();
  expectTypeOf<EventEnvelope['decision']>().toEqualTypeOf<DecisionRecord | null>();
  expectTypeOf<EventEnvelope['actor']>().toEqualTypeOf<ActorRef>();
});

test('the type and data of an envelope are parameters, a stored event is open', () => {
  expectTypeOf<EventEnvelope<'a.b.c', { n: number }>['type']>().toEqualTypeOf<'a.b.c'>();
  expectTypeOf<StoredEvent['data']>().toBeUnknown();
  expectTypeOf<StoredEvent['type']>().toBeString();
});

test('the decision record keeps reads, answers and effects in order', () => {
  expectTypeOf<keyof DecisionRecord>().toEqualTypeOf<
    'part' | 'inputDigest' | 'input' | 'reads' | 'answers' | 'effects'
  >();
  expectTypeOf<DecisionRecord['reads'][number]['at']>().toEqualTypeOf<bigint>();
});

test('the scope is the storage scope without the namespace level, and a new event names its shape', () => {
  expectTypeOf<EventEnvelope['scope']>().toEqualTypeOf<Scope>();
  expectTypeOf<{ level: 'deployment' }>().toExtend<EventEnvelope['scope']>();
  expectTypeOf<NewEvent['shape']>().toBeString();
});
