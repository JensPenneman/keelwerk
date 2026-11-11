import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineStream } from '../dsl/define-stream.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { StreamRecord } from '../storage/stream-record.ts';
import { openStreamRecords } from './open-stream-records.ts';
import { sealStreamRecords } from './seal-stream-records.ts';
import type { SealingContext } from './sealing-context.ts';

const note = defineEntity({
  prefix: 'nte',
  dataSubject: 'owner',
  fields: { owner: field.subject(), reviewer: field.subject() },
});
const log = defineStream({
  key: field.ref.own('note'),
  record: shape({
    line: field.string().personal(),
    to: field.list(field.string().personal({ subject: 'reviewer' })),
    n: field.integer(),
  }),
  readAs: 'note',
});
const registry = buildRegistry(
  appOf([makeModule({ id: 'logs', entities: { note }, streams: { log } })]),
);
const stream = registry.streams.get('logs.log');
const keyed = registry.entities.get('logs.note');
if (stream === undefined || keyed === undefined) throw new Error('the fixture is incomplete');

const key = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a10';
const owner = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a11';
const reviewer = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
const dataKey: DataKey = { id: 'dk-1', material: new Uint8Array(32).fill(7) };
const refs: { subject: string; refs: unknown }[] = [];

/** A sealing context over a fixed data key, a fixed nonce and one keyed row. */
const context = {
  unit: {
    namespace: { id: 'ns-1' },
    rows: { findOne: () => Promise.resolve({ id: key, owner, reviewer }) },
    keys: {
      addRefs: (subject: string, added: unknown) => {
        refs.push({ subject, refs: added });
        return Promise.resolve();
      },
    },
  },
  random: (bytes: number) => new Uint8Array(bytes).fill(1),
  dataKey: () => Promise.resolve(dataKey),
  keyById: (id: string) => Promise.resolve(id === dataKey.id ? dataKey : undefined),
} as unknown as SealingContext;

const storedOf = (data: unknown): StreamRecord => ({
  seq: 1n,
  at: Temporal.Instant.from('2026-01-01T00:00:00Z'),
  data,
});

describe('sealing the records of a stream', () => {
  test('golden: one personal member is the same envelope under a fixed key and nonce', async () => {
    const [sealed] = await sealStreamRecords(context, {
      stream,
      keyed,
      key,
      records: [{ line: 'hello', n: 1 }],
    });
    // namespace ‖ stream ref ‖ key ‖ member is the associated data: a change to that mapping
    // changes this envelope, and every stored record would read as absent.
    expect(sealed).toEqual({
      line: {
        $kwe: 1,
        k: 'dk-1',
        n: 'AQEBAQEBAQEBAQEB',
        c: 'VIns2_zQzrfNQTDTb38rAtO8XUJZBZE',
      },
      n: 1,
    });
  });

  test('a personal list element seals the whole member under the element subject', async () => {
    refs.length = 0;
    const [sealed] = (await sealStreamRecords(context, {
      stream,
      keyed,
      key,
      records: [{ to: ['bob@example.com', 'eve@example.com'], n: 2 }],
    })) as readonly Record<string, unknown>[];
    expect(sealed?.to).toMatchObject({ $kwe: 1, k: 'dk-1' });
    expect(JSON.stringify(sealed)).not.toContain('example.com');
    expect(refs).toEqual([{ subject: reviewer, refs: [{ type: 'logs.note', id: key }] }]);
    const [opened] = await openStreamRecords(context, {
      stream: 'logs.log',
      key,
      personal: ['line', 'to'],
      records: [storedOf(sealed)],
    });
    expect(opened?.data).toEqual({ to: ['bob@example.com', 'eve@example.com'], n: 2 });
  });

  test('a sealed member opens only under its own key, stream and member name', async () => {
    const [sealed] = (await sealStreamRecords(context, {
      stream,
      keyed,
      key,
      records: [{ line: 'hello', n: 1 }],
    })) as readonly { line: unknown }[];
    const open = async (input: { stream: string; key: string }, data: unknown) =>
      (
        await openStreamRecords(context, {
          ...input,
          personal: ['line', 'moved'],
          records: [storedOf(data)],
        })
      )[0]?.data;
    expect(await open({ stream: 'logs.log', key }, { line: sealed?.line })).toEqual({
      line: 'hello',
    });
    expect(await open({ stream: 'logs.log', key: reviewer }, { line: sealed?.line })).toEqual({});
    expect(await open({ stream: 'logs.other', key }, { line: sealed?.line })).toEqual({});
    expect(await open({ stream: 'logs.log', key }, { moved: sealed?.line })).toEqual({});
  });

  test('a member that is not declared personal is returned as stored, even shaped like an envelope', async () => {
    const lookalike = { $kwe: 1, k: 'dk-1', n: 'AQEBAQEBAQEBAQEB', c: 'not-a-real-ciphertext' };
    const [opened] = await openStreamRecords(context, {
      stream: 'logs.log',
      key,
      personal: ['line', 'to'],
      records: [storedOf({ n: lookalike })],
    });
    expect(opened?.data).toEqual({ n: lookalike });
  });
});
