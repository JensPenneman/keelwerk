import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import type { ShapeFields } from '../fields/shape.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';
import type { CommandOutput } from './command-output.ts';
import { openCommandOutput } from './open-command-output.ts';
import { sealCommandOutput } from './seal-command-output.ts';

interface Stub {
  readonly unit: Unit;
  readonly bindings: { readonly entity: string; readonly id: string; readonly field: string }[];
  destroy(): void;
}

function stubUnit(): Stub {
  const plains = new Map<string, Uint8Array>();
  const sealedFor = new Map<string, string>();
  const bindings: Stub['bindings'][number][] = [];
  const unit = {
    keys: {
      sealValue: (binding: Stub['bindings'][number], plain: Uint8Array) => {
        bindings.push(binding);
        const keyId = `key-${plains.size + 1}`;
        plains.set(keyId, plain);
        sealedFor.set(keyId, JSON.stringify(binding));
        return Promise.resolve({
          keyId,
          nonce: new Uint8Array(12).fill(1),
          ciphertext: new Uint8Array(16).fill(2),
        });
      },
      openValue: (sealed: SealedValue, expected?: Stub['bindings'][number]) =>
        Promise.resolve(
          expected !== undefined &&
            sealedFor.get(sealed.keyId) !==
              JSON.stringify({ entity: expected.entity, id: expected.id, field: expected.field })
            ? undefined
            : plains.get(sealed.keyId),
        ),
    },
  } as unknown as Unit;
  return { unit, bindings, destroy: () => plains.clear() };
}

function actionOf(output: ShapeFields): ActionEntry {
  return { output: shape(output) } as unknown as ActionEntry;
}

const issue = actionOf({ apiKey: field.secret(), label: field.string() });
const valueOutcome = (value: unknown): CommandOutput['outcome'] => ({
  ok: true,
  value,
  effects: [],
});

describe('command output in a receipt', () => {
  test('a secret member is sealed under outcome.<name> and opened for the replay', async () => {
    const stub = stubUnit();
    const outcome = await sealCommandOutput(
      stub.unit,
      'c-1',
      issue,
      valueOutcome({ apiKey: 'plain-api-key-1', label: 'ci' }),
    );
    expect(stub.bindings).toEqual([
      { entity: 'core.commandReceipt', id: 'c-1', field: 'outcome.apiKey' },
    ]);
    const stored = (outcome as { readonly value: Record<string, unknown> }).value;
    expect(stored.apiKey).toMatch(/^kwv1\.key-1\./);
    expect(stored.label).toBe('ci');
    expect(JSON.stringify(outcome)).not.toContain('plain-api-key-1');
    expect(await openCommandOutput(stub.unit, 'c-1', issue, stored)).toEqual({
      apiKey: 'plain-api-key-1',
      label: 'ci',
    });
  });

  test('a SecretRef member is kept as { ref } and replayed unchanged', async () => {
    const stub = stubUnit();
    const ref = { ref: 'kwv1.key-9.AQEB.AgIC' };
    const outcome = await sealCommandOutput(
      stub.unit,
      'c-2',
      issue,
      valueOutcome({ apiKey: ref, label: 'ci' }),
    );
    const stored = (outcome as { readonly value: Record<string, unknown> }).value;
    expect(stored.apiKey).toEqual({ ref: 'kwv1.key-9.AQEB.AgIC' });
    expect(stub.bindings).toEqual([]);
    expect(await openCommandOutput(stub.unit, 'c-2', issue, stored)).toEqual(stored);
  });

  test('a destroyed key answers conflict', async () => {
    const stub = stubUnit();
    const outcome = await sealCommandOutput(
      stub.unit,
      'c-3',
      issue,
      valueOutcome({ apiKey: 'plain-api-key-1' }),
    );
    stub.destroy();
    await expect(
      openCommandOutput(stub.unit, 'c-3', issue, (outcome as { readonly value: unknown }).value),
    ).rejects.toMatchObject({
      kind: 'conflict',
      message:
        'The stored output can no longer be read; send the command again with a new command id.',
    });
  });

  test('a text sealed for another command or member does not open and answers conflict', async () => {
    const stub = stubUnit();
    const outcome = await sealCommandOutput(
      stub.unit,
      'c-6',
      issue,
      valueOutcome({ apiKey: 'plain-api-key-1' }),
    );
    const stored = (outcome as { readonly value: Record<string, unknown> }).value;
    const conflict = { kind: 'conflict' };
    await expect(openCommandOutput(stub.unit, 'c-7', issue, stored)).rejects.toMatchObject(
      conflict,
    );
    const other = actionOf({ token: field.secret() });
    await expect(
      openCommandOutput(stub.unit, 'c-6', other, { token: stored.apiKey }),
    ).rejects.toMatchObject(conflict);
    const effectText = await stub.unit.keys.sealValue(
      { entity: 'core.effect', id: 'e-1', field: 'signingKey' },
      new TextEncoder().encode('another-secret'),
    );
    const text = `kwv1.${effectText.keyId}.AQEB.AgIC`;
    await expect(
      openCommandOutput(stub.unit, 'c-6', issue, { apiKey: text }),
    ).rejects.toMatchObject(conflict);
  });

  test('an outcome without secret members is the same object', async () => {
    const stub = stubUnit();
    const plain = actionOf({ label: field.string() });
    const outcome = valueOutcome({ label: 'ci' });
    expect(await sealCommandOutput(stub.unit, 'c-4', plain, outcome)).toBe(outcome);
    const reference: CommandOutput['outcome'] = {
      ok: true,
      ref: { entity: 'a.b', id: 'x', version: 1 },
      effects: [],
    };
    expect(await sealCommandOutput(stub.unit, 'c-5', issue, reference)).toBe(reference);
    expect(await openCommandOutput(stub.unit, 'c-4', plain, { label: 'ci' })).toEqual({
      label: 'ci',
    });
    expect(stub.bindings).toEqual([]);
  });
});
