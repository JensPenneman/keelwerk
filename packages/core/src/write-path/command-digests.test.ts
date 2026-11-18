import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { testFingerprintKey as key } from '../../test/fingerprint-kit.ts';
import { maskConfigValues } from '../control/mask-config-values.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { commandDigests, type FingerprintSource } from './command-digests.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { nestedFingerprint } from './nested-fingerprint.ts';

const personal = (subject?: string) =>
  subject === undefined ? field.string().personal() : field.string().personal({ subject });
const moduleAction = {
  ref: 'probe.subscribe',
  module: 'probe',
  input: shape({
    address: personal(),
    password: field.secret(),
    title: field.string(),
  }),
} as unknown as ActionEntry;
const input = { address: 'ada@example.org', password: 'hunter2', title: 'hello' };

const entityFields = {
  name: { kind: 'string', personal: false, sealed: false, inner: null },
  email: { kind: 'string', personal: { subject: 'id' }, sealed: false, inner: null },
  password: { kind: 'secret', personal: false, sealed: true, inner: null },
  apiKey: { kind: 'verifier', personal: false, sealed: true, inner: null },
};
const registry = {
  entities: new Map([['probe.person', { descriptor: { fields: entityFields } }]]),
} as unknown as Registry;

function sourceOf(over: object = {}, action: ActionEntry = moduleAction): FingerprintSource {
  return {
    registry,
    action,
    fingerprintKey: key,
    apiVersion: '2026-01-01',
    input,
    ...over,
  } as FingerprintSource;
}
const generatedAction = (generated: 'create' | 'update' | 'set') =>
  ({
    ref: `probe.person.${generated}`,
    module: 'probe',
    entity: 'probe.person',
    generated,
    input: shape({}),
  }) as unknown as ActionEntry;

/** The message of a digest, written out: HMAC-SHA-256 over the canonical JSON, keys in order. */
function expected(message: string, tag: string): string {
  return tag + createHmac('sha256', key).update(message).digest('hex');
}

