import { describe, expect, test } from 'vitest';
import {
  subjectAda as ada,
  subjectBea as bea,
  fingerprintKeys as keys,
  fingerprintScope as scope,
  fingerprintTenantUnit as tenantUnit,
} from '../../test/fingerprint-kit.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { commandFingerprint } from './command-fingerprint.ts';
import { fingerprintKeyInfo } from './fingerprint-key-info.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { keyedInputFingerprint } from './keyed-input-fingerprint.ts';

const plainField = { personal: false, inner: null };
const personalField = { personal: { subject: 'ownerId' }, inner: null };
const sealedField = { personal: false, sealed: true, inner: null };
const person = {
  descriptor: {
    fields: {
      name: plainField,
      ownerId: plainField,
      email: personalField,
      phone: personalField,
      handle: { personal: { subject: 'id' }, inner: null },
      password: sealedField,
    },
  },
};
/** The subjects whose data key `unit` is asked for, in order. */
function watchDataKeys(unit: Unit): string[] {
  const asked: string[] = [];
  const read = unit.keys.dataKey.bind(unit.keys);
  unit.keys.dataKey = (id, options) => {
    asked.push(id);
    return read(id, options);
  };
  return asked;
}
const generatedSource = (generated: 'update' | 'set', input: object) =>
  ({
    registry: { entities: new Map([['probe.person', person]]) } as unknown as Registry,
    action: {
      ref: `probe.person.${generated}`,
      module: 'probe',
      entity: 'probe.person',
      generated,
      input: shape({}),
    } as unknown as ActionEntry,
    keys,
    scope,
    apiVersion: '2026-01-01',
    input,
  }) as never;

describe('the input fingerprint of a generated update or set (WP-130)', () => {
  test('a generated update that patches a personal field is keyed, not the 0.1.0 plain digest', async () => {
    const input = { id: 'p1', ifVersion: 1, patch: { email: 'ada@example.com' } };
    const digest = await commandFingerprint(generatedSource('update', input), {
      unit: tenantUnit([]),
      create: true,
    });
    expect(digest).not.toBe(inputFingerprint('probe.person.update', '2026-01-01', input));
    expect(digest).toBe(
      keyedInputFingerprint(
        await keys.derive(scope, fingerprintKeyInfo, 32),
        'probe.person.update',
        '2026-01-01',
        input,
      ),
    );
  });

  test('a generated update that patches no personal field keeps its plain digest', async () => {
    const input = { id: 'p1', patch: { name: 'Ada' } };
    expect(
      await commandFingerprint(generatedSource('update', input), {
        unit: tenantUnit([]),
        create: true,
      }),
    ).toBe(inputFingerprint('probe.person.update', '2026-01-01', input));
  });

  test('a generated set that names a personal field in a create or an update is keyed', async () => {
    const forms = [
      { create: [{ name: 'A', email: 'ada@example.com' }] },
      { create: { c1: { name: 'A', email: 'ada@example.com' } } },
      { update: [{ id: 'p1', patch: { email: 'ada@example.com' } }] },
    ];
    for (const input of forms) {
      const digest = await commandFingerprint(generatedSource('set', input), {
        unit: tenantUnit([]),
        create: true,
      });
      expect(digest).not.toBe(inputFingerprint('probe.person.set', '2026-01-01', input));
      expect(digest).toBe(
        keyedInputFingerprint(
          await keys.derive(scope, fingerprintKeyInfo, 32),
          'probe.person.set',
          '2026-01-01',
          input,
        ),
      );
    }
    const plain = { create: [{ name: 'A' }], archive: [{ id: 'p1' }] };
    expect(
      await commandFingerprint(generatedSource('set', plain), {
        unit: tenantUnit([]),
        create: true,
      }),
    ).toBe(inputFingerprint('probe.person.set', '2026-01-01', plain));
  });

  test('a personal field of a generated update whose subject is in the patch is digested under the subject key', async () => {
    const input = { id: 'p1', patch: { ownerId: ada, phone: '+32 470 00 00 00' } };
    const first = await commandFingerprint(generatedSource('update', input), {
      unit: tenantUnit([ada]),
      create: true,
    });
    const other = await commandFingerprint(generatedSource('update', input), {
      unit: tenantUnit([bea, ada]),
      create: true,
    });
    expect(other).not.toBe(first);
    await expect(
      commandFingerprint(generatedSource('update', input), { unit: tenantUnit([]), create: true }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('a generated update that patches a sealed member is keyed too', async () => {
    const input = { id: 'p1', patch: { password: 'hunter2' } };
    const digest = await commandFingerprint(generatedSource('update', input), {
      unit: tenantUnit([]),
      create: true,
    });
    expect(digest).not.toBe(inputFingerprint('probe.person.update', '2026-01-01', input));
    expect(digest).toBe(
      keyedInputFingerprint(
        await keys.derive(scope, fingerprintKeyInfo, 32),
        'probe.person.update',
        '2026-01-01',
        input,
      ),
    );
  });

  test('a set whose subject is not a string resolves without an error and asks for no data key', async () => {
    const unit = tenantUnit([]);
    const asked = watchDataKeys(unit);
    const input = { create: [{ ownerId: 5, phone: '1' }] };
    await expect(
      commandFingerprint(generatedSource('set', input), { unit, create: true }),
    ).resolves.toBe(
      keyedInputFingerprint(
        await keys.derive(scope, fingerprintKeyInfo, 32),
        'probe.person.set',
        '2026-01-01',
        input,
      ),
    );
    expect(asked).toEqual([]);
  });

  test('an update with an id that is no UUID asks for no data key', async () => {
    const unit = tenantUnit([ada]);
    const asked = watchDataKeys(unit);
    const input = { id: 'ada@example.com', patch: { handle: 'x' } };
    await commandFingerprint(generatedSource('update', input), { unit, create: true });
    const inSet = { update: [{ id: 'ada@example.com', patch: { handle: 'x' } }] };
    await commandFingerprint(generatedSource('set', inSet), { unit, create: true });
    expect(asked).toEqual([]);
  });

  test('the id of an update is the subject, whatever the patch names as its id', async () => {
    const unit = tenantUnit([ada, bea]);
    const asked = watchDataKeys(unit);
    const input = { id: ada, patch: { id: bea, handle: 'x' } };
    await commandFingerprint(generatedSource('update', input), { unit, create: true });
    expect(asked).toEqual([ada]);
  });

  test('keys null answers the 0.1.0 form', async () => {
    const input = { id: 'p1', patch: { email: 'ada@example.com' } };
    expect(await commandFingerprint(generatedSource('update', input), null)).toBe(
      inputFingerprint('probe.person.update', '2026-01-01', input),
    );
  });
});
