import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import type { ShapeFields } from '../fields/shape.ts';
import { shape } from '../fields/shape.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { sealEffectInput } from './seal-effect-input.ts';
import { sealEffectOutput } from './seal-effect-output.ts';

const effectId = '0198a1e0-0000-8000-8000-0000000000e1';
const owner = '0198a1e0-0000-7000-8000-0000000000a1';
const valueKeyId = '0198a1e0-0000-7000-8000-00000000c001';
const registry = { entities: new Map() } as unknown as Registry;

/** A unit that seals every value under a fixed key id. */
function stubUnit(): Unit {
  return {
    namespace: { id: 'main' },
    keys: {
      sealValue: () =>
        Promise.resolve({
          keyId: valueKeyId,
          nonce: new Uint8Array(12).fill(9),
          ciphertext: new Uint8Array(16),
        }),
    },
  } as unknown as Unit;
}

function effect(input: ShapeFields, output: ShapeFields = {}): EffectEntry {
  return {
    ref: 'courier.deliver',
    module: 'courier',
    name: 'deliver',
    performer: 'executor',
    executor: 'courier.deliver',
    input: shape(input),
    output: shape(output),
    dataSubject: 'owner',
  };
}

const deliver = effect({ owner: field.subject(), signingKey: field.secret() });

function loaded(text: string, module: string): { readonly ref: string } {
  const ref = { ref: text };
  Object.defineProperty(ref, secretRefOwner, { value: module });
  return ref;
}

const foreignText = `kwv1.${valueKeyId}.CQkJCQkJCQkJCQkJ.AAAAAAAAAAAAAAAAAAAAAA`;
const refused = {
  kind: 'validation',
  message: 'courier.deliver.signingKey takes a plain secret or a reference its module loaded.',
  issues: [{ path: ['signingKey'] }],
};

describe('a reference in a secret member of an effect', () => {
  test('an input reference not loaded for the effect module is refused', async () => {
    const seal = (signingKey: unknown) =>
      sealEffectInput({
        unit: stubUnit(),
        registry,
        entry: deliver,
        effectId,
        input: { owner, signingKey },
      });
    // From a client or from module code: a plain object.
    await expect(seal({ ref: foreignText })).rejects.toMatchObject(refused);
    // Loaded for another module.
    await expect(seal(loaded(foreignText, 'hooks'))).rejects.toMatchObject(refused);
    // Loaded for this module, but no sealed value text.
    await expect(seal(loaded('plain text', 'courier'))).rejects.toMatchObject(refused);
    await expect(seal(['kwv1'])).rejects.toMatchObject(refused);
  });

  test('an input reference loaded for the effect module is kept as its text', async () => {
    const sealed = (await sealEffectInput({
      unit: stubUnit(),
      registry,
      entry: deliver,
      effectId,
      input: { owner, signingKey: loaded(foreignText, 'courier') },
    })) as Record<string, unknown>;
    expect(sealed.signingKey).toBe(foreignText);
  });

  test('a list of secrets checks each reference', async () => {
    const entry = effect({ keys: field.list(field.secret()) });
    const seal = (keys: unknown[]) =>
      sealEffectInput({ unit: stubUnit(), registry, entry, effectId, input: { keys } });
    await expect(
      seal([loaded(foreignText, 'courier'), { ref: foreignText }]),
    ).rejects.toMatchObject({
      kind: 'validation',
      message: 'courier.deliver.keys takes a plain secret or a reference its module loaded.',
    });
    expect(await seal([loaded(foreignText, 'courier')])).toEqual({ keys: [foreignText] });
  });

  test('an output reference not loaded for the effect module is refused', async () => {
    const entry = effect({}, { token: field.secret() });
    const seal = (token: unknown) => sealEffectOutput(stubUnit(), entry, effectId, { token });
    const message = {
      kind: 'validation',
      message: 'courier.deliver.token takes a plain secret or a reference its module loaded.',
    };
    await expect(seal({ ref: foreignText })).rejects.toMatchObject(message);
    await expect(seal(loaded(foreignText, 'hooks'))).rejects.toMatchObject(message);
  });

  test('an output reference loaded for the effect module is kept as its text', async () => {
    const entry = effect({}, { token: field.secret() });
    const sealed = await sealEffectOutput(stubUnit(), entry, effectId, {
      token: loaded(foreignText, 'courier'),
    });
    expect(sealed).toEqual({ token: foreignText });
  });
});
