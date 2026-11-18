import { describe, expect, test } from 'vitest';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { checkSerialPartitions } from './check-serial-partitions.ts';
import type { EntityEntry } from './entity-entry.ts';

const field = (over: Record<string, unknown> = {}): FieldDescriptor =>
  ({
    kind: 'string',
    personal: false,
    sealed: false,
    inner: null,
    constraints: {},
    ...over,
  }) as unknown as FieldDescriptor;
const personal = field({ personal: { subject: 'id' } });
const serial = (per?: string): FieldDescriptor =>
  field({ kind: 'serial', constraints: per === undefined ? {} : { per } });

function entities(
  fields: Record<string, FieldDescriptor>,
  dataSubject: string | null = null,
): ReadonlyMap<string, EntityEntry> {
  return new Map([
    [
      'm.invoice',
      { ref: 'm.invoice', module: 'm', descriptor: { tenancy: 'tenant', fields, dataSubject } },
    ] as never,
  ]);
}

describe('checkSerialPartitions (14.7.5)', () => {
  test.each([
    ['a personal field', { number: serial('owner'), owner: personal }, null],
    [
      'a set whose element is personal',
      { number: serial('owners'), owners: field({ kind: 'set', inner: personal }) },
      null,
    ],
    ['a sealed field', { number: serial('token'), token: field({ sealed: true }) }, null],
    ['the data subject', { number: serial('subject'), subject: field() }, 'subject'],
    ['an unknown field', { number: serial('nobody') }, null],
  ])('%s as the partition is refused', (_name, fields, dataSubject) => {
    const [problem, ...rest] = checkSerialPartitions(entities(fields, dataSubject));
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({
      code: 'serialPartition',
      severity: 'error',
      module: 'm',
      ref: 'm.invoice',
    });
  });

  test('a partition that names a plain ref passes, and so does a serial without per', () => {
    expect(
      checkSerialPartitions(
        entities({ number: serial('customer'), customer: field({ kind: 'ref' }) }),
      ),
    ).toEqual([]);
    expect(checkSerialPartitions(entities({ number: serial() }))).toEqual([]);
  });
});
