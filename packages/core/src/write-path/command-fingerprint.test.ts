import { describe, expect, test } from 'vitest';
import {
  subjectAda as ada,
  subjectBea as bea,
  derived,
  fingerprintKeys as keys,
  fingerprintScope as scope,
  fingerprintTenantUnit as tenantUnit,
} from '../../test/fingerprint-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { deriveHkdf } from '../keys/derive-hkdf.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import { commandFingerprint } from './command-fingerprint.ts';
import { fingerprintKeyInfo } from './fingerprint-key-info.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { keyedInputFingerprint } from './keyed-input-fingerprint.ts';
import { PersonalKeyDestroyed } from './personal-key-destroyed.ts';
import { personalMemberDigest as personalMemberDigestOf } from './personal-member-digest.ts';

const input = { name: 'acme', config: { mail: { apiKey: 'hunter2' } } };
const source = (extra: object) =>
  ({
    registry: { entities: new Map() },
    action: { ref: 'core.backend.create' },
    keys,
    scope: { level: 'deployment' },
    apiVersion: '2026-01-01',
    input: { values: 'sealed' },
    ...extra,
  }) as never;

describe('the input fingerprint of a command with secret members (S-111)', () => {
  test('is the HMAC under HKDF(scope key, "keelwerk/fingerprint/v1"): a known answer', async () => {
    const digest = await commandFingerprint(source({ fingerprintInput: input }), null);
    expect(fingerprintKeyInfo).toBe('keelwerk/fingerprint/v1');
    expect(derived).toEqual({ info: 'keelwerk/fingerprint/v1', length: 32 });
    expect(
      Buffer.from(deriveHkdf(new Uint8Array(32).fill(7), '', fingerprintKeyInfo, 32)).toString(
        'hex',
      ),
    ).toBe('2d6149e67b65c48d181758ef7759eacf34e95924b145d4caebcbaf55512ba94f');
    expect(digest).toBe('9e2a9621dcd80895a93bf09d7033d057f2b3c3e093551ce570fc60e98a723415');
  });

  test('never equals the plain sha256 of the plaintext input', async () => {
    const digest = await commandFingerprint(source({ fingerprintInput: input }), null);
    expect(digest).not.toBe(inputFingerprint('core.backend.create', '2026-01-01', input));
    expect(inputFingerprint('core.backend.create', '2026-01-01', input)).toBe(
      'bb0dfb0b16cc3bf33fe20af3a2d45f23d56bdb96da1c239b4025c6e9460d704a',
    );
  });

  test('an input without secret members keeps the plain sha256', async () => {
    const plain = { name: 'acme' };
    expect(await commandFingerprint(source({ input: plain }), null)).toBe(
      inputFingerprint('core.backend.create', '2026-01-01', plain),
    );
  });

  test('a reaction job has no version in it; any other command does', async () => {
    const plain = { name: 'acme' };
    const at = (apiVersion: string, extra: object = {}) =>
      commandFingerprint(source({ input: plain, apiVersion, ...extra }), null);
    const job = { job: { reaction: true } };
    expect(await at('2026-01-01', job)).toBe(await at('2027-06-01', job));
    expect(await at('2026-01-01', job)).toBe(inputFingerprint('core.backend.create', '', plain));
    expect(await at('2026-01-01')).not.toBe(await at('2027-06-01'));
    const sealed = (apiVersion: string, extra: object = {}) =>
      commandFingerprint(source({ fingerprintInput: input, apiVersion, ...extra }), null);
    expect(await sealed('2026-01-01', job)).toBe(await sealed('2027-06-01', job));
    expect(await sealed('2026-01-01')).not.toBe(await sealed('2027-06-01'));
  });
});

const personalAction = {
  ref: 'probe.subscribe',
  module: 'probe',
  input: shape({
    ownerId: field.subject(),
    address: field.string().personal({ subject: 'ownerId' }),
    nickname: field.string().personal(),
    title: field.string(),
  }),
} as unknown as ActionEntry;
const personalSource = (input: object, over: object = {}) =>
  ({
    registry: { entities: new Map() } as unknown as Registry,
    action: personalAction,
    keys,
    scope,
    apiVersion: '2026-01-01',
    input,
    ...over,
  }) as never;
const personalInput = { ownerId: ada, address: 'ada@example.org', title: 'hello' };

