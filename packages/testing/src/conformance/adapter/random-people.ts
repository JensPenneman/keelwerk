import type { StorageRow } from '@keelwerk/core';
import type { Arbitrary } from 'fast-check';
import { array, constantFrom, record } from 'fast-check';
import { encryptedQueryPools } from './encrypted-query-pools.ts';
import { personRow } from './person-row.ts';

const { values, subjects } = encryptedQueryPools;
const pick = (name: string): Arbitrary<unknown> => constantFrom(...(values[name] ?? []));

/** Four to twelve people; every personal value is absent now and then, the subject never. */
export function randomPeople(): Arbitrary<readonly StorageRow[]> {
  return array(
    record(
      {
        subject: constantFrom(...subjects),
        label: pick('label'),
        exactName: pick('exactName'),
        nfcName: pick('nfcName'),
        caselessName: pick('caselessName'),
        mail: pick('mail'),
        age: pick('age'),
        note: pick('note'),
      },
      { requiredKeys: ['subject'] },
    ),
    { minLength: 4, maxLength: 12 },
  ).map((rows) => rows.map((fields, index) => personRow(index, fields)));
}
