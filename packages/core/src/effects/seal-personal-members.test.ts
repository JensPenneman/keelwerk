import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { RandomSource } from '../keys/random-source.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { Unit } from '../storage/unit.ts';
import { openPersonalMembers } from '../write-path/open-personal-members.ts';
import { PersonalKeyDestroyed } from '../write-path/personal-key-destroyed.ts';
import { sealPersonalMembers } from './seal-personal-members.ts';

const commandId = '0198a1e0-0000-7000-8000-0000000000c1';
const subject = '0198a1e0-0000-7000-8000-00000000a001';
const thread = '0198a1e0-0000-7000-8000-00000000b001';
const keyId = '0198a1e0-0000-7000-8000-00000000c001';
const scope: StorageScope = { level: 'tenant', backendId: 'backend-1', tenantId: 'tenant-1' };
const fixedRandom: RandomSource = (bytes) => new Uint8Array(bytes).fill(9);

/** A unit with one data key (material fixed) that a test can destroy, and one thread row owned by `subject`. */
function stubUnit(unitScope: StorageScope = scope): {
  readonly unit: Unit;
  readonly destroy: () => void;
} {
  const key: DataKey = { id: keyId, material: new Uint8Array(32).fill(7) };
  let destroyed = false;
  const unit = {
    namespace: { id: 'namespace-1' },
    scope: unitScope,
    keys: {
      dataKey: (id: string) => Promise.resolve(id === subject && !destroyed ? key : undefined),
      keyById: (id: string) => Promise.resolve(id === keyId && !destroyed ? key : undefined),
    },
    rows: {
      findOne: () => Promise.resolve({ id: thread, ownerId: subject }),
    },
  } as unknown as Unit;
  return {
    unit,
    destroy: () => {
      destroyed = true;
    },
  };
}

const registry = {
  entities: new Map([
    [
      'probe.thread',
      {
        descriptor: {
          ref: 'probe.thread',
          fields: { ownerId: { personal: false, sealed: false } },
        },
      },
    ],
  ]),
} as unknown as Registry;

const action = {
  ref: 'probe.subscribe',
  module: 'probe',
  input: shape({
    ownerId: field.subject(),
    address: field.string().personal({ subject: 'ownerId' }),
    threadId: field.ref.own('thread'),
    note: field.string().personal({ subject: 'threadId.ownerId' }),
    tags: field.list(field.string().personal({ subject: 'ownerId' })).optional(),
    title: field.string(),
  }),
} as unknown as ActionEntry;

const input = {
  ownerId: subject,
  address: 'ada@example.org',
  threadId: thread,
  note: 'through a reference',
  tags: ['a', 'b'],
  title: 'plain',
};
const opening = { id: commandId, lost: 'The stored input of this job can no longer be read.' };

const seal = (unit: Unit, value: unknown = input, id = commandId) =>
  sealPersonalMembers({
    unit,
    registry,
    action,
    commandId: id,
    input: value,
    random: fixedRandom,
  });

describe('the personal members of a job input (golden, final)', () => {
  // WP-130: $kwe 2 pads the plaintext (S8); the envelope and every hash over it were regenerated.
  test('a fixed key, command id, member and nonce give this exact stored input', async () => {
    const stored = (await seal(stubUnit().unit)) as Record<string, unknown>;
    expect(stored).toEqual({
      ownerId: subject,
      threadId: thread,
      title: 'plain',
      address: {
        $kwe: 2,
        k: keyId,
        n: 'CQkJCQkJCQkJCQkJ',
        c: 'BeTg9f6VuQDNEqddyIXRuPYwY_M07vfAb65GptV0AXqO_rltboqpOx4S1IduwZ1p',
      },
      note: {
        $kwe: 2,
        k: keyId,
        n: 'CQkJCQkJCQkJCQkJ',
        c: 'BfHs5tGFpgmAA-tKg4zGrbHeAJYWbvfAb65GptV0AXrIyQ1n8QlOXwYuz7BmT4p5',
      },
      tags: {
        $kwe: 2,
        k: keyId,
        n: 'CQkJCQkJCQkJCQkJ',
        c: 'fKfltpLSo0P94ss45uqj39SwY_M07vfAb65GptV0AXoa_gnf233OiexQ7VvGw81A',
      },
    });
  });

  test('every personal member opens again: the subject of a member, of a path through a reference, and a whole list', async () => {
    const { unit } = stubUnit();
    const stored = await seal(unit);
    expect(JSON.stringify(stored)).not.toContain('ada@example.org');
    expect(JSON.stringify(stored)).not.toContain('through a reference');
    expect(await openPersonalMembers(unit, opening, action.input, stored)).toEqual(input);
  });

  test('an input without a personal member is stored as it is', async () => {
    const plain = { input: shape({ title: field.string() }) } as unknown as ActionEntry;
    const value = { title: 'plain' };
    const stored = await sealPersonalMembers({
      unit: stubUnit().unit,
      registry,
      action: plain,
      commandId,
      input: value,
    });
    expect(stored).toEqual(value);
  });

  test('another command id does not open it: conflict', async () => {
    const { unit } = stubUnit();
    const stored = await seal(unit);
    await expect(
      openPersonalMembers(unit, { ...opening, id: 'another-command' }, action.input, stored),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('a destroyed key does not seal (forbidden) and opens as PersonalKeyDestroyed, code core.key_destroyed', async () => {
    const { unit, destroy } = stubUnit();
    const stored = await seal(unit);
    destroy();
    await expect(seal(unit)).rejects.toMatchObject({ kind: 'forbidden' });
    const opened = openPersonalMembers(unit, opening, action.input, stored);
    await expect(opened).rejects.toBeInstanceOf(PersonalKeyDestroyed);
    await expect(opened).rejects.toMatchObject({
      kind: 'not_found',
      code: 'core.key_destroyed',
      message: opening.lost,
    });
  });

  test('outside a tenant unit a personal member is an internal error, and nothing is sealed', async () => {
    for (const outside of [
      { level: 'backend', backendId: 'backend-1' },
      { level: 'deployment' },
    ] as const) {
      const { unit } = stubUnit(outside);
      await expect(seal(unit)).rejects.toMatchObject({ kind: 'internal' });
    }
  });

  test('an input without a personal member is stored as it is outside a tenant too', async () => {
    const plain = { input: shape({ title: field.string() }) } as unknown as ActionEntry;
    const value = { title: 'plain' };
    const stored = await sealPersonalMembers({
      unit: stubUnit({ level: 'deployment' }).unit,
      registry,
      action: plain,
      commandId,
      input: value,
    });
    expect(stored).toBe(value);
  });

  test('a path that resolves to nothing is a validation error', async () => {
    const { unit } = stubUnit();
    await expect(seal(unit, { ...input, ownerId: undefined })).rejects.toMatchObject({
      kind: 'validation',
    });
  });
});
