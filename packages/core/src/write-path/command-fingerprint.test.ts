import { describe, expect, test } from 'vitest';
import { deriveHkdf } from '../keys/derive-hkdf.ts';
import { commandFingerprint } from './command-fingerprint.ts';
import { fingerprintKeyInfo } from './fingerprint-key-info.ts';
import { inputFingerprint } from './input-fingerprint.ts';

const input = { name: 'acme', config: { mail: { apiKey: 'hunter2' } } };
const derived: { info?: string; length?: number } = {};
const keys = {
  derive: async (_scope: unknown, info: string, length: number) => {
    derived.info = info;
    derived.length = length;
    return deriveHkdf(new Uint8Array(32).fill(7), '', info, length);
  },
};
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
    const digest = await commandFingerprint(source({ fingerprintInput: input }));
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
    const digest = await commandFingerprint(source({ fingerprintInput: input }));
    expect(digest).not.toBe(inputFingerprint('core.backend.create', '2026-01-01', input));
    expect(inputFingerprint('core.backend.create', '2026-01-01', input)).toBe(
      'bb0dfb0b16cc3bf33fe20af3a2d45f23d56bdb96da1c239b4025c6e9460d704a',
    );
  });

  test('an input without secret members keeps the plain sha256', async () => {
    const plain = { name: 'acme' };
    expect(await commandFingerprint(source({ input: plain }))).toBe(
      inputFingerprint('core.backend.create', '2026-01-01', plain),
    );
  });
});
