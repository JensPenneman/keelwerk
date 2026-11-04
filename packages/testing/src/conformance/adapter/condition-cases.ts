import type { Condition, EntityDescriptor, StorageRow } from '@keelwerk/core';
import {
  conformanceEntities,
  conformanceScopes,
  oracleSelect,
  randomConditions,
  randomRows,
} from '@keelwerk/data/conformance';
import { assert, asyncProperty, sample } from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { expectedIds } from './expected-ids.ts';
import { ownerId } from './owner-id.ts';
import { probeId } from './probe-id.ts';
import { seedProbes } from './seed-probes.ts';

const { probe, owner } = conformanceEntities;
const scope = conformanceScopes.tenantA;

const instant = (text: string): Temporal.Instant => Temporal.Instant.from(text);
const date = (text: string): Temporal.PlainDate => Temporal.PlainDate.from(text);
const leaf = (op: string, field: string, value: unknown): Condition =>
  ({ op, field, value }) as Condition;

/** [name, condition, the probe numbers it selects]; read off the table in `probe-rows.ts`, not off any interpreter. */
const probeTable: readonly (readonly [string, Condition, readonly number[]])[] = [
  ['eq is case sensitive', leaf('eq', 'label', 'a'), [1]],
  ['eq on another case matches nothing', leaf('eq', 'label', 'A'), []],
  ['eq with a null operand matches nothing', { op: 'never' }, []],
  ['ne includes the absent value', leaf('ne', 'label', 'a'), [2, 3, 4, 5, 6, 7, 8]],
  ['lt orders by code point', leaf('lt', 'label', 'a'), [3, 4, 5]],
  ['lte', leaf('lte', 'label', 'a'), [1, 3, 4, 5]],
  ['gt', leaf('gt', 'label', 'ab'), [6, 7]],
  ['gte', leaf('gte', 'label', 'B'), [1, 2, 3, 5, 6, 7]],
  [
    'lt beyond the BMP puts U+FF5E before U+1F600',
    leaf('lt', 'label', '\u{1f600}'),
    [1, 2, 3, 4, 5, 7],
  ],
  ['gt beyond the BMP', leaf('gt', 'label', '～'), [6]],
  ['in', leaf('in', 'label', ['a', 'B']), [1, 3]],
  ['in an empty list matches nothing', leaf('in', 'label', []), []],
  ['in a list with a null matches nothing', leaf('in', 'label', ['a', null]), []],
  ['nin includes the absent value', leaf('nin', 'label', ['a', 'B']), [2, 4, 5, 6, 7, 8]],
  ['nin of an empty list matches everything', leaf('nin', 'label', []), [1, 2, 3, 4, 5, 6, 7, 8]],
  ['contains a percent sign literally', leaf('contains', 'label', '%'), [4]],
  ['contains an underscore literally', leaf('contains', 'label', '_'), [5]],
  ['contains a substring', leaf('contains', 'label', 'a'), [1, 2]],
  [
    'contains the empty string matches every present value',
    leaf('contains', 'label', ''),
    [1, 2, 3, 4, 5, 6, 7],
  ],
  ['contains a literal percent in text', leaf('contains', 'note', '%'), [2]],
  ['contains a literal underscore in text', leaf('contains', 'note', '_'), [3]],
  ['contains a backslash', leaf('contains', 'note', '\\'), [4]],
  ['contains is case sensitive', leaf('contains', 'note', 'Hello'), []],
  ['contains', leaf('contains', 'note', 'hello'), [1]],
  ['startsWith', leaf('startsWith', 'label', 'a'), [1, 2]],
  ['startsWith a longer prefix', leaf('startsWith', 'label', 'ab'), [2]],
  ['startsWith the empty prefix', leaf('startsWith', 'label', ''), [1, 2, 3, 4, 5, 6, 7]],
  ['startsWith a percent sign literally', leaf('startsWith', 'label', '%'), [4]],
  ['startsWith an underscore literally', leaf('startsWith', 'label', '_'), [5]],
  ['isNull true', leaf('isNull', 'label', true), [8]],
  ['isNull false', leaf('isNull', 'label', false), [1, 2, 3, 4, 5, 6, 7]],
  ['eq on integers', leaf('eq', 'n', 2), [2, 8]],
  ['ne on integers includes the absent value', leaf('ne', 'n', 2), [1, 3, 4, 5, 6, 7]],
  ['lt on integers never matches an absent value', leaf('lt', 'n', 1), [3, 4]],
  ['lte on integers', leaf('lte', 'n', 1), [1, 3, 4]],
  ['gt on integers', leaf('gt', 'n', 2), [5, 6]],
  ['gte on integers', leaf('gte', 'n', 2), [2, 5, 6, 8]],
  ['in on integers', leaf('in', 'n', [1, 3, 99]), [1, 6]],
  ['nin on integers includes the absent value', leaf('nin', 'n', [1, 3]), [2, 3, 4, 5, 7, 8]],
  ['isNull on integers', leaf('isNull', 'n', true), [7]],
  ['decimals compare by value, not by text', leaf('eq', 'price', '0.5'), [1]],
  ['decimal without a fraction', leaf('eq', 'price', '2'), [2]],
  ['gt on decimals', leaf('gt', 'price', '0.5'), [2]],
  ['lt on negative decimals', leaf('lt', 'price', '0'), [3]],
  ['gte on decimals', leaf('gte', 'price', '0.00'), [1, 2, 4]],
  ['ne on decimals', leaf('ne', 'price', '2'), [1, 3, 4, 5, 6, 7, 8]],
  ['in on decimals', leaf('in', 'price', ['0.5', '2']), [1, 2]],
  ['eq on floats', leaf('eq', 'ratio', 0.5), [1]],
  ['gt on floats', leaf('gt', 'ratio', 0), [1, 2]],
  ['lt on floats', leaf('lt', 'ratio', 0), [3]],
  ['eq on booleans', leaf('eq', 'flag', true), [1, 4]],
  ['eq on false', leaf('eq', 'flag', false), [2]],
  ['ne on booleans includes the absent value', leaf('ne', 'flag', true), [2, 3, 5, 6, 7, 8]],
  ['isNull on booleans', leaf('isNull', 'flag', true), [3, 5, 6, 7, 8]],
  [
    'eq on instants at millisecond precision',
    leaf('eq', 'at', instant('2026-01-01T00:00:00.123Z')),
    [1],
  ],
  ['lt on instants', leaf('lt', 'at', instant('2026-01-01T00:00:00.124Z')), [1]],
  ['gt on instants', leaf('gt', 'at', instant('2026-01-01T00:00:00.123Z')), [2]],
  ['gte on instants', leaf('gte', 'at', instant('2026-01-01T00:00:00.123Z')), [1, 2]],
  ['lt on dates', leaf('lt', 'day', date('2026-02-01')), [1]],
  ['gte on dates', leaf('gte', 'day', date('2026-01-01')), [1, 2]],
  ['eq on enums', leaf('eq', 'mood', 'calm'), [1]],
  ['in on enums', leaf('in', 'mood', ['calm', 'away']), [1, 3]],
  ['nin on enums', leaf('nin', 'mood', ['calm']), [2, 3, 4, 5, 6, 7, 8]],
  ['ne on enums', leaf('ne', 'mood', 'busy'), [1, 3, 4, 5, 6, 7, 8]],
  ['contains an element of a set', leaf('contains', 'tags', 'x'), [1]],
  ['contains an element no set has', leaf('contains', 'tags', 'q'), []],
  ['an empty set is present', leaf('isNull', 'tags', false), [1, 2, 3]],
  ['an absent set is null', leaf('isNull', 'tags', true), [4, 5, 6, 7, 8]],
  ['contains an element of a list', leaf('contains', 'scores', 2), [1]],
  ['contains another element of a list', leaf('contains', 'scores', 3), [2]],
  ['eq on bytes', leaf('eq', 'raw', new Uint8Array([1, 2])), [1]],
  [
    'ne on bytes includes the absent value',
    leaf('ne', 'raw', new Uint8Array([1, 2])),
    [2, 3, 4, 5, 6, 7, 8],
  ],
  ['isNull on bytes', leaf('isNull', 'raw', true), [3, 4, 5, 6, 7, 8]],
  ['isNull on json', leaf('isNull', 'payload', true), [1, 2, 3, 4, 5, 6, 7, 8]],
  ['and', { op: 'and', conditions: [leaf('gt', 'n', 0), leaf('contains', 'label', 'a')] }, [1, 2]],
  ['or', { op: 'or', conditions: [leaf('eq', 'n', 1), leaf('isNull', 'n', true)] }, [1, 7]],
  [
    'not is two-valued: it includes what an absent value fails',
    { op: 'not', condition: leaf('eq', 'n', 2) },
    [1, 3, 4, 5, 6, 7],
  ],
  ['not of gt includes the absent value', { op: 'not', condition: leaf('gt', 'n', 0) }, [3, 4, 7]],
  [
    'nested logic',
    {
      op: 'and',
      conditions: [
        { op: 'not', condition: leaf('isNull', 'ownerId', true) },
        {
          op: 'or',
          conditions: [leaf('eq', 'mood', 'away'), leaf('eq', 'flag', true)],
        },
      ],
    },
    [1, 3, 4],
  ],
  [
    'is on a related row',
    { op: 'is', relation: 'owner', where: leaf('gt', 'rank', 0) },
    [1, 2, 3, 4],
  ],
  [
    'is on an owner without the field',
    { op: 'is', relation: 'owner', where: leaf('isNull', 'rank', true) },
    [5],
  ],
  [
    'not is includes absent and dangling references',
    { op: 'not', condition: { op: 'is', relation: 'owner', where: leaf('gt', 'rank', 0) } },
    [5, 6, 7, 8],
  ],
  [
    'is with a condition on the owner name',
    { op: 'is', relation: 'owner', where: leaf('eq', 'name', 'bob') },
    [3, 4],
  ],
];

