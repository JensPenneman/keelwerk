import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';
import { assertSameInlineInput } from './assert-same-inline-input.ts';

const effectId = 'effect-1';
const entry = {
  ref: 'app.ping',
  module: 'app',
  input: shape({ to: field.string(), code: field.secret() }),
} as unknown as EffectEntry;

const encoder = new TextEncoder();
const text = (sealed: SealedValue): string =>
  [
    'kwv1',
    sealed.keyId,
    Buffer.from(sealed.nonce).toString('base64url'),
    Buffer.from(sealed.ciphertext).toString('base64url'),
  ].join('.');

type Binding = { readonly entity: string; readonly id: string; readonly field: string };
const bindingOf = (b: Binding): string => [b.entity, b.id, b.field].join('\u0000');

/**
 * A stand-in for the value keys of a unit, with the behaviour that the adapter conformance case
 * 'a sealed value opens under its value key and not after the key is destroyed' proves for every
 * store: one key per sealed value, bound to its place, gone once destroyed.
 */
function valueKeys() {
  const keys = new Map<string, { readonly binding: string; readonly plain: Uint8Array }>();
  return {
    destroy: (keyId: string) => keys.delete(keyId),
    unit: {
      keys: {
        sealValue: async (binding: Binding, plain: Uint8Array): Promise<SealedValue> => {
          const keyId = `k${keys.size + 1}`;
          keys.set(keyId, { binding: bindingOf(binding), plain });
          return { keyId, nonce: new Uint8Array([1, 2, 3]), ciphertext: new Uint8Array([4, 5, 6]) };
        },
        openValue: async (sealed: SealedValue, expected?: Binding) => {
          const key = keys.get(sealed.keyId);
          if (key === undefined) return undefined;
          return expected === undefined || bindingOf(expected) === key.binding
            ? key.plain
            : undefined;
        },
      },
    } as unknown as Unit,
  };
}

/** The effect's own stored secret `plain`, and what it is given as. */
async function setup(plain = 'one') {
  const store = valueKeys();
  const own = { entity: 'core.effect', id: effectId, field: 'code' };
  const sealedOwn = await store.unit.keys.sealValue(own, encoder.encode(plain));
  const seal = async (binding: Binding, value: string) =>
    text(await store.unit.keys.sealValue(binding, encoder.encode(value)));
  const stored = { to: 'a', code: text(sealedOwn) };
  const attempt = (code: unknown, over: Record<string, unknown> = {}, from = stored) =>
    assertSameInlineInput(store.unit, entry, effectId, from, { to: 'a', code, ...over });
  return { store, seal, stored, sealedOwn, attempt };
}

const stamped = (ref: string, owner: unknown = 'app') => {
  const given = { ref };
  Object.defineProperty(given, secretRefOwner, { value: owner });
  return given;
};
const elsewhere = { entity: 'app.user', id: 'u1', field: 'apiKey' };
const mismatch = { code: 'core.idempotency_mismatch' };

describe('a secret member given as a reference its module loaded', () => {
  test('the same value in the effect member and in a loaded row is answered', async () => {
    const { seal, attempt } = await setup();
    await expect(attempt(stamped(await seal(elsewhere, 'one')))).resolves.toBeUndefined();
  });

  test('a loaded row that holds another plain value is refused', async () => {
    const { seal, attempt } = await setup();
    await expect(attempt(stamped(await seal(elsewhere, 'two')))).rejects.toMatchObject(mismatch);
  });

  test('a reference whose key was destroyed is refused, and so is a stored value whose key was', async () => {
    const { store, seal, sealedOwn, attempt } = await setup();
    const theirs = await seal(elsewhere, 'one');
    store.destroy('k2');
    await expect(attempt(stamped(theirs))).rejects.toMatchObject(mismatch);
    const live = await seal(elsewhere, 'one');
    store.destroy(sealedOwn.keyId);
    await expect(attempt(stamped(live))).rejects.toMatchObject(mismatch);
  });

  test('a reference that is no sealed text is refused', async () => {
    const { attempt } = await setup();
    await expect(attempt(stamped('not-a-reference'))).rejects.toMatchObject(mismatch);
  });

  test('a reference the module did not stamp, or another module did, is refused', async () => {
    const { seal, attempt } = await setup();
    const ref = await seal(elsewhere, 'one');
    await expect(attempt({ ref })).rejects.toMatchObject(mismatch);
    await expect(attempt(stamped(ref, 'other'))).rejects.toMatchObject(mismatch);
  });
});

describe('a configuration secret as the stored member', () => {
  const configText = (moduleId: string) => `kwc1.backend.${moduleId}.token.1.nonce.cipher`;

  test('the same text of the effect module is answered', async () => {
    const { stored, attempt } = await setup();
    const given = configText('app');
    await expect(attempt(stamped(given), {}, { ...stored, code: given })).resolves.toBeUndefined();
  });

  test('the same text of another module is refused', async () => {
    const { stored, attempt } = await setup();
    const given = configText('other');
    await expect(attempt(stamped(given), {}, { ...stored, code: given })).rejects.toMatchObject(
      mismatch,
    );
  });
});

describe('a secret member given as plain text', () => {
  test('the same value is answered, another is refused', async () => {
    const { attempt } = await setup();
    await expect(attempt('one')).resolves.toBeUndefined();
    await expect(attempt('two')).rejects.toMatchObject(mismatch);
  });

  test('a stored text sealed under another effect id or member is refused', async () => {
    const { seal, stored, attempt } = await setup();
    const other = { entity: 'core.effect', id: 'effect-2', field: 'code' };
    await expect(
      attempt('one', {}, { ...stored, code: await seal(other, 'one') }),
    ).rejects.toMatchObject(mismatch);
    const member = { entity: 'core.effect', id: effectId, field: 'to' };
    await expect(
      attempt('one', {}, { ...stored, code: await seal(member, 'one') }),
    ).rejects.toMatchObject(mismatch);
  });
});
