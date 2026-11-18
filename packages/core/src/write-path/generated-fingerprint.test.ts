import { describe, expect, test } from 'vitest';
import { testFingerprintKey as key } from '../../test/fingerprint-kit.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { commandDigests, type FingerprintSource } from './command-digests.ts';

const plainField = { kind: 'string', personal: false, sealed: false, inner: null };
const personalField = {
  kind: 'string',
  personal: { subject: 'ownerId' },
  sealed: false,
  inner: null,
};
const person = {
  descriptor: {
    fields: {
      name: plainField,
      ownerId: plainField,
      email: personalField,
      handle: { ...personalField, personal: { subject: 'id' } },
      password: { kind: 'secret', personal: false, sealed: true, inner: null },
      token: { kind: 'verifier', personal: false, sealed: true, inner: null },
    },
  },
};
const sourceOf = (generated: 'update' | 'set', input: object, over: object = {}) =>
  ({
    registry: { entities: new Map([['probe.person', person]]) } as unknown as Registry,
    action: {
      ref: `probe.person.${generated}`,
      module: 'probe',
      entity: 'probe.person',
      generated,
      input: shape({}),
    } as unknown as ActionEntry,
    fingerprintKey: key,
    apiVersion: '2026-01-01',
    input,
    ...over,
  }) as FingerprintSource;

describe('the digests of a generated update or set (WP-158)', () => {
  test("a set's create and update items are masked by the entity's secret, verifier and personal fields", () => {
    const set = (password: string, token: string, email: string) => ({
      create: [{ name: 'Ada', password, token, email }],
      update: [{ id: 'p1', patch: { password, token, email } }],
    });
    const first = commandDigests(sourceOf('set', set('one', 'a', 'a@x.org')));
    const secrets = commandDigests(sourceOf('set', set('two', 'b', 'a@x.org')));
    // A secret and a verifier change neither digest.
    expect(secrets.fingerprint).toBe(first.fingerprint);
    expect(secrets.decisionBase).toBe(first.decisionBase);
    // A personal value changes the fingerprint, not the base.
    const personal = commandDigests(sourceOf('set', set('one', 'a', 'b@x.org')));
    expect(personal.fingerprint).not.toBe(first.fingerprint);
    expect(personal.decisionBase).toBe(first.decisionBase);
    // The same holds for the map form of the create items.
    const mapped = (password: string) => ({ create: { c1: { name: 'Ada', password } } });
    expect(commandDigests(sourceOf('set', mapped('x'))).decisionBase).toBe(
      commandDigests(sourceOf('set', mapped('y'))).decisionBase,
    );
  });

  test('a generated update masks its patch the same way', () => {
    const update = (password: string, email: string) => ({ id: 'p1', patch: { password, email } });
    const first = commandDigests(sourceOf('update', update('one', 'a@x.org')));
    expect(commandDigests(sourceOf('update', update('two', 'a@x.org'))).fingerprint).toBe(
      first.fingerprint,
    );
    expect(commandDigests(sourceOf('update', update('one', 'b@x.org'))).fingerprint).not.toBe(
      first.fingerprint,
    );
    expect(commandDigests(sourceOf('update', update('one', 'b@x.org'))).decisionBase).toBe(
      first.decisionBase,
    );
  });

  test('an undeclared item member is keyed', () => {
    const item = (extra: string) => ({ create: [{ name: 'Ada', extra }] });
    const first = commandDigests(sourceOf('set', item('one')));
    const other = commandDigests(sourceOf('set', item('two')));
    expect(other.fingerprint).not.toBe(first.fingerprint);
    expect(other.decisionBase).not.toBe(first.decisionBase);
  });

  test('no data key is asked: a unit or a key service in the source is never touched', () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('a digest reads no key');
        },
      },
    );
    const input = { update: [{ id: 'fresh', patch: { handle: 'x' } }] };
    expect(() => commandDigests(sourceOf('set', input, { unit: trap, keys: trap }))).not.toThrow();
  });
});
