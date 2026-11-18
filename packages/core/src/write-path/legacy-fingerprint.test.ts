import { describe, expect, test } from 'vitest';
import { testFingerprintKey as key } from '../../test/fingerprint-kit.ts';
import { deriveHkdf } from '../keys/derive-hkdf.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { FingerprintSource } from './command-digests.ts';
import { fingerprintKeyInfo } from './fingerprint-key-info.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { keyedInputFingerprint } from './keyed-input-fingerprint.ts';
import { legacyFingerprint } from './legacy-fingerprint.ts';

const input = { name: 'acme', config: { mail: { apiKey: 'hunter2' } } };
const source = (extra: object): FingerprintSource =>
  ({
    registry: { entities: new Map() },
    action: { ref: 'core.backend.create' },
    fingerprintKey: key,
    apiVersion: '2026-01-01',
    input: { values: 'sealed' },
    ...extra,
  }) as never;

describe('the 0.1.0 form of the input fingerprint (S-111)', () => {
  test('is the HMAC under HKDF(scope key, "keelwerk/fingerprint/v1") for a control create: a known answer', () => {
    expect(fingerprintKeyInfo).toBe('keelwerk/fingerprint/v1');
    expect(
      Buffer.from(deriveHkdf(new Uint8Array(32).fill(7), '', fingerprintKeyInfo, 32)).toString(
        'hex',
      ),
    ).toBe('2d6149e67b65c48d181758ef7759eacf34e95924b145d4caebcbaf55512ba94f');
    expect(legacyFingerprint(source({ fingerprintInput: input }))).toBe(
      '9e2a9621dcd80895a93bf09d7033d057f2b3c3e093551ce570fc60e98a723415',
    );
  });

  test('is never the plain sha256 of the plaintext input when keyed', () => {
    const digest = legacyFingerprint(source({ fingerprintInput: input }));
    expect(digest).not.toBe(inputFingerprint('core.backend.create', '2026-01-01', input));
    expect(inputFingerprint('core.backend.create', '2026-01-01', input)).toBe(
      'bb0dfb0b16cc3bf33fe20af3a2d45f23d56bdb96da1c239b4025c6e9460d704a',
    );
  });

  test('an input without secret members is the plain sha256', () => {
    const plain = { name: 'acme' };
    expect(legacyFingerprint(source({ input: plain }))).toBe(
      inputFingerprint('core.backend.create', '2026-01-01', plain),
    );
  });

  test('an entity command naming a sealed field is keyed', () => {
    const entity = {
      descriptor: { fields: { name: { kind: 'string' }, password: { kind: 'secret' } } },
    };
    const entityAction = { ref: 'probe.person.rename', entity: 'probe.person' } as ActionEntry;
    const at = (given: object) =>
      legacyFingerprint(
        source({
          registry: { entities: new Map([['probe.person', entity]]) } as unknown as Registry,
          action: entityAction,
          input: given,
        }),
      );
    const named = { id: 'p1', password: 'hunter2' };
    expect(at(named)).toBe(keyedInputFingerprint(key, 'probe.person.rename', '2026-01-01', named));
    const unnamed = { id: 'p1', name: 'Ada' };
    expect(at(unnamed)).toBe(inputFingerprint('probe.person.rename', '2026-01-01', unnamed));
  });

  test("a reaction's job has the empty version; any other command has its version", () => {
    const plain = { name: 'acme' };
    const at = (apiVersion: string, extra: object = {}) =>
      legacyFingerprint(source({ input: plain, apiVersion, ...extra }));
    const job = { job: { reaction: true } };
    expect(at('2026-01-01', job)).toBe(at('2027-06-01', job));
    expect(at('2026-01-01', job)).toBe(inputFingerprint('core.backend.create', '', plain));
    expect(at('2026-01-01')).not.toBe(at('2027-06-01'));
    const sealed = (apiVersion: string, extra: object = {}) =>
      legacyFingerprint(source({ fingerprintInput: input, apiVersion, ...extra }));
    expect(sealed('2026-01-01', job)).toBe(sealed('2027-06-01', job));
    expect(sealed('2026-01-01')).not.toBe(sealed('2027-06-01'));
  });

  test('a mask never reaches the legacy form', () => {
    const masked = legacyFingerprint(
      source({ fingerprintInput: input, fingerprintMask: () => ({ name: 'x' }) }),
    );
    expect(masked).toBe(legacyFingerprint(source({ fingerprintInput: input })));
  });
});
