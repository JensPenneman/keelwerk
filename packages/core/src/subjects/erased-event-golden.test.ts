import canonicalize from 'canonicalize';
import { describe, expect, test, vi } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { hybridClock } from '../clock/hybrid-clock.ts';
import { sha256 } from '../crypto/sha256.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { chainContent } from '../events/chain-content.ts';
import type { NewEvent } from '../events/new-event.ts';
import { field } from '../fields/field.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { eraseStream } from './erase-stream.ts';

vi.mock('../ids/new-uuid-v7.ts', () => ({
  newUuidV7: () => '0192f3a0-0000-7000-8000-0000000000e1',
}));

const thing = defineEntity({
  prefix: 'thg',
  dataSubject: 'owner',
  fields: {
    owner: field.subject(),
    title: field.string(),
    secret: field.string().optional().personal(),
    about: field.subject().optional(),
    remark: field.string().optional().personal({ subject: 'about' }),
  },
});
const registry = buildRegistry(appOf([makeModule({ id: 'x', entities: { thing } })]));

const owner = '0192f3a0-0000-7000-8000-0000000000a1';
const about = '0192f3a0-0000-7000-8000-0000000000a2';
const streamId = '0192f3a0-0000-7000-8000-0000000000b1';
const previousHash = 'a'.repeat(64);
const now = Temporal.Instant.from('2026-11-12T09:00:00.000Z');
const recordOf = (subjectId: string): ErasureRecord => ({
  type: 'erasure',
  tenantId: '0192f3a0-0000-7000-8000-000000000001',
  subjectId,
  recordedAt: '2026-11-12T08:00:00.000Z',
  requester: { kind: 'operator', id: null, via: 'core.operator' },
  reason: 'subjectRequest',
  commandId: '0192f3a0-0000-7000-8000-0000000000c1',
});

/** Erases the one row of the fixture for `subjectId` and answers the event that was appended. */
async function erasedEventFor(subjectId: string): Promise<NewEvent> {
  const row: StorageRow = {
    id: streamId,
    owner,
    title: 'a title',
    about,
    version: 3,
    createdAt: now,
    updatedAt: now,
    kwLastHash: previousHash,
    kwLastHlc: '0192f3a000000000-s0000000000',
  };
  const appended: NewEvent[] = [];
  const unit = {
    rows: {
      findOne: () => Promise.resolve(row),
      find: () => Promise.resolve({ rows: [row] }),
      update: () => Promise.resolve(),
    },
    events: {
      readStream: () => Promise.resolve([]),
      head: () => Promise.resolve(7n),
      append: (batch: readonly { readonly events: readonly NewEvent[] }[]) => {
        for (const one of batch) appended.push(...one.events);
        return Promise.resolve([]);
      },
    },
    streams: { purgeKeys: () => Promise.resolve() },
  } as unknown as Unit;
  const writer = {
    build: { id: 'b'.repeat(64), revision: 1 },
    hybridClock: hybridClock('s0000000000'),
  } as unknown as RunJobContext['writer'];
  await eraseStream(unit, {
    registry,
    stream: { type: 'x.thing', id: streamId },
    record: recordOf(subjectId),
    writer,
    now,
    nominated: true,
  });
  const [event] = appended;
  if (event === undefined) throw new Error('no event was appended');
  return event;
}

// Golden vectors: the erased event is a stored format, final from M2. The text was made with the
// independent `canonicalize` package, and each hash was checked with SHA-256 over the previous
// hash text ('a' repeated) and the canonical text, outside the kernel.
const ownedText =
  '{"actor":{"id":"core.system","kind":"service","via":"core.module"},"before":null,"client":null,"commandId":"0192f3a0-0000-7000-8000-0000000000c1","data":{"fields":["secret"],"owned":true,"subjectId":"0192f3a0-0000-7000-8000-0000000000a1"},"decision":null,"eventId":"0192f3a0-0000-7000-8000-0000000000e1","flags":[],"hlc":"01a1cefc3e800000-s0000000000","name":"erased","recordedAt":"2026-11-12T09:00:00.000Z","schemaVersion":1,"streamId":"0192f3a0-0000-7000-8000-0000000000b1","version":4,"writer":{"build":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","revision":1}}';
const ownedHash = '257a6bf77b441f9ea0ec248c6d752c9b0729b4ab1395a081efb398314edcd1a8';
const notOwnedText =
  '{"actor":{"id":"core.system","kind":"service","via":"core.module"},"before":null,"client":null,"commandId":"0192f3a0-0000-7000-8000-0000000000c1","data":{"fields":["remark"],"owned":false,"subjectId":"0192f3a0-0000-7000-8000-0000000000a2"},"decision":null,"eventId":"0192f3a0-0000-7000-8000-0000000000e1","flags":[],"hlc":"01a1cefc3e800000-s0000000000","name":"erased","recordedAt":"2026-11-12T09:00:00.000Z","schemaVersion":1,"streamId":"0192f3a0-0000-7000-8000-0000000000b1","version":4,"writer":{"build":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","revision":1}}';
const notOwnedHash = '08a789eded83a815989890ec26787348efc18cdab33b7f17aedc6f9eae1d31bf';

/** The canonical text the chain hashes, made with the independent `canonicalize` package. */
function textOf(event: NewEvent): string {
  return canonicalize(
    chainContent({
      eventId: event.eventId,
      streamId,
      version: 4,
      name: event.name,
      schemaVersion: event.schemaVersion,
      data: event.data,
      before: event.before,
      hlc: event.hlc,
      recordedAt: event.recordedAt,
      actor: event.meta.actor,
      writer: event.meta.writer,
      flags: event.meta.flags,
      decision: event.meta.decision,
      commandId: event.meta.commandId,
      client: event.meta.client,
    }),
  ) as string;
}

describe('the erased event is a stored format (14.7.5, S-168)', () => {
  test('owned: its canonical bytes and its hash are pinned', async () => {
    const event = await erasedEventFor(owner);
    expect(textOf(event)).toBe(ownedText);
    expect(event.hash).toBe(ownedHash);
    expect(event.hash).toBe(sha256(`${previousHash}${textOf(event)}`));
  });

  test('not owned: the same event with owned false, its canonical bytes and its hash are pinned', async () => {
    const event = await erasedEventFor(about);
    expect(textOf(event)).toBe(notOwnedText);
    expect(event.hash).toBe(notOwnedHash);
    expect(event.hash).toBe(sha256(`${previousHash}${textOf(event)}`));
  });
});