describe('the two digests of a command', () => {
  // Stored formats (kwf1. in the receipt, kwb1. in the event meta). The vectors are built here
  // from node:crypto alone: the withheld marker replaces the secret, the personal address stays in
  // the fingerprint and is withheld from the base, which also holds the member digest: 'decision'.
  test('known answers: a fixed key and input give a fixed kwf1 fingerprint and kwb1 base', () => {
    const digests = commandDigests(sourceOf());
    expect(digests.fingerprint).toBe(
      expected(
        '{"action":"probe.subscribe","apiVersion":"2026-01-01","input":{"address":"ada@example.org","password":"kw:withheld","title":"hello"}}',
        'kwf1.',
      ),
    );
    expect(digests.decisionBase).toBe(
      expected(
        '{"action":"probe.subscribe","apiVersion":"2026-01-01","digest":"decision","input":{"address":"kw:withheld","password":"kw:withheld","title":"hello"}}',
        'kwb1.',
      ),
    );
    expect(digests.fingerprint).toBe(
      'kwf1.c32499229c869ac6557a10b6cf70745af8a0988c2fa4ee524f74b7e16a9507ee',
    );
  });

  test('a secret member does not change either digest', () => {
    const first = commandDigests(sourceOf());
    const other = commandDigests(sourceOf({ input: { ...input, password: 'another' } }));
    expect(other.fingerprint).toBe(first.fingerprint);
    expect(other.decisionBase).toBe(first.decisionBase);
  });

  test('a verifier member of a generated create does not change either digest', () => {
    const create = { name: 'Ada', apiKey: 'one' };
    const action = {
      ...generatedAction('create'),
      input: shape({ name: field.string(), apiKey: field.verifier() }),
    } as unknown as ActionEntry;
    const first = commandDigests(sourceOf({ input: create }, action));
    const other = commandDigests(sourceOf({ input: { ...create, apiKey: 'two' } }, action));
    expect(other.fingerprint).toBe(first.fingerprint);
    expect(other.decisionBase).toBe(first.decisionBase);
  });

  describe('a personal member changes the fingerprint and not the base', () => {
    const check = (first: FingerprintSource, other: FingerprintSource) => {
      const a = commandDigests(first);
      const b = commandDigests(other);
      expect(b.fingerprint).not.toBe(a.fingerprint);
      expect(b.decisionBase).toBe(a.decisionBase);
    };

    test('of a module command', () => {
      check(sourceOf(), sourceOf({ input: { ...input, address: 'bea@example.org' } }));
    });

    test('inside the patch of a generated update', () => {
      const update = (email: string) => ({ id: 'p1', patch: { name: 'Ada', email } });
      check(
        sourceOf({ input: update('a@x.org') }, generatedAction('update')),
        sourceOf({ input: update('b@x.org') }, generatedAction('update')),
      );
    });

    test('inside an item of a generated set', () => {
      const set = (email: string) => ({
        create: [{ name: 'Ada', email }],
        update: [{ id: 'p1', patch: { email } }],
      });
      check(
        sourceOf({ input: set('a@x.org') }, generatedAction('set')),
        sourceOf({ input: set('b@x.org') }, generatedAction('set')),
      );
    });
  });

  test('a plain member changes both', () => {
    const first = commandDigests(sourceOf());
    const other = commandDigests(sourceOf({ input: { ...input, title: 'other' } }));
    expect(other.fingerprint).not.toBe(first.fingerprint);
    expect(other.decisionBase).not.toBe(first.decisionBase);
  });

  test('the two never share their hex, also without a personal member', () => {
    const plain = { ref: 'probe.ping', module: 'probe', input: shape({ title: field.string() }) };
    const digests = commandDigests(sourceOf({ input: { title: 'x' } }, plain as never));
    expect(digests.fingerprint.slice('kwf1.'.length)).not.toBe(
      digests.decisionBase.slice('kwb1.'.length),
    );
    expect(digests.fingerprint).toMatch(/^kwf1\.[0-9a-f]{64}$/);
    expect(digests.decisionBase).toMatch(/^kwb1\.[0-9a-f]{64}$/);
  });

  test('neither equals inputFingerprint of the same input, secrets or none', () => {
    const plainAction = {
      ref: 'probe.ping',
      module: 'probe',
      input: shape({ title: field.string() }),
    } as unknown as ActionEntry;
    for (const [action, given] of [
      [moduleAction, input],
      [plainAction, { title: 'x' }],
    ] as const) {
      const digests = commandDigests(sourceOf({ input: given }, action));
      const plain = inputFingerprint(action.ref, '2026-01-01', given);
      expect(digests.fingerprint.endsWith(plain)).toBe(false);
      expect(digests.decisionBase.endsWith(plain)).toBe(false);
      expect(digests.fingerprint).not.toContain(plain);
      expect(digests.decisionBase).not.toContain(plain);
    }
  });

  test("a reaction's job holds no version in either; any other command does", () => {
    const at = (apiVersion: string, job?: { reaction: true }) =>
      commandDigests(sourceOf({ apiVersion, ...(job === undefined ? {} : { job }) }));
    const job = { reaction: true } as const;
    expect(at('2026-01-01', job).fingerprint).toBe(at('2027-06-01', job).fingerprint);
    expect(at('2026-01-01', job).decisionBase).toBe(at('2027-06-01', job).decisionBase);
    expect(at('2026-01-01').fingerprint).not.toBe(at('2027-06-01').fingerprint);
    expect(at('2026-01-01').decisionBase).not.toBe(at('2027-06-01').decisionBase);
  });

  test('a hook job has no version in either, and digests as the reaction form does', () => {
    const at = (apiVersion: string, job: object) => commandDigests(sourceOf({ apiVersion, job }));
    const hook = { hook: true };
    expect(at('2026-01-01', hook).fingerprint).toBe(at('2027-06-01', hook).fingerprint);
    expect(at('2026-01-01', hook).decisionBase).toBe(at('2027-06-01', hook).decisionBase);
    expect(at('2026-01-01', hook).fingerprint).toBe(
      at('2026-01-01', { reaction: true }).fingerprint,
    );
    expect(at('2026-01-01', hook).decisionBase).toBe(
      at('2026-01-01', { reaction: true }).decisionBase,
    );
  });

  test('a nested source drops the job: the version is in both again', () => {
    const job = { reaction: true } as const;
    const nested = (apiVersion: string) => nestedFingerprint(sourceOf({ apiVersion, job }));
    expect(nested('2026-01-01').fingerprint).not.toBe(nested('2027-06-01').fingerprint);
    expect(nested('2026-01-01').decisionBase).not.toBe(nested('2027-06-01').decisionBase);
    expect(nested('2026-01-01').fingerprint).toBe(commandDigests(sourceOf()).fingerprint);
  });

  test('the legacy form is computed only when called', () => {
    const digests = commandDigests(sourceOf());
    expect(digests.legacyFingerprint()).toBe(
      inputFingerprint('probe.subscribe', '2026-01-01', input),
    );
  });
});

describe('the control path (a backend create)', () => {
  const create = {
    ref: 'core.backend.create',
    module: 'core',
    input: shape({ name: field.string() }),
  } as unknown as ActionEntry;
  const control = (given: object) =>
    sourceOf(
      { input: { values: 'sealed' }, fingerprintInput: given, fingerprintMask: maskConfigValues },
      create,
    );

  test('two creates that differ only in a config value, secret or not, share both digests', () => {
    const digests = (config: object) => commandDigests(control({ name: 'acme', config }));
    for (const member of ['apiKey', 'host']) {
      const first = digests({ mail: { [member]: 'one' } });
      const other = digests({ mail: { [member]: 'two' } });
      expect(other.fingerprint).toBe(first.fingerprint);
      expect(other.decisionBase).toBe(first.decisionBase);
    }
  });

  test('another name changes both', () => {
    const first = commandDigests(control({ name: 'acme', config: {} }));
    const other = commandDigests(control({ name: 'other', config: {} }));
    expect(other.fingerprint).not.toBe(first.fingerprint);
    expect(other.decisionBase).not.toBe(first.decisionBase);
  });
});
