import { expect } from 'vitest';
import { openProcessState } from '../src/encryption/open-process-state.ts';
import { personalSealerKey } from '../src/encryption/personal-sealer-key.ts';
import { sealProcessState } from '../src/encryption/seal-process-state.ts';
import type { SealingContext } from '../src/encryption/sealing-context.ts';
import type { StoredEvent } from '../src/events/stored-event.ts';
import { processStateStream } from '../src/reactions/process-state-stream.ts';
import { processStreamRef } from '../src/reactions/process-stream-ref.ts';
import type { ReactionEntry } from '../src/registry/reaction-entry.ts';
import type { StreamRecord } from '../src/storage/stream-record.ts';
import type { Unit } from '../src/storage/unit.ts';
import { noteEvent, reactionOf, reactionRegistry, reactionTenantScope } from './reaction-kit.ts';

const subjectTally = reactionOf(reactionRegistry(), 'tally');
// The same process without a data subject: its state is kept plain.
const { dataSubject: _subject, ...plainParts } = subjectTally as unknown as Record<string, unknown>;
const plainTally = plainParts as unknown as ReactionEntry;
const stream = processStreamRef(
  reactionTenantScope,
  'logs.tally',
  'note-1',
  new Uint8Array(32).fill(7),
);
const build = 'build-1';
const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
const dataKey = { id: 'dk-1', material: new Uint8Array(32).fill(7) };

const recorded = (version: number): StoredEvent =>
  noteEvent({
    stream,
    version,
    eventId: `0197a1c2-7b3e-7c11-9a55-${String(version).padStart(12, '0')}`,
    type: 'logs.tally.noted',
    data: { note: 'x', n: 1 },
    hash: `hash-${version}`,
  });
const eventsUpTo = (count: number): StoredEvent[] =>
  Array.from({ length: count }, (_, index) => recorded(index + 1));

/** The sealer of a sealing unit, with the key of the subject present or shredded. */
function sealerOf(shredded: boolean) {
  const context = {
    unit: {
      namespace: { id: 'ns-1' },
      keys: { dataKey: () => Promise.resolve(shredded ? undefined : dataKey) },
    },
    random: (bytes: number) => new Uint8Array(bytes).fill(1),
    keyById: (id: string) => Promise.resolve(id === dataKey.id && !shredded ? dataKey : undefined),
  } as unknown as SealingContext;
  return {
    readEvents: (events: readonly StoredEvent[]) => Promise.resolve(events),
    sealProcessState: (input: never) => sealProcessState(context, input),
    openProcessState: (input: never) => openProcessState(context, input),
  };
}

interface Fake {
  readonly unit: Unit;
  /** The `fromVersion` of every read of the stream. */
  readonly streamReads: number[];
  readonly cacheReads: number[];
  readonly purges: number[];
  readonly appends: unknown[];
  /** The data of the cache records now held. */
  records(): unknown[];
}

/** A fake unit holding a process stream, and the cache records `held` in `kernel:process-state`. */
function fake(
  stored: readonly StoredEvent[],
  options: {
    readonly held?: readonly unknown[];
    readonly readOnly?: boolean;
    readonly shredded?: boolean;
  } = {},
): Fake {
  let kept: unknown[] = [...(options.held ?? [])];
  const streamReads: number[] = [];
  const cacheReads: number[] = [];
  const purges: number[] = [];
  const appends: unknown[] = [];
  let seq = 0n;
  const nextSeq = (): bigint => {
    seq += 1n;
    return seq;
  };
  const unit = {
    scope: reactionTenantScope,
    readOnly: options.readOnly === true,
    [personalSealerKey]: sealerOf(options.shredded === true),
    events: {
      readStream: (
        ref: { type: string; id: string },
        range?: { fromVersion?: number; limit?: number },
      ) => {
        streamReads.push(range?.fromVersion ?? 1);
        return Promise.resolve(
          ref.id === stream.id
            ? stored
                .filter((event) => event.version >= (range?.fromVersion ?? 1))
                .slice(0, range?.limit ?? stored.length)
            : [],
        );
      },
    },
    streams: {
      read: (name: string, key: string, _after: bigint | null, limit: number) => {
        cacheReads.push(limit);
        if (name !== processStateStream || key !== stream.id) return Promise.resolve([]);
        return Promise.resolve(
          kept
            .slice(0, limit)
            .map((data): StreamRecord => ({ seq: nextSeq(), at: Temporal.Now.instant(), data })),
        );
      },
      purgeKeys: (name: string, keys: readonly string[]) => {
        expect(name).toBe(processStateStream);
        expect(keys).toEqual([stream.id]);
        purges.push(kept.length);
        kept = [];
        return Promise.resolve(purges.length);
      },
      append: (name: string, key: string, records: readonly unknown[]) => {
        expect(name).toBe(processStateStream);
        expect(key).toBe(stream.id);
        appends.push(...records);
        kept.push(...records);
        return Promise.resolve({ firstSeq: 1n });
      },
    },
  } as unknown as Unit;
  return { unit, streamReads, cacheReads, purges, appends, records: () => kept };
}

export type { Fake };
export { build, eventsUpTo, fake, plainTally, recorded, stream, subject, subjectTally };