/** The same for owners: owner numbers 1 to 4; owner 4 has no live probe (its only one is archived). */
const ownerTable: readonly (readonly [string, Condition, readonly number[]])[] = [
  ['some', { op: 'some', relation: 'probes', where: leaf('eq', 'flag', true) }, [1, 2]],
  [
    'none holds for an empty relation',
    { op: 'none', relation: 'probes', where: leaf('eq', 'flag', true) },
    [3, 4],
  ],
  [
    'every holds for an empty relation',
    { op: 'every', relation: 'probes', where: leaf('gte', 'n', 0) },
    [1, 3, 4],
  ],
  ['some with a label', { op: 'some', relation: 'probes', where: leaf('eq', 'label', 'B') }, [2]],
  [
    'some ignores archived related rows',
    { op: 'some', relation: 'probes', where: leaf('lt', 'n', -50) },
    [],
  ],
  [
    'every with a failing member',
    { op: 'every', relation: 'probes', where: leaf('gt', 'n', 0) },
    [1, 3, 4],
  ],
  [
    'not some',
    { op: 'not', condition: { op: 'some', relation: 'probes', where: leaf('gt', 'n', 5) } },
    [1, 2, 4],
  ],
  [
    'plain field and quantifier',
    {
      op: 'and',
      conditions: [
        leaf('gt', 'rank', 0),
        { op: 'some', relation: 'probes', where: leaf('contains', 'label', 'a') },
      ],
    },
    [1],
  ],
];

