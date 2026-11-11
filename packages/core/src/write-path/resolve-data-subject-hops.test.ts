import { describe, expect, test } from 'vitest';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { resolveDataSubjectHops } from './resolve-data-subject-hops.ts';

const plain: FieldDescriptor = {
  kind: 'string',
  column: 'c',
  optional: false,
  unique: false,
  indexed: false,
  hidden: false,
  maskable: false,
  stateOnly: false,
  sealed: false,
  merge: 'lww',
  personal: false,
  constraints: {},
  ref: null,
  inner: null,
  codec: null,
  tag: 1,
} as unknown as FieldDescriptor;

function descriptorOf(ref: string, fields: Record<string, Partial<FieldDescriptor>>) {
  return {
    ref,
    fields: Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [name, { ...plain, ...field }]),
    ),
  } as unknown as EntityDescriptor;
}

const message = descriptorOf('courier.message', {
  accountId: { ref: { entity: 'courier.account', foreignKey: true } },
  subject: { personal: { subject: 'id' } as FieldDescriptor['personal'] },
});
const account = descriptorOf('courier.account', {
  owner: {},
  count: {},
  token: { kind: 'secret', sealed: true },
});
const descriptors = new Map([
  [message.ref, message],
  [account.ref, account],
]);

function storeOf(rows: Record<string, StorageRow>): { unit: Unit; reads: string[] } {
  const reads: string[] = [];
  const unit = {
    rows: {
      findOne: (descriptor: EntityDescriptor, query: { where: { value: string } }) => {
        const key = `${descriptor.ref}/${query.where.value}`;
        reads.push(key);
        return Promise.resolve(rows[key]);
      },
    },
  } as unknown as Unit;
  return { unit, reads };
}

describe('resolveDataSubjectHops', () => {
  test('decided rows are read before the store', async () => {
    const { unit, reads } = storeOf({ 'courier.account/a1': { id: 'a1', owner: 'stored' } });
    const decided = new Map<string, StorageRow>([
      ['courier.message/m1', { id: 'm1', accountId: 'a1' }],
      ['courier.account/a1', { id: 'a1', owner: 'decided' }],
    ]);
    const subject = await resolveDataSubjectHops(
      {
        unit,
        describe: (ref) => descriptors.get(ref),
        decided: (entity, id) => decided.get(`${entity}/${id}`),
      },
      'courier.message',
      'm1',
      ['accountId', 'owner'],
    );
    expect(subject).toBe('decided');
    expect(reads).toEqual([]);
  });

  test('the store answers when the decision has no row', async () => {
    const { unit } = storeOf({
      'courier.message/m1': { id: 'm1', accountId: 'a1' },
      'courier.account/a1': { id: 'a1', owner: 'stored' },
    });
    const hops = {
      unit,
      describe: (ref: string) => descriptors.get(ref),
      decided: () => undefined,
    };
    expect(
      await resolveDataSubjectHops(hops, 'courier.message', 'm1', ['accountId', 'owner']),
    ).toBe('stored');
    expect(await resolveDataSubjectHops(hops, 'courier.account', 'a1', ['id'])).toBe('a1');
  });

  test('a personal hop field is internal', async () => {
    const { unit } = storeOf({ 'courier.message/m1': { id: 'm1', subject: 'x' } });
    await expect(
      resolveDataSubjectHops(
        { unit, describe: (ref) => descriptors.get(ref) },
        'courier.message',
        'm1',
        ['subject'],
      ),
    ).rejects.toMatchObject({ kind: 'internal' });
  });

  test('a sealed hop field is internal', async () => {
    const { unit } = storeOf({ 'courier.account/a1': { id: 'a1', token: 'kwv1.k.AQ.AQ' } });
    await expect(
      resolveDataSubjectHops(
        { unit, describe: (ref) => descriptors.get(ref) },
        'courier.account',
        'a1',
        ['token'],
      ),
    ).rejects.toMatchObject({ kind: 'internal', message: /sealed field "token"/ });
  });

  test('a value that is no string is internal', async () => {
    const { unit } = storeOf({ 'courier.account/a1': { id: 'a1', count: 3 } });
    await expect(
      resolveDataSubjectHops(
        { unit, describe: (ref) => descriptors.get(ref) },
        'courier.account',
        'a1',
        ['count'],
      ),
    ).rejects.toMatchObject({ kind: 'internal' });
  });

  test('an absent row or value answers undefined', async () => {
    const { unit } = storeOf({
      'courier.message/m1': { id: 'm1', accountId: 'gone' },
      'courier.message/m2': { id: 'm2' },
      'courier.account/a1': { id: 'a1' },
      'courier.account/a2': { id: 'a2', owner: 'x' },
    });
    const hops = { unit, describe: (ref: string) => descriptors.get(ref) };
    expect(
      await resolveDataSubjectHops(hops, 'courier.message', 'm1', ['accountId', 'owner']),
    ).toBe(undefined);
    expect(
      await resolveDataSubjectHops(hops, 'courier.message', 'm2', ['accountId', 'owner']),
    ).toBe(undefined);
    expect(await resolveDataSubjectHops(hops, 'courier.account', 'a1', ['owner'])).toBe(undefined);
    expect(await resolveDataSubjectHops(hops, 'courier.account', 'none', ['owner'])).toBe(
      undefined,
    );
    expect(await resolveDataSubjectHops(hops, 'courier.account', 'a2', ['owner', 'owner'])).toBe(
      undefined,
    );
  });
});
