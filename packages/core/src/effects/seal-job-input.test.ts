import { createCipheriv, createDecipheriv } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';
import { openSecretMembers } from '../write-path/open-secret-members.ts';
import { sealJobInput } from './seal-job-input.ts';

const commandId = '0198a1e0-0000-7000-8000-0000000000c1';
const valueKeyId = '0198a1e0-0000-7000-8000-00000000c001';
const scopeKey = new Uint8Array(32).fill(7);
const nonce = new Uint8Array(12).fill(9);
const aadOf = (binding: { entity: string; id: string; field: string }): Buffer =>
  Buffer.from([binding.entity, binding.id, binding.field].join('\u0000'));

/** A unit whose value key is fixed: AES-256-GCM under the scope key, a fixed nonce, the binding as associated data. */
const unit = {
  keys: {
    sealValue: (binding: { entity: string; id: string; field: string }, plain: Uint8Array) => {
      const cipher = createCipheriv('aes-256-gcm', scopeKey, nonce);
      cipher.setAAD(aadOf(binding));
      const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
      return Promise.resolve({ keyId: valueKeyId, nonce, ciphertext: new Uint8Array(body) });
    },
    openValue: (
      sealed: SealedValue,
      expected: { entity: string; id: string; field: string },
    ): Promise<Uint8Array | undefined> => {
      const body = Buffer.from(sealed.ciphertext);
      const decipher = createDecipheriv('aes-256-gcm', scopeKey, sealed.nonce);
      decipher.setAAD(aadOf(expected));
      decipher.setAuthTag(body.subarray(body.length - 16));
      try {
        const plain = Buffer.concat([
          decipher.update(body.subarray(0, body.length - 16)),
          decipher.final(),
        ]);
        return Promise.resolve(new Uint8Array(plain));
      } catch {
        return Promise.resolve(undefined);
      }
    },
  },
} as unknown as Unit;

const action = {
  input: shape({ to: field.string(), token: field.secret() }),
} as unknown as ActionEntry;

const opening = (id: string) => ({
  entity: 'core.job',
  id,
  prefix: '',
  lost: 'The stored input of this job can no longer be read.',
});

describe('the sealed input of a job (golden, final)', () => {
  test('a fixed scope key, command id, member and nonce give this exact stored input', async () => {
    const stored = await sealJobInput(unit, commandId, action, {
      to: 'ada@example.org',
      token: 'hunter2',
    });
    expect(stored).toEqual({
      to: 'ada@example.org',
      token:
        'kwv1.0198a1e0-0000-7000-8000-00000000c001.CQkJCQkJCQkJCQkJ.T_Dq4NuC8-QhkVLnBs3k_ucG3gdDBiQ',
    });
  });

  test('the same binding opens it, another command id does not', async () => {
    const stored = await sealJobInput(unit, commandId, action, {
      to: 'ada@example.org',
      token: 'hunter2',
    });
    expect(await openSecretMembers(unit, opening(commandId), action.input, stored)).toEqual({
      to: 'ada@example.org',
      token: 'hunter2',
    });
    await expect(
      openSecretMembers(
        unit,
        opening('0198a1e0-0000-7000-8000-0000000000c2'),
        action.input,
        stored,
      ),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });
});
