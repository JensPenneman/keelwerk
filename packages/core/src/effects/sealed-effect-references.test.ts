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

const goneKeyId = '0198a1e0-0000-7000-8000-00000000c002';
const sealedAgain = `kwv1.${valueKeyId}.CQkJCQkJCQkJCQkJ.BwcHBwcHBwcHBwcHBwcHBw`;

/** What `stubUnit` sealed: the binding and the value of each call. */
interface Sealing {
  readonly binding: { readonly entity: string; readonly id: string; readonly field: string };
  readonly plain: string;
}

/** A unit that seals every value under a fixed key id and opens the values of that key. */
function stubUnit(sealings: Sealing[] = []): Unit {
  return {
    namespace: { id: 'main' },
    keys: {
      sealValue: (binding: Sealing['binding'], plain: Uint8Array) => {
        sealings.push({ binding, plain: new TextDecoder().decode(plain) });
        return Promise.resolve({
          keyId: valueKeyId,
          nonce: new Uint8Array(12).fill(9),
          ciphertext: new Uint8Array(16).fill(7),
        });
      },
      openValue: (sealed: { readonly keyId: string }) =>
        Promise.resolve(
          sealed.keyId === valueKeyId ? new TextEncoder().encode('loaded-secret') : undefined,
        ),
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

  test('an input reference loaded for the effect module is opened and sealed again for the effect', async () => {
    const sealings: Sealing[] = [];
    const sealed = (await sealEffectInput({
      unit: stubUnit(sealings),
      registry,
      entry: deliver,
      effectId,
      input: { owner, signingKey: loaded(foreignText, 'courier') },
    })) as Record<string, unknown>;
    expect(sealed.signingKey).toBe(sealedAgain);
    expect(sealings).toEqual([
      {
        binding: { entity: 'core.effect', id: effectId, field: 'signingKey' },
        plain: 'loaded-secret',
      },
    ]);
  });

  test('an input reference whose key is gone is refused', async () => {
    const gone = foreignText.replace(valueKeyId, goneKeyId);
    await expect(
      sealEffectInput({
        unit: stubUnit(),
        registry,
        entry: deliver,
        effectId,
        input: { owner, signingKey: loaded(gone, 'courier') },
      }),
    ).rejects.toMatchObject({ kind: 'validation', issues: [{ path: ['signingKey'] }] });
  });

  test("a configuration secret of the effect module is kept as its text; another module's is refused", async () => {
    const seal = (signingKey: unknown) =>
      sealEffectInput({
        unit: stubUnit(),
        registry,
        entry: deliver,
        effectId,
        input: { owner, signingKey },
      });
    const own = 'kwc1.0198a1e0-0000-7000-8000-0000000000b1.courier.signingKey.1.bm9uY2U.Y2lwaGVy';
    const other = own.replace('.courier.', '.hooks.');
    expect(((await seal(loaded(own, 'courier'))) as Record<string, unknown>).signingKey).toBe(own);
    await expect(seal(loaded(other, 'courier'))).rejects.toMatchObject(refused);
    await expect(seal({ ref: own })).rejects.toMatchObject(refused);
    // A plain string that merely looks like one is sealed as a value, never kept as the setting.
    const sealedLookalike = (await seal(own)) as Record<string, unknown>;
    expect(sealedLookalike.signingKey).toMatch(/^kwv1\./);
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
    expect(await seal([loaded(foreignText, 'courier')])).toEqual({ keys: [sealedAgain] });
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

  test('an output reference loaded for the effect module is sealed again under the output member', async () => {
    const entry = effect({}, { token: field.secret() });
    const sealings: Sealing[] = [];
    const sealed = await sealEffectOutput(stubUnit(sealings), entry, effectId, {
      token: loaded(foreignText, 'courier'),
    });
    expect(sealed).toEqual({ token: sealedAgain });
    expect(sealings.map((sealing) => sealing.binding.field)).toEqual(['output.token']);
  });
});
