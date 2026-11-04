import type { StorageRow } from '@keelwerk/core';
import type { Arbitrary } from 'fast-check';
import { array, constantFrom, integer, record, subarray, tuple } from 'fast-check';
import { conformanceId } from './conformance-id.ts';
import { conformanceValues } from './conformance-values.ts';
import { missingOwnerId } from './missing-owner-id.ts';
import type { RandomDataset } from './random-dataset.ts';

const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');

const pool = (name: string): readonly unknown[] => conformanceValues[name] ?? [];

const pick = (name: string): Arbitrary<unknown> => constantFrom(...pool(name));

function ownerRow(index: number): Arbitrary<StorageRow> {
  return record(
    {
      name: pick('label'),
      rank: pick('rank'),
    },
    { requiredKeys: [] },
  ).map((values) => ({
    id: conformanceId(100 + index),
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    ...values,
  }));
}

function probeRow(index: number, owners: number): Arbitrary<StorageRow> {
  const ownerIds = [
    ...Array.from({ length: owners }, (_, owner) => conformanceId(100 + owner)),
    missingOwnerId,
  ];
  return record(
    {
      label: pick('label'),
      note: pick('note'),
      n: pick('n'),
      price: pick('price'),
      ratio: pick('ratio'),
      flag: pick('flag'),
      at: pick('at'),
      day: pick('day'),
      mood: pick('mood'),
      tags: subarray([...pool('tag')]).map((tags) => new Set(tags)),
      scores: array(pick('score'), { maxLength: 3 }),
      raw: pick('raw'),
      ownerId: constantFrom(...ownerIds),
    },
    { requiredKeys: [] },
  ).map((values) => ({
    id: conformanceId(200 + index),
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    ...values,
  }));
}

/**
 * Datasets of two to four owners and five to `maxProbes` probes. Every field is absent now and then
 * (`requiredKeys: []`), some probes name an owner that does not exist, and the ids are fixed by
 * position, so a dataset can be inserted into any scope.
 */
export function randomRows(maxProbes = 12): Arbitrary<RandomDataset> {
  return integer({ min: 2, max: 4 }).chain((owners) =>
    record({
      owners: tuple(...Array.from({ length: owners }, (_, index) => ownerRow(index))),
      probes: integer({ min: 5, max: maxProbes }).chain((probes) =>
        tuple(...Array.from({ length: probes }, (_, index) => probeRow(index, owners))),
      ),
    }),
  );
}
