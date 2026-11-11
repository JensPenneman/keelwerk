import type { StorageScope, Unit } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { appendOf } from './append-of.ts';
import type { ConformanceClock } from './conformance-clock.ts';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA, tenantB } = conformanceScopes;
const inNamespace: StorageScope = { level: 'namespace', reason: 'conformance' };

/** What the consumer cases share: units in the scopes they use, checkpoint and head reads, and events to advance over. */
export interface ConsumerKit {
  clock(): ConformanceClock;
  inA<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
  inB<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
  inNs<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
  checkpointOf(name: string, scopeId: string): Promise<bigint | null>;
  headOf(scope: StorageScope): Promise<bigint | null>;
  /** Appends `count` events to a new stream of the scope: its head moves up by `count`. */
  append(scope: StorageScope, count: number): Promise<void>;
  /** Twenty events in each of tenants A and B: a checkpoint cannot pass its scope's head (S-173). */
  seed(): Promise<void>;
}

export function consumerKit(
  subject: Pick<ConformanceSubject, 'run' | 'read' | 'clock'>,
): ConsumerKit {
  const clock = (): ConformanceClock => {
    if (subject.clock === undefined) throw new Error('the consumer cases need a movable clock');
    return subject.clock;
  };
  const inA = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => subject.run(tenantA, fn);
  const inB = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => subject.run(tenantB, fn);
  const inNs = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => subject.run(inNamespace, fn);
  const checkpointOf = (name: string, scopeId: string): Promise<bigint | null> =>
    inNs((unit) => unit.consumers.checkpoint(name, scopeId));
  const headOf = (scope: StorageScope): Promise<bigint | null> =>
    subject.read(scope, (unit) => unit.events.head());
  let streams = 0;
  let events = 0;
  /** Appends `count` events to a new stream of the scope: its head moves up by `count`. */
  const append = async (scope: StorageScope, count: number): Promise<void> => {
    streams += 1;
    const numbers = Array.from({ length: count }, () => {
      events += 1;
      return events;
    });
    await subject.run(scope, (unit) => unit.events.append([appendOf(streams, numbers)]));
  };
  /** A checkpoint cannot pass its scope's head (S-173), so the cases that advance far need events. */
  const seed = async (): Promise<void> => {
    await append(tenantA, 20);
    await append(tenantB, 20);
  };
  return { clock, inA, inB, inNs, checkpointOf, headOf, append, seed };
}
