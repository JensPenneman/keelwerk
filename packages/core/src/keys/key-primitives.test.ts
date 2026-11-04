import { describe, expect, it } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { columnKeyId } from './column-key-id.ts';
import { deriveFieldKey } from './derive-field-key.ts';
import { deriveHkdf } from './derive-hkdf.ts';
import { encodeAad } from './encode-aad.ts';
import { encodeBase32 } from './encode-base32.ts';
import { openAesGcm } from './open-aes-gcm.ts';
import { openColumn } from './open-column.ts';
import { openKwe } from './open-kwe.ts';
import { sealAesGcm } from './seal-aes-gcm.ts';
import { sealColumn } from './seal-column.ts';
import { sealKwe } from './seal-kwe.ts';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const unhex = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'hex'));
const key = { id: '01930000-0000-7000-8000-000000000001', material: unhex('00'.repeat(32)) };
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('HKDF-SHA-256', () => {
  it('matches test case 1 of RFC 5869', () => {
    const okm = deriveHkdf(
      unhex('0b'.repeat(22)),
      unhex('000102030405060708090a0b0c'),
      unhex('f0f1f2f3f4f5f6f7f8f9'),
      42,
    );
    expect(hex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('matches test case 3 of RFC 5869 (empty salt and info)', () => {
    expect(hex(deriveHkdf(unhex('0b'.repeat(22)), '', '', 42))).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });
});

describe('AES-256-GCM', () => {
  const random = countingRandomSource();

  it('opens what it sealed and nothing else', () => {
    const aad = encodeAad(['a', 'b']);
    const sealed = sealAesGcm(key.material, text('hello'), aad, random);
    expect(sealed.nonce).toHaveLength(12);
    expect(sealed.ciphertext).toHaveLength(5 + 16);
    expect(openAesGcm(key.material, sealed.nonce, sealed.ciphertext, aad)).toEqual(text('hello'));
    expect(
      openAesGcm(key.material, sealed.nonce, sealed.ciphertext, encodeAad(['a', 'c'])),
    ).toBeUndefined();
    expect(
      openAesGcm(unhex('01'.repeat(32)), sealed.nonce, sealed.ciphertext, aad),
    ).toBeUndefined();
    const flipped = Uint8Array.from(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(openAesGcm(key.material, sealed.nonce, flipped, aad)).toBeUndefined();
  });

  it('draws a different nonce every time', () => {
    const a = sealAesGcm(key.material, text('x'), encodeAad([]), random);
    const b = sealAesGcm(key.material, text('x'), encodeAad([]), random);
    expect(a.nonce).not.toEqual(b.nonce);
  });

  it('encodes associated data so that part boundaries matter', () => {
    expect(encodeAad(['ab', 'c'])).not.toEqual(encodeAad(['a', 'bc']));
  });
});

describe('the $kwe envelope', () => {
  const binding = { namespace: 'ns', streamId: 's1', eventId: 'e1', field: 'email' };

  it('is final: golden envelope', () => {
    const envelope = sealKwe(key, text('jens@example.com'), binding, countingRandomSource());
    expect(envelope).toEqual({
      $kwe: 1,
      k: '01930000-0000-7000-8000-000000000001',
      n: 'AAECAwQFBgcICQoL',
      c: '4q5dIUCY95ivCD6A02CxYWrBZbcsaJ3Oc9itQzJTvEQ',
    });
    expect(openKwe(envelope, key.material, binding)).toEqual(text('jens@example.com'));
  });

  it('fails to open when moved to another stream, event or field', () => {
    const envelope = sealKwe(key, text('v'), binding, countingRandomSource());
    for (const moved of [
      { ...binding, streamId: 's2' },
      { ...binding, eventId: 'e2' },
      { ...binding, field: 'name' },
      { ...binding, namespace: 'other' },
    ]) {
      expect(openKwe(envelope, key.material, moved)).toBeUndefined();
    }
  });

  it('opens to undefined once the data key is destroyed', () => {
    const envelope = sealKwe(key, text('v'), binding, countingRandomSource());
    expect(openKwe(envelope, undefined, binding)).toBeUndefined();
  });
});

describe('the sealed column', () => {
  const binding = { namespace: 'ns', entity: 'profile', rowId: 'r1', field: 'email' };

  it('is final: golden bytes, padded to 16, 45 bytes of overhead', () => {
    const sealed = sealColumn(key, text('jens@example.com'), binding, countingRandomSource());
    expect(sealed).toHaveLength(32 + 45);
    expect(hex(sealed)).toBe(
      '0101930000000070008000000000000001000102030405060708090a0be2ae5d214098f798af083e80d360b161d46ca89abf9d8ff6cfcbe40b8d350f6ffd262f208ca07113b407aea871696edd',
    );
    expect(columnKeyId(sealed)).toBe(key.id);
    expect(openColumn(sealed, key.material, binding)).toEqual(text('jens@example.com'));
  });

  it('round-trips empty, short and block-sized values', () => {
    for (const length of [0, 1, 15, 16, 17, 100]) {
      const plain = new Uint8Array(length).fill(0x80);
      const sealed = sealColumn(key, plain, binding, countingRandomSource());
      expect(sealed).toHaveLength(45 + (Math.floor(length / 16) + 1) * 16);
      expect(openColumn(sealed, key.material, binding)).toEqual(plain);
    }
  });

  it('fails to open when moved to another row, field, entity, namespace or key id', () => {
    const sealed = sealColumn(key, text('v'), binding, countingRandomSource());
    for (const moved of [
      { ...binding, rowId: 'r2' },
      { ...binding, field: 'name' },
      { ...binding, entity: 'account' },
      { ...binding, namespace: 'other' },
    ]) {
      expect(openColumn(sealed, key.material, moved)).toBeUndefined();
    }
    const rekeyed = Uint8Array.from(sealed);
    rekeyed[16] = (rekeyed[16] ?? 0) ^ 1;
    expect(openColumn(rekeyed, key.material, binding)).toBeUndefined();
  });

  it('opens to undefined once the data key is destroyed, and for malformed values', () => {
    const sealed = sealColumn(key, text('v'), binding, countingRandomSource());
    expect(openColumn(sealed, undefined, binding)).toBeUndefined();
    expect(openColumn(new Uint8Array(10), key.material, binding)).toBeUndefined();
    expect(
      openColumn(Uint8Array.of(9, ...sealed.subarray(1)), key.material, binding),
    ).toBeUndefined();
  });
});

describe('index field keys', () => {
  const root = unhex('07'.repeat(32));
  const base = { entity: 'profile', field: 'email', capability: 'eq', normaliser: 'email@1' };

  it('is final: golden key', () => {
    expect(hex(deriveFieldKey(root, base))).toBe(
      '950d4dbcc5dc30ecaf888aee62ca9e5cf3f9702c8f08d999585f511fd0a848eb',
    );
  });

  it('gives each capability, field, normaliser version and parameter set its own key', () => {
    const keys = [
      deriveFieldKey(root, base),
      deriveFieldKey(root, { ...base, capability: 'prefix' }),
      deriveFieldKey(root, { ...base, field: 'name' }),
      deriveFieldKey(root, { ...base, normaliser: 'email@2' }),
      deriveFieldKey(root, { ...base, parameters: { bits: 64 } }),
      deriveFieldKey(unhex('08'.repeat(32)), base),
    ].map(hex);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not depend on the order of parameter members', () => {
    expect(deriveFieldKey(root, { ...base, parameters: { a: 1, b: 2 } })).toEqual(
      deriveFieldKey(root, { ...base, parameters: { b: 2, a: 1 } }),
    );
  });
});

describe('base32', () => {
  it('encodes RFC 4648 vectors in lower case without padding', () => {
    expect(encodeBase32(text('foobar'))).toBe('mzxw6ytboi');
    expect(encodeBase32(text('fo'))).toBe('mzxq');
    expect(encodeBase32(new Uint8Array(0))).toBe('');
    expect(encodeBase32(new Uint8Array(16))).toHaveLength(26);
    expect(encodeBase32(new Uint8Array(32))).toHaveLength(52);
  });
});