describe('the input fingerprint of a command with personal members (WP-130)', () => {
  test('an input without personal or secret members keeps its 0.1.0 digest', async () => {
    const plain = { name: 'acme' };
    const unit = tenantUnit([ada]);
    expect(await commandFingerprint(source({ input: plain }), { unit, create: true })).toBe(
      inputFingerprint('core.backend.create', '2026-01-01', plain),
    );
    expect(
      await commandFingerprint(personalSource({ ownerId: ada, title: 'hello' }), {
        unit,
        create: true,
      }),
    ).toBe(inputFingerprint('probe.subscribe', '2026-01-01', { ownerId: ada, title: 'hello' }));
  });

  test('keys null answers the 0.1.0 form', async () => {
    expect(await commandFingerprint(personalSource(personalInput), null)).toBe(
      inputFingerprint('probe.subscribe', '2026-01-01', personalInput),
    );
  });

  test('a personal member is digested under its subject key, so another key gives another digest', async () => {
    const first = await commandFingerprint(personalSource(personalInput), {
      unit: tenantUnit([ada]),
      create: true,
    });
    const other = await commandFingerprint(personalSource(personalInput), {
      unit: tenantUnit([bea, ada]),
      create: true,
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(inputFingerprint('probe.subscribe', '2026-01-01', personalInput));
    // The same subject under another key material is another digest: the digest dies with the key.
    expect(other).not.toBe(first);
    // The same key gives the same digest.
    expect(
      await commandFingerprint(personalSource(personalInput), {
        unit: tenantUnit([ada]),
        create: false,
      }),
    ).toBe(first);
  });

  // Golden vectors of the WP-130 D1 stored form of the receipt fingerprint (and of the decision
  // digest built on it), computed outside the kernel with node:crypto: HKDF-SHA-256 of the
  // subject's key with the info 'keelwerk/fingerprint/personal/v1', HMAC-SHA-256 over the
  // canonical JSON {action, member, value}, then the outer digest over the input with that digest
  // in place of the member, under HKDF(scope key, 'keelwerk/fingerprint/v1'). A change to any step
  // changes a stored format and must come with a new version.
  test('a personal member is digested under its subject key: golden vectors', async () => {
    const key: DataKey = { id: 'key-0', material: new Uint8Array(32).fill(1) };
    expect(personalMemberDigestOf(key, 'probe.subscribe', 'address', 'ada@example.org')).toBe(
      '0a9b0987fb18080feb7b308c1998775de7b0cdbf2d9ad64588470c21d234a16c',
    );
    expect(
      await commandFingerprint(personalSource(personalInput), {
        unit: tenantUnit([ada]),
        create: true,
      }),
    ).toBe('2b17a734d2e5a14bc342e876f979e28f7781c8c1ae08d90fb803237e819e35e5');
  });

  test('the member digest differs per member name and per action', () => {
    const key: DataKey = { id: 'key-0', material: new Uint8Array(32).fill(1) };
    const base = personalMemberDigestOf(key, 'probe.subscribe', 'address', 'ada@example.org');
    expect(personalMemberDigestOf(key, 'probe.subscribe', 'nickname', 'ada@example.org')).not.toBe(
      base,
    );
    expect(personalMemberDigestOf(key, 'probe.other', 'address', 'ada@example.org')).not.toBe(base);
    expect(personalMemberDigestOf(key, 'probe.subscribe', 'address', 'bea@example.org')).not.toBe(
      base,
    );
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a shredded subject is forbidden on a write and PersonalKeyDestroyed on a re-decide', async () => {
    const unit = tenantUnit([]);
    await expect(
      commandFingerprint(personalSource(personalInput), { unit, create: true }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(
      commandFingerprint(personalSource(personalInput), { unit, create: false }),
    ).rejects.toBeInstanceOf(PersonalKeyDestroyed);
  });

  test('a personal member without a subject keys the outer digest only', async () => {
    const input = { ownerId: ada, nickname: 'ada', title: 'hello' };
    const digest = await commandFingerprint(personalSource(input), {
      unit: tenantUnit([ada]),
      create: true,
    });
    expect(digest).not.toBe(inputFingerprint('probe.subscribe', '2026-01-01', input));
    // The member stays as given: the same digest with no key of any subject.
    expect(
      await commandFingerprint(personalSource(input), { unit: tenantUnit([]), create: true }),
    ).toBe(digest);
  });

  test('a unit outside a tenant digests no member', async () => {
    const digest = await commandFingerprint(personalSource(personalInput), {
      unit: tenantUnit([], 'backend'),
      create: true,
    });
    // The member stays as given and goes into the keyed outer digest.
    expect(digest).toBe(
      keyedInputFingerprint(
        await keys.derive(scope, fingerprintKeyInfo, 32),
        'probe.subscribe',
        '2026-01-01',
        personalInput,
      ),
    );
  });
});
