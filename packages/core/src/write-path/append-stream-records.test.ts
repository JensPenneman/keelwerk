import { describe, expect, test } from 'vitest';
import { m2Parts } from '../../test/fixtures/modules/m2-parts/src/module.generated.ts';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineStream } from '../dsl/define-stream.ts';
import { personalSealerKey } from '../encryption/personal-sealer-key.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { StreamAppendDraft } from '../protocol/stream-append-draft.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { Unit } from '../storage/unit.ts';
import { appendStreamRecords } from './append-stream-records.ts';
import { normalizeDecision } from './normalize-decision.ts';

const registry = buildRegistry(appOf([m2Parts]));
const taskKey = newUuidV7();

interface Call {
  readonly stream: string;
  readonly key: string;
  readonly records: readonly unknown[];
}

function fakeUnit(calls: Call[]): Unit {
  return {
    streams: {
      append: (stream: string, key: string, records: readonly unknown[]) => {
        calls.push({ stream, key, records });
        return Promise.resolve({ firstSeq: 1n });
      },
    },
  } as unknown as Unit;
}

function draft(records: readonly unknown[], stream = 'm2-parts.log'): StreamAppendDraft {
  return { kind: 'append', type: 'append', target: stream, stream, key: taskKey, records };
}

describe('appending stream records', () => {
  test('normalizeDecision splits append drafts from entity drafts', () => {
    const entity = { kind: 'create', entity: 'm2-parts.task', values: {} };
    const append = draft([{ line: 'a' }]);
    const decided = normalizeDecision([entity, append]);
    expect(decided.drafts).toEqual([entity]);
    expect(decided.appends).toEqual([append]);
    expect(normalizeDecision(undefined).appends).toEqual([]);
  });

  test('stores plain records on a unit that does not seal', async () => {
    const calls: Call[] = [];
    await appendStreamRecords({
      registry,
      unit: fakeUnit(calls),
      authority: 'm2-parts',
      appends: [draft([{ line: 'a' }, { line: 'b' }])],
    });
    expect(calls).toEqual([
      { stream: 'm2-parts.log', key: taskKey, records: [{ line: 'a' }, { line: 'b' }] },
    ]);
  });

  test('encodes instants and bigints', async () => {
    const note = defineEntity({ prefix: 'nte', fields: { text: field.string() } });
    const meter = defineStream({
      key: field.ref.own('note'),
      record: shape({ at: field.instant(), total: field.integer({ wide: true }) }),
      readAs: 'note',
    });
    const app = appOf([makeModule({ id: 'meters', entities: { note }, streams: { meter } })]);
    const calls: Call[] = [];
    await appendStreamRecords({
      registry: buildRegistry(app),
      unit: fakeUnit(calls),
      authority: 'meters',
      appends: [
        draft([{ at: Temporal.Instant.from('2026-01-01T00:00:00Z'), total: 5n }], 'meters.meter'),
      ],
    });
    expect(calls[0]?.records).toEqual([{ at: '2026-01-01T00:00:00Z', total: '5' }]);
  });

  test('refuses an unknown stream as internal', async () => {
    await expect(
      appendStreamRecords({
        registry,
        unit: fakeUnit([]),
        authority: 'm2-parts',
        appends: [draft([{ line: 'a' }], 'm2-parts.nope')],
      }),
    ).rejects.toMatchObject({ kind: 'internal' });
  });

  test('skips an empty batch', async () => {
    const calls: Call[] = [];
    await appendStreamRecords({
      registry,
      unit: fakeUnit(calls),
      authority: 'm2-parts',
      appends: [draft([])],
    });
    expect(calls).toEqual([]);
  });

  test('refuses a text with a lone surrogate before it is sealed or stored', async () => {
    const calls: Call[] = [];
    await expect(
      appendStreamRecords({
        registry,
        unit: fakeUnit(calls),
        authority: 'm2-parts',
        appends: [draft([{ line: 'ab\ud83d' }])],
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(calls).toEqual([]);
  });

  test('core.effectAttempt keeps the code and status of an error and refuses its message', async () => {
    const attempt = { process: 'mail', build: 'b1', attempt: 1, startedAt: '2026-11-11T10:00:00Z' };
    const error = {
      kind: 'unavailable',
      code: 'mail.rejected',
      retryable: true,
      requestId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a10',
    };
    const calls: Call[] = [];
    const key = newUuidV7();
    const effectDraft = (record: unknown) => ({
      ...draft([record], 'core.effectAttempt'),
      key,
    });
    await appendStreamRecords({
      registry,
      unit: fakeUnit(calls),
      authority: 'core',
      appends: [effectDraft({ ...attempt, error })],
    });
    expect(calls[0]?.records).toEqual([{ ...attempt, error }]);
    const refused = await appendStreamRecords({
      registry,
      unit: fakeUnit(calls),
      authority: 'core',
      appends: [
        effectDraft({ ...attempt, error: { ...error, message: '550 5.1.1 <bob@example.com>' } }),
      ],
    }).catch((caught: unknown) => caught);
    expect(refused).toMatchObject({ kind: 'validation' });
    expect(JSON.stringify(refused)).not.toContain('bob@example.com');
    expect(calls).toHaveLength(1);
  });

  test('core.effectAttempt refuses a code or a request id that carries an address', async () => {
    const attempt = { process: 'mail', build: 'b1', attempt: 1, startedAt: '2026-11-11T10:00:00Z' };
    const error = {
      kind: 'unavailable',
      code: 'mail.rejected',
      retryable: true,
      requestId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a10',
    };
    for (const bad of [
      { code: 'mail.rejected:<bob@example.com>' },
      { code: 'mail.rejected bob' },
      { code: `mail.${'a'.repeat(200)}` },
      { requestId: 'bob@example.com' },
      { requestId: 'req 1' },
    ]) {
      const calls: Call[] = [];
      const refused = await appendStreamRecords({
        registry,
        unit: fakeUnit(calls),
        authority: 'core',
        appends: [
          {
            ...draft([{ ...attempt, error: { ...error, ...bad } }], 'core.effectAttempt'),
            key: newUuidV7(),
          },
        ],
      }).catch((caught: unknown) => caught);
      expect(refused).toMatchObject({ kind: 'validation' });
      expect(JSON.stringify(refused)).not.toContain('bob@example.com');
      expect(calls).toEqual([]);
    }
  });

  test('refuses U+0000 in any member before it is sealed or stored', async () => {
    const calls: Call[] = [];
    await expect(
      appendStreamRecords({
        registry,
        unit: fakeUnit(calls),
        authority: 'm2-parts',
        appends: [draft([{ line: 'a\u0000b' }])],
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(calls).toEqual([]);
  });

  test('refuses U+0000 in a personal member before the sealer sees it', async () => {
    const note = defineEntity({
      prefix: 'nte',
      dataSubject: 'owner',
      fields: { owner: field.subject() },
    });
    const secret = defineStream({
      key: field.ref.own('note'),
      record: shape({ line: field.string().personal() }),
      readAs: 'note',
    });
    const personalRegistry = buildRegistry(
      appOf([makeModule({ id: 'logs', entities: { note }, streams: { secret } })]),
    );
    const sealed: unknown[] = [];
    const calls: Call[] = [];
    const unit = fakeUnit(calls);
    Object.defineProperty(unit, personalSealerKey, {
      value: {
        sealRecords: (input: unknown) => {
          sealed.push(input);
          return Promise.resolve([]);
        },
      },
    });
    await expect(
      appendStreamRecords({
        registry: personalRegistry,
        unit,
        authority: 'logs',
        appends: [
          {
            kind: 'append',
            type: 'append',
            target: 'logs.secret',
            stream: 'logs.secret',
            key: newUuidV7(),
            records: [{ line: 'a\u0000b' }],
          },
        ],
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(sealed).toEqual([]);
    expect(calls).toEqual([]);
  });
});