async function sampleSets(
  subject: ConformanceSubject,
  entity: EntityDescriptor,
  condition: Condition,
): Promise<string[]> {
  const page = await subject.read(scope, (unit) =>
    unit.rows.find(entity, { where: condition, sort: [{ field: 'id', direction: 'asc' }] }),
  );
  return page.rows.map((row) => String(row.id));
}

export function conditionCases(subject: ConformanceSubject): void {
  describe('condition semantics against the hand-written table (14.10 case 2)', () => {
    test.each(probeTable)('probe: %s', async (_name, condition, numbers) => {
      await subject.run(scope, seedProbes);
      expect(await sampleSets(subject, probe, condition)).toEqual(expectedIds(numbers, 200));
      expect(await subject.read(scope, (unit) => unit.rows.count(probe, condition))).toBe(
        numbers.length,
      );
    });

    test.each(ownerTable)('owner: %s', async (_name, condition, numbers) => {
      await subject.run(scope, seedProbes);
      expect(await sampleSets(subject, owner, condition)).toEqual(expectedIds(numbers, 100));
    });

    test('matching answers for the given ids only, and exists/count leave archived rows out', async () => {
      await subject.run(scope, seedProbes);
      const ids = [probeId(1), probeId(2), probeId(3)];
      const matched = await subject.read(scope, (unit) =>
        unit.rows.matching(probe, ids, leaf('contains', 'label', 'a')),
      );
      expect([...matched].sort()).toEqual([probeId(1), probeId(2)].sort());
      const exists = await subject.read(scope, (unit) =>
        unit.rows.exists(probe, [...ids, probeId(9), ownerId(1)]),
      );
      expect([...exists].sort()).toEqual(ids.sort());
      expect(await subject.read(scope, (unit) => unit.rows.count(probe))).toBe(8);
      const all = await subject.read(scope, (unit) =>
        unit.rows.find(probe, { includeArchived: true }),
      );
      expect(all.rows).toHaveLength(9);
    });

    test('a field the entity does not have, or an operator its kind does not take, is refused', async () => {
      await subject.run(scope, seedProbes);
      const refused = async (condition: Condition): Promise<unknown> =>
        subject
          .read(scope, (unit) => unit.rows.find(probe, { where: condition }))
          .then(
            () => 'accepted',
            (error: unknown) => (error as { kind?: string }).kind,
          );
      expect(await refused(leaf('eq', 'nope', 1))).toBe('validation');
      expect(await refused(leaf('contains', 'n', 1))).toBe('validation');
      expect(await refused(leaf('lt', 'payload', 1))).toBe('validation');
      expect(await refused(leaf('gt', 'raw', new Uint8Array([1])))).toBe('validation');
      expect(await refused(leaf('startsWith', 'tags', 'x'))).toBe('validation');
    });
  });

  describe('dual evaluation against the oracle (14.10 case 2)', () => {
    const runs = subject.networked ? 60 : 120;

    test.each([1, 2, 3])(
      'random conditions select the rows the oracle selects (dataset seed %i)',
      async (seed) => {
        const [data] = sample(randomRows(), { seed, numRuns: 1 });
        if (data === undefined) throw new Error('no dataset');
        await subject.run(scope, async (unit) => {
          await unit.rows.insert(owner, data.owners);
          await unit.rows.insert(probe, data.probes);
        });
        const dataset = {
          rows: (ref: string): readonly StorageRow[] =>
            ref === owner.ref ? data.owners : data.probes,
          entity: (ref: string): EntityDescriptor => (ref === owner.ref ? owner : probe),
        };
        for (const entity of [probe, owner] as const) {
          await assert(
            asyncProperty(
              randomConditions(entity === probe ? 'probe' : 'owner'),
              async (condition) => {
                const wanted = oracleSelect(entity, condition, dataset);
                const found = await sampleSets(subject, entity, condition);
                expect(found).toEqual(wanted);
              },
            ),
            { numRuns: runs, seed },
          );
        }
      },
      120_000,
    );
  });
}
