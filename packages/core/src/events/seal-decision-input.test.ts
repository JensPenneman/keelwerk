import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';
import { buildDecisionRecord } from './build-decision-record.ts';
import { sealDecisionInput } from './seal-decision-input.ts';

describe('sealDecisionInput', () => {
  test('seals the canonical input under a key bound to the command, and the record carries it', async () => {
    const seen: { binding: unknown; plain: string }[] = [];
    const unit = {
      keys: {
        sealValue: async (binding: unknown, plain: Uint8Array): Promise<SealedValue> => {
          seen.push({ binding, plain: new TextDecoder().decode(plain) });
          return { keyId: 'k1', nonce: new Uint8Array(12), ciphertext: new Uint8Array(20) };
        },
      },
    } as unknown as Unit;
    const sealed = await sealDecisionInput(
      unit,
      'cmd-1',
      shape({ b: field.integer(), a: field.string(), key: field.secret() }),
      { b: 2, a: { z: 1, y: [true] }, key: 'sk-plain' },
    );
    expect(seen).toEqual([
      {
        binding: { entity: 'core.decision', id: 'cmd-1', field: 'input' },
        plain: '{"a":{"y":[true],"z":1},"b":2}',
      },
    ]);
    const record = buildDecisionRecord({
      part: 'x.y',
      inputDigest: 'd',
      input: sealed,
      reads: [],
      answers: [],
      effects: [],
    });
    expect(record.input).toBe(sealed);
    expect(JSON.stringify(record)).not.toContain('"a":{"y"');
  });

  test('refuses a personal input field until it can be sealed under the subject key', async () => {
    const unit = { keys: { sealValue: async () => ({}) } } as unknown as Unit;
    await expect(
      sealDecisionInput(unit, 'cmd-1', shape({ email: field.string().personal() }), {
        email: 'a@b.c',
      }),
    ).rejects.toMatchObject({ kind: 'not_implemented' });
  });
});
